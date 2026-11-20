import { createHash, randomBytes } from 'node:crypto';
import { startRoomMatchServer } from '../../server/app.js';
import { test, expect, noOverflow, capture } from './fixtures.mjs';

test('registration validates touched fields and submission, then shows duplicate email below its input', async ({ page }, testInfo) => {
  await page.goto('/register');
  const field = name => page.locator(`form [name="${name}"]`);
  const error = name => field(name).locator('xpath=ancestor::label[1]').locator('.field-error');
  const submit = page.getByRole('button', { name: 'สร้างบัญชี', exact: true });
  const errors = page.locator('.register-form .field-error');
  let requests = 0;
  page.on('request', request => { if (request.url().endsWith('/api/auth/register')) requests++; });
  await expect(errors).toHaveCount(0);
  await field('firstName').fill('   ');
  await field('gender').focus();
  await expect(error('firstName')).toHaveText('กรุณากรอกชื่อ');
  await expect(errors).toHaveCount(1);
  await field('firstName').fill('New');
  await expect(errors).toHaveCount(0);
  await field('firstName').fill('');
  await submit.click();
  await expect(errors).toHaveCount(6);
  await expect(error('dateOfBirth')).toHaveText('กรุณากรอกวันเกิด');
  await expect(field('firstName')).toBeFocused();
  expect(requests).toBe(0);
  await noOverflow(page);
  await field('firstName').fill('New');
  await field('lastName').fill('Student');
  await field('phone').fill('081');
  await expect(error('phone')).toContainText('10 หลัก');
  await field('phone').fill('0812345678');
  await field('email').fill('bad@address');
  await expect(error('email')).toContainText('กรุณากรอกอีเมลให้ถูกต้อง');
  await field('email').fill('empty@responsive.test');
  await field('password').fill('   short   ');
  await expect(error('password')).toHaveText('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
  await field('password').fill('test-password');
  await field('dateOfBirth').fill('29/02/2000');
  await expect(error('dateOfBirth')).toHaveCount(0);
  await field('dateOfBirth').fill('');
  const registrationHeading = page.getByRole('heading', { name: 'สมัครสมาชิก', exact: true });
  await registrationHeading.click();
  await expect(error('dateOfBirth')).toHaveText('กรุณากรอกวันเกิด');
  await field('dateOfBirth').fill('29/02/2000');
  await field('dateOfBirth').fill('31/02');
  await expect(error('dateOfBirth')).toHaveCount(0);
  await registrationHeading.click();
  await expect(error('dateOfBirth')).toContainText('กรอกวันเกิดเป็น วว/ดด/ปปปป');
  await field('dateOfBirth').fill('31/02/2000');
  await expect(error('dateOfBirth')).toContainText('วันเกิดที่มีอยู่จริง');
  await field('dateOfBirth').fill('29/02/2000');
  await expect(error('dateOfBirth')).toHaveCount(0);
  await field('dateOfBirth').fill('31/02/2000');
  await field('dateOfBirth').press('Tab');
  await expect(error('dateOfBirth')).toContainText('วันเกิดที่มีอยู่จริง');
  await noOverflow(page);
  await capture(page, testInfo, 'registration-date-error');
  await field('dateOfBirth').fill('25/12/2999');
  await expect(error('dateOfBirth')).toContainText('วันเกิดต้องไม่เป็นวันในอนาคต');
  await field('dateOfBirth').fill('29/02/2000');
  await field('university').fill('');
  await expect(errors).toHaveCount(0);
  await submit.click();
  await expect(error('email')).toContainText('อีเมลนี้มีบัญชีแล้ว');
  await expect(field('email')).toBeFocused();
  await field('password').focus();
  await expect(error('email')).toContainText('อีเมลนี้มีบัญชีแล้ว');
  expect(requests).toBe(1);
  await field('email').fill(`registration-${randomBytes(6).toString('hex')}@example.test`);
  await expect(errors).toHaveCount(0);
  await submit.click();
  await expect(page).toHaveURL(/\/rooms$/);
  expect(requests).toBe(2);
});

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
