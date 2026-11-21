import { randomBytes } from 'node:crypto';
import { test, expect, noOverflow } from './fixtures.mjs';

test('email registration shows the reminder once on room search', async ({ page }) => {
  const email = `reminder-${randomBytes(6).toString('hex')}@example.test`;
  const password = 'test-password';
  const reminder = page.getByRole('dialog', { name: 'เติมโปรไฟล์ให้เพื่อนรู้จักคุณ' });
  const profileHeading = page.getByRole('heading', { name: 'โปรไฟล์ของฉัน', exact: true });
  const profileMenu = profileShortcut(page);
  const roomsMenu = page.locator('a.nav-link[href="/rooms"]:visible');
  await page.goto('/register');
  for (const [name, value] of Object.entries({ firstName: 'New', lastName: 'Student', phone: '0812345678', dateOfBirth: '29/02/2000', email, password })) {
    await page.locator(`form [name="${name}"]`).fill(value);
  }
  await page.locator('form [name="accountType"]').selectOption('general');
  await page.getByRole('button', { name: 'สร้างบัญชี', exact: true }).click();
  await expect(page).toHaveURL(/\/rooms$/);
  await expect(reminder).toBeVisible();
  await noOverflow(page);
  await reminder.getByRole('button', { name: 'ไว้ทีหลัง', exact: true }).click();
  await expect(reminder).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'รวมประกาศห้อง', exact: true })).toBeVisible();
  await expect(reminder).toHaveCount(0);
  await profileMenu.click();
  await expect(profileHeading).toBeVisible();
  await expect(reminder).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/rooms$/);
  await expect(reminder).toHaveCount(0);
  await page.goForward();
  await expect(profileHeading).toBeVisible();
  await expect(reminder).toHaveCount(0);
  await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, email, password);
  await expect(page).toHaveURL(/\/profile$/);
  await expect(profileHeading).toBeVisible();
  await expect(reminder).toHaveCount(0);
  await roomsMenu.click();
  await expect(page).toHaveURL(/\/rooms$/);
  await expect(reminder).toHaveCount(0);
});

test('ordinary login for an existing account with incomplete profile does not open the reminder', async ({ page, environment }) => {
  await environment.db.exec("UPDATE USER SET profile_reminder_seen_at=NULL, line_id=NULL, instagram=NULL WHERE user_id=1");
  await page.goto('/login');
  await login(page, 'phoom.s@mail.kmutt.ac.th', 'roommatch');
  await expect(page).toHaveURL(/\/rooms$/);
  await profileShortcut(page).click();
  await expect(page.getByRole('heading', { name: 'โปรไฟล์ของฉัน', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'เติมโปรไฟล์ให้เพื่อนรู้จักคุณ' })).toHaveCount(0);
});

function profileShortcut(page) {
  return page.locator('a.nav-link[href="/profile"]:visible')
    .or(page.getByRole('button', { name: 'เปิดโปรไฟล์', exact: true }));
}

async function login(page, email, password) {
  await page.locator('input[name=email]').fill(email);
  await page.locator('input[name=password]').fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
}
