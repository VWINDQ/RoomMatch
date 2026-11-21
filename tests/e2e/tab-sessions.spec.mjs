import { createHash, randomBytes } from 'node:crypto';
import { startRoomMatchServer } from '../../server/app.js';
import { test, expect, signIn } from './fixtures.mjs';

const token = page => page.evaluate(() => sessionStorage.getItem('roommatch:token'));
const identity = page => page.evaluate(async () => {
  const response = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${sessionStorage.getItem('roommatch:token')}` } });
  return response.ok ? String((await response.json()).user.userId) : null;
});
async function logout(page) {
  const button = page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).filter({ visible: true }).first();
  if (!(await button.count())) await page.goto('/profile');
  await button.click();
}
async function login(page, email, password) {
  await page.goto('/login');
  await page.locator('[name="email"]').fill(email);
  await page.locator('[name="password"]').fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  // Login restores the last protected route (including /profile on mobile).
  await expect(page.locator('.app-shell')).toBeVisible();
}

test('two password accounts stay independent across refresh, writes, logout and a fresh tab', async ({ page, context, environment }) => {
  const second = await context.newPage();
  const owner = await environment.db.prepare('SELECT email FROM USER WHERE user_id=1').get();
  const seeker = await environment.db.prepare('SELECT email FROM USER WHERE user_id=3').get();
  try {
    await login(page, owner.email, 'roommatch');
    await second.goto('/login');
    await expect(second.locator('.login-form')).toBeVisible();
    expect(await token(second)).toBeNull();
    await login(second, seeker.email, 'roommatch123');
    expect(await identity(page)).toBe('1');
    expect(await identity(second)).toBe('3');
    await Promise.all([page.reload(), second.reload()]);
    expect(await identity(page)).toBe('1');
    expect(await identity(second)).toBe('3');
    // A real account-scoped write must use the initiating tab's bearer token.
    const room = await environment.db.prepare("INSERT INTO ROOM(owner_id,description,google_maps_url,price,capacity,status) VALUES(2,'Tab isolation favorite','https://maps.google.com/?q=Bangkok',1000,2,'available') RETURNING room_id").get();
    try {
      await second.goto(`/rooms/${room.room_id}`);
      await second.getByRole('button', { name: 'เพิ่มในรายการโปรด', exact: true }).click();
      await expect(second.getByRole('button', { name: 'เอาออกจากรายการโปรด', exact: true })).toBeVisible();
      const favorites = await environment.db.prepare('SELECT user_id FROM ROOM_FAVORITE WHERE room_id=?').all(room.room_id);
      expect(favorites.map(item => item.user_id)).toEqual([3]);
    } finally { await environment.db.prepare('DELETE FROM ROOM WHERE room_id=?').run(room.room_id); }
    await logout(second);
    await expect(second).toHaveURL(/\/login$/);
    expect(await identity(page)).toBe('1');
    await page.reload();
    await expect(page).toHaveURL(/\/rooms$/);
    await login(second, seeker.email, 'roommatch123');
    await logout(page);
    expect(await identity(second)).toBe('3');
    await second.close();
    const fresh = await context.newPage();
    try {
      await fresh.goto('/rooms');
      await expect(fresh).toHaveURL(/\/login$/);
      expect(await token(fresh)).toBeNull();
      expect(await fresh.evaluate(() => localStorage.getItem('roommatch:token'))).toBeNull();
    } finally { await fresh.close(); }
  } finally { if (!second.isClosed()) await second.close(); }
});

test('an expired session signs out only its own tab', async ({ page, context, environment }) => {
  await signIn(page, environment, 'owner');
  await page.goto('/rooms');
  const second = await context.newPage();
  try {
    await signIn(second, environment, 'seeker');
    await second.goto('/rooms');
    await second.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { error: 'Invalid or expired authentication token' } }));
    await second.reload();
    await expect(second).toHaveURL(/\/login$/);
    expect(await token(second)).toBeNull();
    await page.reload();
    await expect(page).toHaveURL(/\/rooms$/);
    expect(await identity(page)).toBe('1');
  } finally { await second.close(); }
});

test('an opener-copied session can change accounts without changing its original tab', async ({ page, environment }) => {
  await signIn(page, environment, 'owner');
  await page.goto('/rooms');
  const popupEvent = page.waitForEvent('popup');
  await page.evaluate(() => window.open('/rooms', '_blank'));
  const copied = await popupEvent;
  try {
    await expect(copied).toHaveURL(/\/rooms$/);
    expect(await identity(copied)).toBe('1');
    await logout(copied);
    const seeker = await environment.db.prepare('SELECT email FROM USER WHERE user_id=3').get();
    await login(copied, seeker.email, 'roommatch123');
    expect(await identity(copied)).toBe('3');
    expect(await identity(page)).toBe('1');
  } finally { await copied.close(); }
});

test('two tabs exchange separate Google tickets from the same browser cookie jar', async ({ page, context, environment }) => {
  const configuration = { clientId: 'tab-test-client', clientSecret: 'tab-test-secret', origin: 'http://127.0.0.1' };
  const app = await startRoomMatchServer({ db: environment.db, port: 0, oauth: { configuration }, logger: { error() {} } });
  const second = await context.newPage();
  try {
    configuration.origin = `http://127.0.0.1:${app.server.address().port}`;
    const attempts = await Promise.all([1, 3].map(async userId => {
      const flow = randomBytes(32).toString('base64url');
      const ticket = randomBytes(32).toString('base64url');
      await environment.db.prepare("INSERT INTO oauth_ticket(ticket_hash,user_id,expires_at) VALUES (?,?,clock_timestamp()+interval '1 minute')")
        .run(createHash('sha256').update(ticket).digest('hex'), userId);
      return { flow, ticket };
    }));
    await context.addCookies(attempts.map(({ flow, ticket }) => ({
      name: `roommatch_oauth_ticket_${flow}`, value: ticket, url: configuration.origin, httpOnly: true, sameSite: 'Strict',
    })));
    await Promise.all([page, second].map((tab, index) => tab.goto(`${configuration.origin}/auth/google/complete?returnTo=%2Frooms&flow=${attempts[index].flow}`)));
    for (const tab of [page, second]) await expect(tab).toHaveURL(`${configuration.origin}/rooms`);
    expect(await identity(page)).toBe('1');
    expect(await identity(second)).toBe('3');
    for (const { flow } of attempts) expect((await context.cookies()).some(cookie => cookie.name === `roommatch_oauth_ticket_${flow}`)).toBe(false);
    await Promise.all([page.reload(), second.reload()]);
    expect(await identity(page)).toBe('1');
    expect(await identity(second)).toBe('3');
  } finally {
    await second.close();
    await new Promise(resolve => app.server.close(resolve));
  }
});
