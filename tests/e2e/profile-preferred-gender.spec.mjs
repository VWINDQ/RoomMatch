import { test, expect, signIn } from './fixtures.mjs';

test('profile preserves a stored legacy preference and offers only three new choices', async ({ page, environment }) => {
  await environment.db.prepare(`INSERT INTO PREFERENCE(user_id, preferred_gender) VALUES (1, 'non_binary')
    ON CONFLICT(user_id) DO UPDATE SET preferred_gender = excluded.preferred_gender`).run();
  await signIn(page, environment);
  await page.goto('/profile');
  const edit = page.getByRole('button', { name: 'แก้ไขโปรไฟล์', exact: true });
  const save = page.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง', exact: true });
  const gender = page.locator('select[name="preferredGender"]');
  const storedGender = async () => (await environment.db.prepare('SELECT preferred_gender FROM PREFERENCE WHERE user_id=1').get()).preferred_gender;
  await edit.click();
  await expect(gender).toHaveValue('non_binary');
  await expect(gender.locator('option:disabled')).toHaveText('นอนไบนารี');
  await expect(gender.locator('option:enabled')).toHaveText(['ไม่จำกัด', 'ชาย', 'หญิง']);
  await expect(page.locator('select[name="gender"] option')).toHaveText(['ไม่ระบุ', 'ชาย', 'หญิง', 'นอนไบนารี', 'อื่น ๆ']);
  await page.locator('textarea[name="bio"]').fill('ปรับข้อความแนะนำตัว');
  await save.click();
  await expect(edit).toBeVisible();
  expect(await storedGender()).toBe('non_binary');
  await edit.click();
  await gender.selectOption('female');
  await save.click();
  await expect(edit).toBeVisible();
  expect(await storedGender()).toBe('female');
});
