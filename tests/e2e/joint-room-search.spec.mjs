import { test, expect, signIn } from './fixtures.mjs';

test('joint search explains separate decisions and preserves filters through detail and back', async ({ page, environment }) => {
  const listing = await environment.db.prepare(`INSERT INTO ROOM(owner_id, description, google_maps_url, price, capacity)
    VALUES (3, 'Joint search fixture', 'https://maps.google.com', 2500, 3) RETURNING room_id`).run();
  await signIn(page, environment, 'owner');
  await page.goto('/friends?view=friends');
  const explanation = page.getByText(/ทั้งคู่ต้องส่งคำขอแยกกัน/);
  await expect(explanation).toBeVisible();
  await page.getByRole('link', { name: 'ค้นหาห้องด้วยกัน' }).first().click();
  await page.getByRole('textbox', { name: 'ค้นหาห้อง' }).fill('Joint search fixture');
  await expect(explanation).toBeVisible();
  const filtered = new URL(page.url());
  await page.getByRole('link', { name: 'ดูห้อง Joint search fixture' }).click();
  expect(new URL(page.url()).pathname).toBe('/rooms/' + listing.insertId);
  await expect(explanation).toBeVisible();
  expect(new URL(page.url()).searchParams.get('withFriend')).toBe(filtered.searchParams.get('withFriend'));
  await page.reload();
  await expect(explanation).toBeVisible();
  await page.getByRole('button', { name: 'กลับไปดูห้องทั้งหมด' }).click();
  await expect(page).toHaveURL(filtered.href);
  await expect(page.getByRole('textbox', { name: 'ค้นหาห้อง' })).toHaveValue('Joint search fixture');
});

test('joint search announces loading, recovers from errors and explains empty results', async ({ page, environment }) => {
  await signIn(page, environment, 'owner');
  let releaseSearch;
  const searchPaused = new Promise(resolve => { releaseSearch = resolve; });
  const rooms = /\/api\/rooms\?.*withFriend=2/;
  await page.route(rooms, async route => {
    await searchPaused;
    await route.fulfill({ status: 500, json: { error: 'Internal server error' } });
  });
  await page.goto('/rooms?withFriend=2&q=Missing-joint-search-fixture');
  try {
    await expect(page.getByText('กำลังค้นหา…', { exact: true })).toBeVisible();
  } finally { releaseSearch(); }
  await expect(page.getByRole('heading', { name: 'โหลดประกาศไม่สำเร็จ' })).toBeVisible();
  await page.unroute(rooms);
  await page.getByRole('button', { name: 'ลองอีกครั้ง' }).click();
  await expect(page.getByRole('heading', { name: 'ยังไม่พบห้องที่รับคุณทั้งคู่ได้ตามเงื่อนไข' })).toBeVisible();
});
