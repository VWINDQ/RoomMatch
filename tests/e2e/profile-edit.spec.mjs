import sharp from 'sharp';
import { test, expect, imageHost, signIn, noOverflow, capture } from './fixtures.mjs';

test('profile accepts a WebP named jpg, GIF and AVIF with working previews and persistence', async ({ page, environment }, testInfo) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await signIn(page, environment);
  await page.goto('/profile');
  for (const [format, name, mimeType] of [
    ['webp', 'downloaded.jpg', 'image/jpeg'],
    ['gif', 'profile.gif', 'image/gif'],
    ['avif', 'profile.avif', 'image/avif'],
  ]) {
    await page.getByRole('button', { name: 'แก้ไขโปรไฟล์', exact: true }).click();
    const picker = page.getByRole('group', { name: 'รูปโปรไฟล์', exact: true });
    const before = (await environment.db.prepare('SELECT profile_image FROM USER WHERE user_id=1').get()).profile_image;
    await picker.locator('input[type=file]').setInputFiles({ name: 'fake.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('%PDF-1.7 not a photo') });
    await expect(picker.getByRole('alert')).toContainText('รองรับเฉพาะไฟล์ภาพ');
    expect((await environment.db.prepare('SELECT profile_image FROM USER WHERE user_id=1').get()).profile_image).toBe(before);
    const buffer = await sharp({ create: { width: 64, height: 96, channels: 3, background: '#467aaf' } }).toFormat(format).toBuffer();
    await picker.locator('input[type=file]').setInputFiles({ name, mimeType, buffer });
    await expect(picker.getByRole('alert')).toHaveCount(0);
    await expect(picker.locator('img')).toHaveJSProperty('naturalWidth', 64);
    await picker.scrollIntoViewIfNeeded();
    await noOverflow(page);
    if (format === 'webp') {
      const path = testInfo.outputPath('image-picker-corrected-jpg.png');
      await picker.screenshot({ path, animations: 'disabled' });
      await testInfo.attach('image-picker-corrected-jpg', { path, contentType: 'image/png' });
    }
    const uploadResponse = page.waitForResponse(response => response.url().endsWith('/api/uploads/images'));
    const saveResponse = page.waitForResponse(response => response.url().endsWith('/api/profile') && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง', exact: true }).click();
    const uploaded = await uploadResponse;
    expect(uploaded.status()).toBe(201);
    expect(uploaded.request().headers()['content-type']).toBe(`image/${format}`);
    expect((await saveResponse).status()).toBe(200);
    await expect(page.locator('.profile-editor')).toHaveCount(0);
    const url = (await uploaded.json()).imageUrl;
    expect((await environment.db.prepare('SELECT profile_image FROM USER WHERE user_id=1').get()).profile_image).toBe(url);
    await page.reload();
    await expect(page.locator('.profile-avatar img')).toHaveAttribute('src', url);
    await expect(page.locator('.profile-avatar img')).toHaveJSProperty('naturalWidth', 64);
    await noOverflow(page);
  }
  await capture(page, testInfo, 'profile-new-image-formats');
  expect(pageErrors).toEqual([]);
});

test('profile saves birth date, contact details, URL and uploaded image across reloads', async ({ page, environment }, testInfo) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await environment.db.prepare('UPDATE USER SET date_of_birth=?, phone=? WHERE user_id=1').run('2000-12-25', '0890000000');
  await signIn(page, environment);
  await page.goto('/profile');
  const edit = () => page.getByRole('button', { name: 'แก้ไขโปรไฟล์', exact: true }).click();
  const save = async () => {
    const response = page.waitForResponse(response => response.url().endsWith('/api/profile') && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง', exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(page.locator('.profile-editor')).toHaveCount(0);
  };
  await edit();
  const birthDate = page.getByRole('textbox', { name: /^วันเกิด \(ค.ศ.\)/ });
  const phone = page.getByRole('textbox', { name: /^เบอร์โทรศัพท์/ });
  await expect(birthDate).toHaveValue('25/12/2000');
  await birthDate.fill('29/02/2001');
  await page.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง', exact: true }).click();
  await expect(page.locator('[name="dateOfBirth"]')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.form-feedback')).toContainText('กรุณากรอกวันเกิดที่มีอยู่จริง');
  await birthDate.fill('29/02/2000');
  await phone.fill('1');
  await page.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง', exact: true }).click();
  await expect(page.locator('[name="phone"]')).toHaveAttribute('aria-invalid', 'true');
  await noOverflow(page);
  await phone.fill('0812345678');
  await page.getByLabel('URL รูปโปรไฟล์', { exact: true }).fill(`${imageHost}/updated-profile.svg`);
  await page.getByLabel('ไลฟ์สไตล์', { exact: true }).fill('ก'.repeat(400));
  await page.getByRole('textbox', { name: 'เกี่ยวกับฉัน', exact: true }).fill('ทดสอบบันทึกโปรไฟล์');
  await save();
  await page.reload();
  await expect(page.locator('.profile-personal-data')).toContainText('29/02/2000');
  await expect(page.locator('.profile-personal-data')).toContainText('0812345678');
  await expect(page.locator('.profile-avatar img')).toHaveAttribute('src', `${imageHost}/updated-profile.svg`);
  await noOverflow(page);

  await edit();
  const buffer = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#467aaf' } }).png().toBuffer();
  await page.locator('input[type="file"]').setInputFiles({ name: 'profile.png', mimeType: 'image/png', buffer });
  await expect(page.locator('.image-picker-preview img')).toHaveAttribute('src', /^blob:/);
  await save();
  await expect(page.locator('.profile-avatar img')).toHaveAttribute('src', /^\/uploads\/1\/.+\.webp$/);
  const uploadedUrl = await page.locator('.profile-avatar img').getAttribute('src');
  await page.reload();
  await expect(page.locator('.profile-avatar img')).toHaveAttribute('src', uploadedUrl);
  await expect(page.locator('.profile-avatar img')).toHaveJSProperty('naturalWidth', 32);

  await edit();
  await page.getByLabel('ลบรูปโปรไฟล์', { exact: true }).click();
  await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  await edit();
  await expect(page.getByLabel('URL รูปโปรไฟล์', { exact: true })).toHaveValue(uploadedUrl);
  await noOverflow(page);
  await capture(page, testInfo, 'profile-editor-restored');
  await page.getByLabel('ลบรูปโปรไฟล์', { exact: true }).click();
  await save();
  await page.reload();
  await expect(page.locator('.profile-summary')).toBeVisible();
  await expect(page.locator('.profile-avatar img')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
