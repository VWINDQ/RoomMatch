import { test, expect, signIn, noOverflow, imageHost } from './fixtures.mjs';
import { createToken } from '../../server/auth.js';

test('authorized viewers can open each resident’s profile from room details', async ({ page, environment }) => {
  const names = ['เจ้าของห้อง', 'ผู้พักชื่อยาวมาก'.repeat(7), 'สมาชิกคนที่สาม', 'สมาชิกคนที่สี่'];
  const bios = ['แนะนำตัวเจ้าของห้อง\n'.repeat(40).trim(), 'แนะนำตัวผู้พักคนที่สอง', 'แนะนำตัวผู้พักคนที่สาม', null];
  const updateUser = environment.db.prepare('UPDATE USER SET first_name=?, last_name=?, date_of_birth=?, gender=?, university=?, bio=? WHERE user_id=?');
  const preference = environment.db.prepare(`INSERT INTO PREFERENCE(user_id, preferred_gender, preferred_age_min, preferred_age_max, budget_min, budget_max)
    VALUES (?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET preferred_gender=excluded.preferred_gender,
    preferred_age_min=excluded.preferred_age_min, preferred_age_max=excluded.preferred_age_max,
    budget_min=excluded.budget_min, budget_max=excluded.budget_max`);
  for (const [index, gender, born, preferredGender, min, max] of [
    [0, 'female', '2000-01-01', 'non_binary', 20, 25],
    [1, 'male', null, 'any', 20, null],
    [2, null, '2002-01-01', 'other', null, 25],
    [3, null, null, null, null, null],
  ]) {
    const userId = index + 1;
    await updateUser.run(names[index], 'ทดสอบ', born, gender, index < 3 ? `มหาวิทยาลัย ${userId}` : null, bios[index], userId);
    await preference.run(userId, preferredGender, min, max, index === 0 ? 3000 : null, index === 0 ? 5000 : null);
  }
  await environment.db.prepare(`INSERT INTO LIFESTYLE(user_id,lifestyle_name) VALUES (1,'ชอบห้องเงียบ')
    ON CONFLICT(user_id) DO UPDATE SET lifestyle_name=excluded.lifestyle_name`).run();
  await environment.db.prepare('DELETE FROM LIFESTYLE WHERE user_id=4').run();

  const headers = userId => ({ Authorization: `Bearer ${createToken(userId)}` });
  async function createRoom(ownerIsResident) {
    const response = await page.request.post('/api/rooms', {
      headers: headers(1),
      data: { title: 'ห้องทดสอบโปรไฟล์ผู้พัก', price: 5000, capacity: 6, priceBasis: 'per_room', locality: 'บางมด',
        googleMapsUrl: 'https://maps.google.com/?q=KMUTT', images: [`${imageHost}/test.svg`], ownerIsResident },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).room.roomId;
  }
  async function approve(roomId, userId) {
    const sent = await page.request.post(`/api/rooms/${roomId}/requests`, { headers: headers(userId) });
    expect(sent.status()).toBe(201);
    const { request } = await sent.json();
    const approved = await page.request.patch(`/api/requests/${request.requestId}`, { headers: headers(1), data: { status: 'approved' } });
    expect(approved.ok()).toBe(true);
  }

  await signIn(page, environment);
  const roomId = await createRoom(true);
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'ผู้พักในห้อง', exact: true }) });
  const buttonName = index => `ดูโปรไฟล์ ${names[index]} ทดสอบ`;
  const button = index => section.getByRole('button', { name: buttonName(index), exact: true });
  const dialog = page.getByRole('dialog', { name: 'โปรไฟล์สมาชิกห้อง' });
  const close = dialog.getByRole('button', { name: 'ปิด', exact: true });
  const detail = label => dialog.getByRole('heading', { name: label, exact: true }).locator('xpath=following-sibling::p[1]');
  async function checkProfile(index, demographics, gender, range) {
    await expect(dialog.getByRole('heading', { name: `${names[index]} ทดสอบ`, exact: true })).toBeVisible();
    await expect(dialog.locator('.profile-demographics')).toHaveText(demographics);
    await expect(dialog.getByText(index < 3 ? `มหาวิทยาลัย ${index + 1}` : 'ยังไม่ได้ระบุมหาวิทยาลัย', { exact: true })).toBeAttached();
    await expect(detail('เกี่ยวกับฉัน')).toHaveText(bios[index]?.replace(/\s+/g, ' ') || 'ยังไม่ได้เขียนแนะนำตัว');
    await expect(detail('เพศที่สะดวกแชร์ห้อง')).toHaveText(gender);
    await expect(detail('ช่วงอายุที่สะดวกแชร์ห้อง')).toHaveText(range);
    await expect(dialog.getByRole('button')).toHaveText(['', '']);
  }
  const year = new Date().getFullYear();
  await page.goto(`/rooms/${roomId}`);
  await expect(section.getByRole('button')).toHaveCount(1);
  await button(0).focus();
  await page.keyboard.press('Enter');
  await checkProfile(0, `อายุ ${year - 2000} ปี · เพศหญิง`, 'นอนไบนารี', '20–25 ปี');
  await expect(close).toBeFocused();
  await expect(detail('ไลฟ์สไตล์')).toHaveText('ชอบห้องเงียบ');
  await expect(detail('งบค่าห้องที่ตั้งไว้')).toHaveText('฿3,000–5,000 / เดือน');
  const body = dialog.locator('.modal-body');
  await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
  expect(await body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(button(0)).toBeFocused();

  for (const resident of [2, 3, 4]) await approve(roomId, resident);
  await page.reload();
  await expect(section.getByRole('button')).toHaveCount(4);
  const [nameBox, buttonBox] = await Promise.all([
    section.locator('.detail-member').filter({
      has: page.getByRole('button', { name: buttonName(1), exact: true }),
    }).locator('strong').boundingBox(),
    button(1).boundingBox(),
  ]);
  expect(buttonBox.x >= nameBox.x + nameBox.width - 1 || buttonBox.y >= nameBox.y + nameBox.height - 1).toBe(true);
  for (const [index, summary, gender, range] of [
    [1, 'ยังไม่ระบุอายุ · เพศชาย', 'สะดวกแชร์ห้องได้ทุกเพศ', 'ตั้งแต่ 20 ปี'],
    [2, `อายุ ${year - 2002} ปี · ยังไม่ระบุเพศ`, 'อื่น ๆ', 'ไม่เกิน 25 ปี'],
    [3, 'ยังไม่ระบุอายุ · ยังไม่ระบุเพศ', 'ยังไม่ระบุ', 'ยังไม่ระบุ'],
    [0, `อายุ ${year - 2000} ปี · เพศหญิง`, 'นอนไบนารี', '20–25 ปี'],
  ]) {
    await button(index).click();
    await checkProfile(index, summary, gender, range);
    if (index === 3) await expect(detail('ไลฟ์สไตล์')).toHaveText('ยังไม่ได้ระบุ');
    await noOverflow(page);
    await close.click();
    await expect(button(index)).toBeFocused();
  }

  const nonresidentRoom = await createRoom(false);
  await approve(nonresidentRoom, 2);
  await page.goto(`/rooms/${nonresidentRoom}`);
  await expect(page.getByRole('heading', { name: 'ผู้ลงประกาศ', exact: true })).toBeVisible();
  await expect(page.locator('.owner-mini')).toContainText('ไม่ได้พักในห้อง');
  await expect(button(1)).toBeVisible();
  await expect(button(0)).toHaveCount(0);
  await expect(section.getByRole('button')).toHaveCount(1);
  await signIn(page, environment, 'member');
  await page.goto('/matches');
  const match = page.locator('.match-card').filter({ has: page.locator(`a[href="/rooms/${nonresidentRoom}"]`) });
  await expect(match.locator('.room-role')).toHaveText('ผู้ลงประกาศ · ไม่ได้พักในห้อง');
  await page.goto('/requests?view=sent');
  const approved = page.locator('.request-card').filter({ has: page.locator(`a[href="/rooms/${nonresidentRoom}"]`) });
  await expect(approved).toContainText('ดูรายชื่อผู้พักและช่องทางติดต่อผู้ลงประกาศ');
  await page.goto(`/rooms/${roomId}`);
  await expect(button(0)).toBeVisible();
  await expect(section.getByRole('button')).toHaveCount(4);
  await signIn(page, environment, 'empty');
  await page.goto(`/rooms/${roomId}`);
  await expect(section.locator('.detail-member')).toHaveCount(1);
  await expect(section.getByRole('button')).toHaveCount(0);
});
