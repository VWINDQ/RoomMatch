import { test, expect, signIn, noOverflow } from './fixtures.mjs';

test('requester modal shows the sender’s age and gender and wraps a long name', async ({ page, environment }) => {
  const { user_id: requesterId } = await environment.db.prepare('SELECT user_id FROM ROOM_REQUEST WHERE request_id=2').get();
  const firstName = 'ผู้ส่งคำขอชื่อยาวมาก'.repeat(4);
  const university = 'มหาวิทยาลัยของผู้ส่งคำขอ';
  await environment.db.prepare('UPDATE USER SET first_name=?, university=?, date_of_birth=?, gender=? WHERE user_id=?')
    .run(firstName, university, '2000-01-01', 'non_binary', requesterId);
  await signIn(page, environment);
  await page.goto('/requests?view=incoming');
  const open = page.locator('#request-2').getByRole('button', { name: 'ดูโปรไฟล์', exact: true });
  const dialog = page.getByRole('dialog', { name: 'โปรไฟล์ผู้ขอเข้าพัก' });
  await open.click();
  const heading = dialog.getByRole('heading', { name: new RegExp(firstName) });
  const badge = dialog.locator('.profile-demographics');
  const school = dialog.getByText(university, { exact: true });
  await expect(badge).toHaveText(`อายุ ${new Date().getFullYear() - 2000} ปี · เพศนอนไบนารี`);
  const [nameBox, badgeBox, schoolBox] = await Promise.all([heading.boundingBox(), badge.boundingBox(), school.boundingBox()]);
  expect(badgeBox.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height);
  expect(schoolBox.y).toBeGreaterThanOrEqual(badgeBox.y + badgeBox.height);
  expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(schoolBox.x + schoolBox.width + 1);
  await noOverflow(page);
  await dialog.getByRole('button', { name: 'ปิด', exact: true }).click();
  await environment.db.prepare('UPDATE USER SET date_of_birth=NULL, gender=NULL WHERE user_id=?').run(requesterId);
  await open.click();
  await expect(badge).toHaveText('ยังไม่ระบุอายุ · ยังไม่ระบุเพศ');
});
