import { test, expect, signIn, noOverflow, reachable, capture } from './fixtures.mjs';
import { seedPaginationRooms } from '../support/room-pagination-fixture.mjs';

test.beforeEach(async ({ page, environment }) => {
  await seedPaginationRooms(environment.db);
  await signIn(page, environment, 'seeker');
});
test.afterEach(async ({ environment }) => {
  await environment.db.prepare("DELETE FROM ROOM WHERE description LIKE 'RM12%'").run();
});

const ready = async (page, number, count = 12) => {
  await expect(page.locator('.room-card')).toHaveCount(count);
  await expect(page.locator('.list-toolbar p')).toHaveText('พบ 125 ห้อง');
  await expect(page.getByText('พบ 125 ห้อง', { exact: true })).toHaveCount(1);
  await expect(page.locator('.skeleton-region')).toHaveCount(0);
  expect(Number(new URL(page.url()).searchParams.get('page') || 1)).toBe(number);
};

test('pagination URL, refresh, detail return, history and responsive controls', async ({ page, environment }, testInfo) => {
  await page.goto('/rooms?q=RM12&sort=price_asc');
  await ready(page, 1);
  const nav = page.getByRole('navigation', { name: 'แบ่งหน้ารายการห้อง' });
  const previous = nav.getByRole('button', { name: 'ก่อนหน้า', exact: true });
  const next = nav.getByRole('button', { name: 'ถัดไป', exact: true });
  await expect(previous).toBeDisabled();
  await reachable(next); await next.focus(); await page.keyboard.press('Enter');
  await ready(page, 2); await expect(page).toHaveURL(/page=2/);
  await page.reload(); await ready(page, 2);
  const link = page.locator('.room-card-link').first();
  const title = await link.getAttribute('aria-label');
  await link.click(); await expect(page.locator('.gallery')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'กลับไปดูห้องทั้งหมด' }).click();
  await ready(page, 2); await expect(page).toHaveURL(/q=RM12&sort=price_asc&page=2/);
  await expect(page.locator('.room-card-link').first()).toHaveAttribute('aria-label', title);
  await next.click(); await ready(page, 3);
  await page.goBack(); await ready(page, 2);
  await page.goForward(); await ready(page, 3);
  await next.scrollIntoViewIfNeeded(); await reachable(next); await noOverflow(page);
  if (page.viewportSize().width <= 640) {
    await expect(nav.locator('.pagination-mobile')).toHaveText('หน้า 3 จาก 11');
    await expect(nav.locator('.pagination-desktop')).toBeHidden();
  } else {
    await expect(nav.locator('[aria-current=page]')).toHaveText('3');
    await expect(nav.locator('.pagination-desktop')).toContainText('…');
    expect(await nav.locator('[aria-current=page]').evaluate(node => getComputedStyle(node).backgroundColor))
      .not.toBe(await next.evaluate(node => getComputedStyle(node).backgroundColor));
  }
  await capture(page, testInfo, 'room-pagination');
  await page.goto('/rooms?q=RM12&page=11'); await ready(page, 11, 5);
  await expect(next).toBeDisabled();
});

test('conditions reset page; oversized and shrinking pages clamp once; empty state', async ({ page, environment }) => {
  await page.goto('/rooms?q=RM12&page=3'); await ready(page, 3);
  await page.getByRole('textbox', { name: 'ค้นหาห้อง', exact: true }).fill('RM12 fixture');
  await ready(page, 1); await expect(page).not.toHaveURL(/page=/);
  await page.goto('/rooms?q=RM12&page=3'); await ready(page, 3);
  await page.locator('.list-toolbar select').selectOption('price_desc');
  await ready(page, 1); await expect(page).not.toHaveURL(/page=/);
  await page.goto('/rooms?q=RM12&page=3'); await ready(page, 3);
  await page.getByRole('button', { name: /^ตัวกรอง/ }).click();
  await page.getByLabel('ราคาต่ำสุด', { exact: true }).fill('1000');
  await page.getByRole('button', { name: 'ใช้ตัวกรอง', exact: true }).click();
  await ready(page, 1); await expect(page).not.toHaveURL(/page=/);
  let requests = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/rooms') requests++; });
  await page.goto('/rooms?q=RM12&page=999'); await ready(page, 11, 5);
  await expect(page).toHaveURL(/page=11/);
  await page.waitForTimeout(600); expect(requests).toBe(1);
  await environment.db.prepare("DELETE FROM ROOM WHERE room_id IN (SELECT room_id FROM ROOM WHERE description LIKE 'RM12%' ORDER BY room_id LIMIT 10)").run();
  await page.reload();
  await expect(page.locator('.list-toolbar p')).toHaveText('พบ 115 ห้อง');
  await expect(page).toHaveURL(/page=10/);
  await page.goto('/rooms?q=RM12-no-match&page=5');
  await expect(page.locator('.list-toolbar p')).toHaveText('พบ 0 ห้อง');
  await expect(page.locator('.empty-state')).toBeVisible();
  await expect(page.locator('.room-pagination')).toHaveCount(0);
  await page.goto('/rooms?q=RM12%20fixture%20125');
  await expect(page.locator('.room-card')).toHaveCount(1);
  await expect(page.locator('.list-toolbar p')).toHaveText('พบ 1 ห้อง');
  await expect(page.locator('.room-pagination')).toHaveCount(0);
});

test('late response cannot replace latest page and loading blocks repeated clicks', async ({ page }) => {
  let release;
  let started;
  const waiting = new Promise(resolve => { started = resolve; });
  const delayed = new Promise(resolve => { release = resolve; });
  await page.route('**/api/rooms?**', async route => {
    if (new URL(route.request().url()).searchParams.get('page') !== '2') return route.continue();
    const response = await route.fetch(); started();
    await delayed; await route.fulfill({ response });
  });
  await page.goto('/rooms?q=RM12'); await ready(page, 1);
  const first = await page.locator('.room-card-link').first().getAttribute('href');
  const nav = page.getByRole('navigation', { name: 'แบ่งหน้ารายการห้อง' });
  await nav.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await waiting;
  await expect(nav.getByRole('button', { name: 'ถัดไป', exact: true })).toBeDisabled();
  await page.goBack(); await ready(page, 1);
  release(); await page.waitForTimeout(600);
  await ready(page, 1); await expect(page.locator('.room-card-link').first()).toHaveAttribute('href', first);
});
