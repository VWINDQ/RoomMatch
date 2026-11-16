import { test, expect, openRoute, reachable, capture } from './fixtures.mjs';
import { routes } from './routes.mjs';

test('approval modal scrolls long content and preserves keyboard focus', async ({ page, environment }, testInfo) => {
  await openRoute(page, environment, routes.find(route => route.name === 'requests'));
  const opener = page.locator('#request-2').getByRole('button', { name: 'อนุมัติ', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog');
  const close = dialog.getByRole('button', { name: 'ปิด', exact: true });
  const approve = dialog.getByRole('button', { name: 'ยืนยันอนุมัติ', exact: true });
  const cancel = dialog.getByRole('button', { name: 'ยกเลิก', exact: true });
  await expect(approve).toBeEnabled();
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(approve).toBeFocused();
  await page.keyboard.press('Tab'); await expect(close).toBeFocused();
  const body = dialog.locator('.modal-body');
  await page.keyboard.press('Tab');
  // Chromium includes an overflowing, text-only scroll region in the Tab order.
  // Preserve keyboard reading of the body as well as access to footer controls.
  if (page.viewportSize().height <= 400) {
    expect(await body.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await expect(body).toBeFocused();
    await page.keyboard.press('PageDown');
    await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press('Tab');
  }
  await expect(cancel).toBeFocused();
  if (page.viewportSize().height <= 400) {
    await body.evaluate(element => { element.scrollTop = 0; });
    await body.hover(); await page.mouse.wheel(0, 600);
    await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  }
  for (const control of [approve, cancel, close]) await reachable(control);
  const bounds = await dialog.locator('.modal-card').boundingBox();
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize().height);
  await capture(page, testInfo, 'approval-keyboard-modal');
  await cancel.click(); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  await opener.click(); await expect(close).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  await opener.click(); await close.click();
  await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
});
