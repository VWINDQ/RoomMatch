import { createHash, randomBytes } from 'node:crypto';
import { startRoomMatchServer } from '../../server/app.js';
import { test, expect, noOverflow, capture } from './fixtures.mjs';

test('Google sign-in fits login and registration and preserves the protected destination', async ({ page }, testInfo) => {
  await page.route('**/api/auth/oauth/providers', route => route.fulfill({ json: { google: true } }));
  await page.goto('/rooms/1?view=photos');
  await expect(page).toHaveURL(/\/login$/);
  const google = page.getByRole('link', { name: 'ดำเนินการต่อด้วย Google' });
  await expect(google).toBeVisible();
  await expect(google).toHaveAttribute('href', '/api/auth/oauth/google?returnTo=%2Frooms%2F1%3Fview%3Dphotos');
  await google.focus();
  await expect(google).toBeFocused();
  await noOverflow(page);
  await capture(page, testInfo, 'google-login');
  await page.locator('.auth-switch a').click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole('heading', { name: 'สมัครสมาชิก', exact: true })).toBeVisible();
  await expect(google).toBeVisible();
  await google.scrollIntoViewIfNeeded();
  await expect(google).toHaveAttribute('href', '/api/auth/oauth/google?returnTo=%2Frooms%2F1%3Fview%3Dphotos');
  await noOverflow(page);
  await capture(page, testInfo, 'google-register');
});

test('Google cancellation and disabled configuration keep password login usable', async ({ page }) => {
  await page.goto('/login?oauth_error=cancelled');
  await expect(page.getByRole('alert')).toContainText('ยกเลิกการเข้าสู่ระบบด้วย Google');
  await expect(page.getByRole('button', { name: 'Google ยังไม่เปิดใช้งาน' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true })).toBeEnabled();
  await page.getByLabel('อีเมล', { exact: true }).fill('invalid@example.test');
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill('incorrect-password');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  await noOverflow(page);
});

test('browser exchanges an HttpOnly Google ticket once and establishes the normal app session', async ({ page, context, environment }) => {
  const configuration = { clientId: 'browser-test-client', clientSecret: 'browser-test-secret', origin: 'http://127.0.0.1' };
  const app = await startRoomMatchServer({ db: environment.db, port: 0, oauth: { configuration }, logger: { error() {} } });
  try {
    configuration.origin = `http://127.0.0.1:${app.server.address().port}`;
    const ticket = randomBytes(32).toString('base64url');
    await environment.db.prepare(`INSERT INTO oauth_ticket(ticket_hash,user_id,expires_at)
      VALUES (?,1,clock_timestamp()+interval '1 minute')`).run(createHash('sha256').update(ticket).digest('hex'));
    await context.addCookies([{ name: 'roommatch_oauth_ticket', value: ticket, url: configuration.origin, httpOnly: true, sameSite: 'Strict' }]);
    await page.goto(`${configuration.origin}/auth/google/complete?returnTo=%2Frooms`);
    await expect(page).toHaveURL(`${configuration.origin}/rooms`);
    await expect(page.locator('.app-shell')).toBeVisible();
    expect(await page.evaluate(() => Boolean(localStorage.getItem('roommatch:token')))).toBe(true);
    expect((await context.cookies()).some(cookie => cookie.name === 'roommatch_oauth_ticket')).toBe(false);
    expect((await environment.db.prepare('SELECT count(*) AS count FROM oauth_ticket WHERE ticket_hash=?').get(createHash('sha256').update(ticket).digest('hex'))).count).toBe(0);
    await page.reload();
    await expect(page.locator('.app-shell')).toBeVisible();
  } finally {
    await new Promise(resolve => app.server.close(resolve));
  }
});
