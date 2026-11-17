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
