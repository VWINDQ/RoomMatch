import { test, expect, signIn } from './fixtures.mjs';

test('only the original sender can resend a declined invitation from history', async ({ page, environment }) => {
  await signIn(page, environment, 'owner');
  await page.goto('/friends?view=invitations&invitations=incoming');
  await page.getByRole('button', { name: 'ปฏิเสธ', exact: true }).click();
  await page.getByRole('button', { name: /^ประวัติ/ }).click();
  await expect(page.getByText('คุณปฏิเสธคำชวน', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ส่งคำชวนใหม่', exact: true })).toHaveCount(0);

  await signIn(page, environment, 'seeker');
  await page.goto('/friends?view=invitations&invitations=history');
  await expect(page.getByText('คำชวนไม่ได้รับการตอบรับ', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ส่งคำชวนใหม่', exact: true }).click();
  await expect(page.getByText('ส่งคำชวนใหม่แล้ว ดูสถานะได้ที่รอเพื่อนตอบ')).toBeVisible();
  await expect(page.getByText('คำชวนไม่ได้รับการตอบรับ', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ส่งคำชวนใหม่', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /^รอเพื่อนตอบ/ }).click();
  await expect(page.getByRole('button', { name: 'ถอนคำชวน', exact: true })).toBeVisible();
});

test('a withdrawn friendship invitation can be resent from history', async ({ page, environment }) => {
  await signIn(page, environment, 'owner');
  await page.goto('/friends?view=invitations&invitations=outgoing');
  await page.getByRole('button', { name: 'ถอนคำชวน', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /ยืนยันถอน/ }).click();
  await expect(page.getByText('คุณถอนคำชวนแล้ว', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ส่งคำชวนใหม่' }).click();
  await expect(page.getByText('ส่งคำชวนใหม่แล้ว ดูสถานะได้ที่รอเพื่อนตอบ')).toBeVisible();
  await expect(page.getByText('คุณถอนคำชวนแล้ว', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ส่งคำชวนใหม่' })).toHaveCount(0);
  await page.getByRole('button', { name: /รอเพื่อนตอบ/ }).click();
  await expect(page.getByRole('button', { name: 'ถอนคำชวน', exact: true })).toBeVisible();
});
