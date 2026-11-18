import { test, expect, signIn, noOverflow, capture } from './fixtures.mjs';

test('long URL remains readable inside the room detail grid and owner panel', async ({ page, environment }, testInfo) => {
  const longUrl = `https://example.test/${'long-path-segment-'.repeat(60)}`;
  let description;
  let ownerName;
  // Extend the real PostgreSQL fixture response; keep all existing long content.
  await page.route('**/api/rooms/1', async route => {
    const response = await route.fetch();
    const payload = await response.json();
    description = `${payload.room.description}\n${longUrl}`;
    ownerName = `${payload.room.owner.firstName} ${payload.room.owner.lastName}`;
    payload.room.description = description;
    await route.fulfill({ response, json: payload });
  });
  await signIn(page, environment);
  await page.goto('/rooms/1');
  const paragraph = page.locator('.detail-main .description').first();
  await expect(paragraph).toContainText(longUrl);
  await page.evaluate(() => document.fonts.ready);
  expect(await paragraph.textContent()).toBe(description);
  await expect(paragraph).toContainText('LongUnbrokenText'.repeat(12));
  const geometry = await paragraph.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
  const owner = await page.locator('.owner-mini > div').evaluate(element => {
    const panel = element.closest('.detail-sidebar').getBoundingClientRect();
    return { right: element.getBoundingClientRect().right, panelRight: panel.right };
  });
  expect(owner.right).toBeLessThanOrEqual(owner.panelRight);
  const memberName = page.locator('.detail-member strong').first();
  await expect(memberName).toHaveText(ownerName);
  const memberGeometry = await memberName.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(memberGeometry.scroll).toBeLessThanOrEqual(memberGeometry.client + 1);
  await noOverflow(page);
  await paragraph.scrollIntoViewIfNeeded();
  await capture(page, testInfo, 'long-url-detail');
});
