import { test, expect, signIn } from './fixtures.mjs';

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
