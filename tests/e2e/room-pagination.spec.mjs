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

test('minimum vacancies combine with price and persist across room pages until cleared', async ({ page, environment }) => {
  const rooms = await environment.db.prepare(`INSERT INTO ROOM(owner_id, description, google_maps_url, price, capacity, owner_is_resident)
    SELECT 1, 'RM12 vacancies ' || n, 'https://maps.google.com', CASE WHEN n = 16 THEN 500 ELSE 1000 END,
      CASE WHEN n = 1 THEN 2 WHEN n % 2 = 0 THEN 3 ELSE 4 END, TRUE
    FROM generate_series(1,16) n RETURNING room_id, capacity, price`).all();
  await page.goto('/rooms?q=RM12%20vacancies');
  await expect(page.locator('.list-toolbar p')).toHaveText('พบ 16 ห้อง');
  const filterButton = page.getByRole('button', { name: /^ตัวกรอง/ });
  await filterButton.click();
  const filter = page.getByRole('dialog');
  const slots = filter.getByRole('spinbutton', { name: /^จำนวนที่ว่างที่ต้องการ/ });
  await expect(filter.getByText('เลือกจำนวนคนที่จะเข้าพัก เช่น 2 ที่ = คุณกับเพื่อน ระบบจะแสดงเฉพาะห้องที่เหลือที่ว่างตามจำนวนนี้ขึ้นไป', { exact: true })).toBeVisible();
  await slots.fill('2');
  await filter.getByLabel('ราคาต่ำสุด', { exact: true }).fill('1000');
  await filter.getByRole('button', { name: 'ใช้ตัวกรอง', exact: true }).click();
  await expect(page.locator('.list-toolbar p')).toHaveText('พบ 14 ห้อง');
  const links = page.locator('.room-card-link');
  const paths = () => links.evaluateAll(items => items.map(link => link.getAttribute('href')));
  await expect(links).toHaveCount(12);
  const firstPage = await paths();
  await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await expect(links).toHaveCount(2);
  const expected = rooms.filter(room => room.capacity >= 3 && room.price >= 1000).map(room => `/rooms/${room.room_id}`);
  expect([...firstPage, ...await paths()].sort()).toEqual(expected.sort());
  await filterButton.click();
  await filter.getByRole('button', { name: 'ล้างตัวกรอง', exact: true }).click();
  await expect(slots).toHaveValue('');
  await filter.getByRole('button', { name: 'ใช้ตัวกรอง', exact: true }).click();
  await expect(page.locator('.list-toolbar p')).toHaveText('พบ 16 ห้อง');
  await expect(page).not.toHaveURL(/minSlots|minPrice|page=/);
  await noOverflow(page);
});

test('pagination URL, refresh, detail return, history and responsive controls', async ({ page, environment }, testInfo) => {
  await page.goto('/rooms?q=RM12&sort=price_asc');
  await ready(page, 1);
  const nav = page.getByRole('navigation', { name: 'แบ่งหน้ารายการห้อง' });
  const previous = nav.getByRole('button', { name: 'ก่อนหน้า', exact: true });
  const next = nav.getByRole('button', { name: 'ถัดไป', exact: true });
  await expect(previous).toBeDisabled();
  const pageTwoResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/rooms' && url.searchParams.get('page') === '2';
  });
  await reachable(next); await next.focus(); await page.keyboard.press('Enter');
  await ready(page, 2); await expect(page).toHaveURL(/page=2/);
  const pageTwo = await (await pageTwoResponse).json();
  expect(pageTwo).toMatchObject({ page: 2, pageSize: 12, total: 125, totalPages: 11 });
  expect(await page.locator('.room-card-link').evaluateAll(links => links.map(link => link.getAttribute('href'))))
    .toEqual(pageTwo.rooms.map(room => `/rooms/${room.roomId}`));
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
