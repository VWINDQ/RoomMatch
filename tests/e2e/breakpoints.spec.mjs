import { test, expect, openRoute, noOverflow, reachable, capture } from './fixtures.mjs';
import { routes, breakpointWidths } from './routes.mjs';
import { readFileSync } from 'node:fs';

test('CSS breakpoint inventory stays synchronized', () => {
  const files = ['src/styles.css', 'src/ux.css', 'src/pages/FriendsPage.css', 'src/components/ImagePicker.css'];
  const expected = new Set();
  for (const file of files) {
    for (const [, kind, raw] of readFileSync(file, 'utf8').matchAll(/@media\s*\((min|max)-width:\s*(\d+)px\)/g)) {
      const width = Number(raw); expected.add(width); expected.add(width + (kind === 'min' ? -1 : 1));
    }
  }
  expect(breakpointWidths.toSorted((a, b) => a - b)).toEqual([...expected].sort((a, b) => a - b));
});

for (const width of breakpointWidths) {
  test(`CSS boundary ${width}px`, async ({ page, environment }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    for (const name of ['rooms', 'detail-owner', 'profile', 'friends', 'create']) {
      await openRoute(page, environment, routes.find(route => route.name === name));
      await noOverflow(page);
      if (name === 'detail-owner') await capture(page, testInfo, `boundary-detail-${width}`);
      if (name === 'rooms') {
        await expect(page.locator(width < 1024 ? '.mobile-nav' : '.desktop-rail')).toBeVisible();
        await reachable(page.getByRole('button', { name: /^ตัวกรอง/ }));
      }
    }
    await capture(page, testInfo, `boundary-${width}`);
  });
}

for (const [width, height, sidebar] of [
  [390, 844, false],
  [1023, 800, false],
  [1024, 800, true],
  [1024, 390, true],
  [1280, 800, true],
]) {
  test(`My Listings create action and header at ${width}×${height}`, async ({ page, environment }, testInfo) => {
    await page.setViewportSize({ width, height });
    await openRoute(page, environment, routes.find(route => route.name === 'my-listings'));

    const create = page.getByRole('button', { name: 'ลงประกาศใหม่', exact: true });
    const sidebarCreate = page.locator('.desktop-rail .create-shortcut');
    const pageCreate = page.locator('.my-listings-header .page-actions button');
    await expect(create).toHaveCount(1);
    await expect(sidebar ? sidebarCreate : pageCreate).toBeVisible();
    await expect(sidebar ? pageCreate : sidebarCreate).toBeHidden();
    await expect(sidebar ? pageCreate : sidebarCreate).not.toBeFocused();
    expect(await (sidebar ? pageCreate : sidebarCreate).evaluate(button => {
      button.focus();
      return document.activeElement === button;
    })).toBe(false);

    const header = await page.locator('.my-listings-header .page-header').boundingBox();
    const subtitle = await page.getByText('ดูแลข้อมูล ราคา และสถานะห้องที่คุณลงประกาศ', { exact: true }).boundingBox();
    const filters = await page.locator('.my-listings-header .personal-list-filters').boundingBox();
    const status = await page.getByRole('combobox', { name: 'กรองสถานะ' }).boundingBox();
    const sort = await page.getByRole('combobox', { name: 'เรียงตาม' }).boundingBox();
    const listing = await page.locator('.my-listing').first().boundingBox();
    expect(status.x + status.width).toBeLessThan(sort.x);
    expect(listing.y).toBeGreaterThan(filters.y + filters.height);
    if (sidebar) {
      expect(header.x + header.width).toBeLessThan(filters.x);
      expect(Math.abs(subtitle.y + subtitle.height - filters.y - filters.height)).toBeLessThanOrEqual(2);
      expect(Math.abs(filters.x + filters.width - listing.x - listing.width)).toBeLessThanOrEqual(2);
      const nav = await page.locator('.desktop-rail nav').boundingBox();
      const shortcut = await sidebarCreate.boundingBox();
      expect(nav.y + nav.height).toBeLessThanOrEqual(shortcut.y + 1);
      expect(shortcut.y + shortcut.height).toBeLessThan(height);
    } else {
      expect(header.y + header.height).toBeLessThan(filters.y);
    }
    await noOverflow(page);
    await capture(page, testInfo, `my-listings-${width}x${height}`);
    await create.click();
    await expect(page).toHaveURL(/\/my-listings\/new$/);
    await expect(page.getByRole('heading', { name: 'ลงประกาศห้อง', exact: true })).toBeVisible();
  });
}

test('My Listings empty state keeps a create action when the sidebar is hidden', async ({ page, environment }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await openRoute(page, environment, { path: '/my-listings', actor: 'empty', ready: '.empty-state' });
  const emptyCreate = page.getByRole('button', { name: 'ลงประกาศห้อง', exact: true });
  await expect(emptyCreate).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ลงประกาศใหม่', exact: true })).toHaveCount(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(emptyCreate).toBeVisible();
  await emptyCreate.click();
  await expect(page).toHaveURL(/\/my-listings\/new$/);
});
