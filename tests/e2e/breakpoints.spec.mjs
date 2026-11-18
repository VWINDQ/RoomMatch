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
  [320, 800, false],
  [390, 844, false],
  [768, 1024, false],
  [1023, 800, false],
  [1024, 800, true],
  [1024, 390, true],
  [1280, 800, true],
]) {
  test(`My Listings create action and header at ${width}×${height}`, async ({ page, environment }, testInfo) => {
    await page.setViewportSize({ width, height });
    await openRoute(page, environment, routes.find(route => route.name === 'my-listings'));

    const create = page.getByRole('button', { name: /^ลงประกาศ(ใหม่)?$/ });
    const sidebarCreate = page.locator('.desktop-rail .create-shortcut');
    const pageCreate = page.locator('.my-listings-actions button').first();
    await expect(create).toHaveCount(1);
    await expect(sidebar ? sidebarCreate : pageCreate).toBeVisible();
    await expect(sidebar ? pageCreate : sidebarCreate).toBeHidden();
    await expect(sidebar ? pageCreate : sidebarCreate).not.toBeFocused();
    expect(await (sidebar ? pageCreate : sidebarCreate).evaluate(button => {
      button.focus();
      return document.activeElement === button;
    })).toBe(false);

    const header = await page.locator('.my-listings-heading').boundingBox();
    const heading = await page.getByRole('heading', { name: 'ประกาศของฉัน', exact: true }).boundingBox();
    const subtitle = await page.getByText('ดูแลข้อมูล ราคา และสถานะห้องที่คุณลงประกาศ', { exact: true }).boundingBox();
    const filterGroup = page.locator('.my-listings-header .personal-list-filters');
    const trigger = page.getByRole('button', { name: 'ตัวกรอง', exact: true });
    const listing = await page.locator('.my-listing').first().boundingBox();
    if (sidebar) {
      await expect(trigger).toHaveCount(0);
      const filters = await filterGroup.boundingBox();
      expect(filters.x + filters.width).toBeCloseTo(listing.x + listing.width, 0);
      expect(listing.y).toBeGreaterThan(filters.y + filters.height);
      expect(header.x + header.width).toBeLessThan(filters.x);
      expect(Math.abs(subtitle.y + subtitle.height - filters.y - filters.height)).toBeLessThanOrEqual(2);
      const nav = await page.locator('.desktop-rail nav').boundingBox();
      const shortcut = await sidebarCreate.boundingBox();
      expect(nav.y + nav.height).toBeLessThanOrEqual(shortcut.y + 1);
      expect(shortcut.y + shortcut.height).toBeLessThan(height);
    } else {
      await expect(filterGroup).toBeHidden();
      const button = await pageCreate.boundingBox();
      const filters = await trigger.boundingBox();
      expect(heading.y + heading.height).toBeLessThan(subtitle.y);
      expect(subtitle.y + subtitle.height).toBeLessThan(button.y);
      expect(button.x).toBeCloseTo(heading.x, 0);
      expect(button.x + button.width).toBeLessThan(filters.x);
      expect(filters.y).toBeCloseTo(button.y, 0);
      expect(filters.x + filters.width).toBeCloseTo(listing.x + listing.width, 0);
      expect(listing.y - (button.y + button.height)).toBeCloseTo(12, 0);
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

for (const width of [320, 390, 768, 1023, 1024, 1280]) {
  test(`Favorites header layout at ${width}px`, async ({ page, environment }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await openRoute(page, environment, routes.find(route => route.name === 'favorites'));
    const header = page.locator('.favorites-header');
    const subtitle = page.getByText('ห้องที่คุณบันทึกไว้', { exact: true });
    const filters = header.locator('.personal-list-filters');
    const trigger = header.getByRole('button', { name: 'ตัวกรอง', exact: true });
    const title = await header.getByRole('heading', { name: 'ห้องโปรด', exact: true }).boundingBox();
    const text = await subtitle.boundingBox();
    const grid = await page.locator('.favorites-page .room-grid').boundingBox();
    const controls = await (width >= 1024 ? filters : trigger).boundingBox();
    expect(title.y + title.height).toBeLessThan(Math.min(text.y, controls.y));
    expect(text.x).toBeCloseTo(grid.x, 0);
    expect(controls.x).toBeGreaterThan(text.x + text.width);
    expect(controls.y + controls.height / 2).toBeCloseTo(text.y + text.height / 2, 0);
    expect(controls.x + controls.width).toBeCloseTo(grid.x + grid.width, 0);
    expect(grid.y - Math.max(text.y + text.height, controls.y + controls.height)).toBeCloseTo(12, 0);
    await expect(page.locator('main').getByRole('button', { name: /^ลงประกาศ/ })).toHaveCount(0);
    if (width >= 1024) {
      await expect(trigger).toHaveCount(0);
      const status = await filters.getByRole('combobox', { name: 'กรองสถานะ' }).boundingBox();
      const sort = await filters.getByRole('combobox', { name: 'เรียงตาม' }).boundingBox();
      expect(status.x + status.width).toBeLessThan(sort.x);
      expect(status.height).toBe(sort.height);
    } else {
      await expect(filters).toBeHidden();
    }
    await noOverflow(page);
    await capture(page, testInfo, `favorites-${width}`);

    if (width < 1024) {
      await trigger.click();
      const sheet = page.getByRole('dialog', { name: 'ตัวกรองห้องโปรด' });
      await expect(sheet.getByRole('combobox', { name: 'เรียงตาม' })).toHaveValue('saved');
      await capture(page, testInfo, `favorites-filter-sheet-${width}`);
      if (width === 1023) {
        await page.setViewportSize({ width: 1024, height: 800 });
        await expect(filters).toBeVisible();
        await expect(sheet).toHaveCount(0);
        expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
      } else {
        await sheet.getByRole('button', { name: 'ปิด', exact: true }).click();
        await expect(trigger).toBeFocused();
        if (width === 320 || width === 768) {
          const filterButton = header.getByRole('button', { name: /^ตัวกรอง/ });
          await filterButton.click();
          await sheet.getByRole('combobox', { name: 'กรองสถานะ' }).selectOption('inactive');
          await sheet.getByRole('button', { name: 'ใช้ตัวกรอง' }).click();
          await expect(page).toHaveURL(/\/favorites\?status=inactive$/);
          await expect(page.locator('.room-card .status')).toHaveText(['พักประกาศ']);
          const activeButton = await filterButton.boundingBox();
          const activeText = await subtitle.boundingBox();
          expect(activeButton.x).toBeGreaterThan(activeText.x + activeText.width);
          expect(activeButton.y + activeButton.height / 2).toBeCloseTo(activeText.y + activeText.height / 2, 0);
          await noOverflow(page);
          await filterButton.click();
          await sheet.getByRole('button', { name: 'ล้างตัวกรอง' }).click();
          await expect(page).toHaveURL(/\/favorites$/);
          await expect(page.locator('.room-card')).toHaveCount(3);
        }
      }
    }
  });
}
