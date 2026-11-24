import { test, expect, signIn, noOverflow } from './fixtures.mjs';

test('applicants can open only shared resident profiles before applying', async ({ page, environment }) => {
  const { db } = environment;
  const listing = await db.prepare(`INSERT INTO ROOM(owner_id, description, google_maps_url, price, capacity, owner_is_resident)
    VALUES (1, 'Resident sharing fixture', 'https://maps.google.com', 2500, 4, TRUE) RETURNING room_id`).get();
  const path = `/rooms/${listing.room_id}`;
  const join = await page.request.post(`/api${path}/requests`, { headers: { Authorization: `Bearer ${environment.tokens.member}` } });
  expect(join.status()).toBe(201);
  const { request } = await join.json();
  const approval = await page.request.patch(`/api/requests/${request.requestId}`, {
    headers: { Authorization: `Bearer ${environment.tokens.owner}` },
    data: { status: 'approved' },
  });
  expect(approval.status()).toBe(200);
  await db.prepare("UPDATE USER SET first_name='บีม', last_name='ทดสอบ', bio='ชอบทำอาหารเย็น' WHERE user_id=2").run();

  await page.goto(path);
  await expect(page).toHaveURL(/\/login/);
  await signIn(page, environment, 'member');
  await page.goto('/profile');
  const edit = page.getByRole('button', { name: 'แก้ไขโปรไฟล์', exact: true });
  await edit.click();
  const share = page.getByRole('checkbox', { name: 'เปิดโปรไฟล์ให้ผู้สนใจห้องเห็น' });
  await expect(share).not.toBeChecked();
  await share.check();
  await noOverflow(page);
  await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  const unsaved = page.getByRole('dialog', { name: 'ยังไม่ได้บันทึกการแก้ไขโปรไฟล์' });
  await expect(unsaved).toBeVisible();
  await unsaved.getByRole('button', { name: 'ปิด', exact: true }).click();
  await page.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง', exact: true }).click();
  await expect(edit).toBeVisible();

  await signIn(page, environment, 'seeker');
  await page.goto(path);
  await expect(page.getByText('รองรับ 4 คน · มีผู้พักแล้ว 2 คน · ว่าง 2 ที่')).toBeVisible();
  const residents = page.locator('section').filter({ has: page.getByRole('heading', { name: 'ผู้พักในห้อง', exact: true }) });
  await expect(residents.getByText('ผู้พัก 1 คนไม่ได้เปิดเผยโปรไฟล์')).toBeVisible();
  await expect(residents.locator('.detail-member')).toHaveCount(1);
  const openProfile = residents.getByRole('button', { name: /^ดูโปรไฟล์/ });
  await openProfile.click();
  const dialog = page.getByRole('dialog', { name: 'โปรไฟล์สมาชิกห้อง' });
  await expect(dialog.getByText('ชอบทำอาหารเย็น')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'ไลฟ์สไตล์' })).toBeVisible();
  await expect(dialog.getByText(/เบอร์โทร|Instagram|วันเกิด|งบค่าห้อง|เพศที่สะดวก/)).toHaveCount(0);
  await noOverflow(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(openProfile).toBeFocused();
  await expect(page.getByRole('button', { name: 'ขอเข้าพักห้องนี้' })).toBeEnabled();

  await signIn(page, environment, 'member');
  await page.goto('/profile');
  await edit.click();
  await expect(share).toBeChecked();
  await share.uncheck();
  await page.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง', exact: true }).click();
  await expect(edit).toBeVisible();
  await signIn(page, environment, 'seeker');
  await page.goto(path);
  await expect(residents.getByText('ผู้พัก 2 คนไม่ได้เปิดเผยโปรไฟล์')).toBeVisible();
  await expect(openProfile).toHaveCount(0);
});

test('room details distinguish a load failure from a room with no residents', async ({ page, environment }) => {
  const listing = await environment.db.prepare(`INSERT INTO ROOM(owner_id, description, google_maps_url, price, capacity)
    VALUES (1, 'Empty resident fixture', 'https://maps.google.com', 2500, 4) RETURNING room_id`).get();
  const path = `/rooms/${listing.room_id}`;
  await signIn(page, environment, 'seeker');
  await page.route(`**/api${path}`, route => route.fulfill({ status: 500, json: { error: 'Internal server error' } }), { times: 1 });
  await page.goto(path);
  const empty = page.getByText('ยังไม่มีผู้พัก คนที่เข้าร่วมภายหลังอาจเป็นผู้สมัครคนอื่น');
  await expect(page.getByRole('heading', { name: 'เปิดประกาศนี้ไม่ได้' })).toBeVisible();
  await expect(empty).toHaveCount(0);
  await page.getByRole('button', { name: 'ลองอีกครั้ง' }).click();
  await expect(empty).toBeVisible();
  await expect(page.getByText('รองรับ 4 คน · มีผู้พักแล้ว 0 คน · ว่าง 4 ที่')).toBeVisible();
});
