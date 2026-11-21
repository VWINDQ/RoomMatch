import { test, expect, signIn, noOverflow, capture } from './fixtures.mjs';

test('first login reminder opens the profile editor and stays dismissed after reload and a new login', async ({ page, environment }, testInfo) => {
  await environment.db.exec('UPDATE USER SET profile_reminder_seen_at=NULL WHERE user_id=1');
  await signIn(page, environment);
  await page.goto('/rooms');
  const reminder = page.getByRole('dialog', { name: 'เติมโปรไฟล์ให้เพื่อนรู้จักคุณ' });
  await expect(reminder).toBeVisible();
  await expect(reminder.getByText('ไลฟ์สไตล์ของคุณ', { exact: true })).toBeVisible();
  await noOverflow(page);
  await capture(page, testInfo, 'first-login-modal');
  await reminder.getByRole('button', { name: 'ไปเติมโปรไฟล์', exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.locator('input[name=lifestyleName]')).toBeVisible();
  await expect(reminder).toHaveCount(0);
  expect((await environment.db.prepare('SELECT profile_reminder_seen_at FROM USER WHERE user_id=1').get()).profile_reminder_seen_at).not.toBeNull();
  await page.reload();
  await expect(page.getByRole('button', { name: 'แก้ไขโปรไฟล์', exact: true })).toBeVisible();
  await expect(reminder).toHaveCount(0);
  await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).click();
  await page.getByRole('textbox', { name: 'อีเมล', exact: true }).fill('phoom.s@mail.kmutt.ac.th');
  await page.locator('input[name=password]').fill('roommatch');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole('button', { name: 'แก้ไขโปรไฟล์', exact: true })).toBeVisible();
  await expect(reminder).toHaveCount(0);
});
