import { test, expect, signIn, noOverflow } from './fixtures.mjs';
import { createToken } from '../../server/auth.js';
const invitationNotice = 'หากอีกฝ่ายตอบรับ อีกฝ่ายจะเห็น LINE, Instagram, เบอร์โทร และ อีเมล ของคุณ และคุณจะเห็นช่องทางติดต่อที่อีกฝ่ายระบุไว้';

test('the friend subtitle wraps within the space beside refresh', async ({ page, environment }) => {
  await signIn(page, environment);
  await page.goto('/friends');
  const header = page.locator('.friends-page .page-header');
  await expect(header.getByRole('heading', { name: 'ค้นหาเพื่อนใหม่', exact: true })).toBeVisible();
  const subtitle = header.getByText('เจอคนที่อยากแชร์ชีวิตประจำวันด้วย แล้วค่อยเลือกห้องไปด้วยกัน', { exact: true });
  const refresh = header.getByRole('button', { name: 'อัปเดตคำชวน', exact: true });
  await expect(subtitle).toBeVisible();
  await expect(refresh).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  const { lines, rightEdge } = await subtitle.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rects = [...range.getClientRects()];
    return { lines: new Set(rects.map(rect => rect.top)).size, rightEdge: Math.max(...rects.map(rect => rect.right)) };
  });
  const buttonBox = await refresh.boundingBox();
  expect(rightEdge).toBeLessThanOrEqual(buttonBox.x);
  expect(lines).toBe(page.viewportSize().width >= 768 ? 1 : 2);
  await refresh.click();
  await expect(refresh).toBeEnabled();
  await noOverflow(page);
});

test('friend cards and profiles show age without overflow and keep it after sending an invitation', async ({ page, environment }) => {
  const longName = 'ทดสอบชื่อยาวสำหรับจอมือถือ'.repeat(3);
  const missingName = 'ทดสอบไม่ระบุอายุ';
  const university = 'มหาวิทยาลัยทดสอบ';
  const addPerson = environment.db.prepare('INSERT INTO USER(first_name,last_name,email,university,date_of_birth,gender) VALUES (?,?,?,?,?,?) RETURNING user_id');
  const addPreference = environment.db.prepare('INSERT INTO PREFERENCE(user_id,preferred_gender,preferred_age_min,preferred_age_max) VALUES (?,?,?,?)');
  const long = await addPerson.get(longName, 'นามสกุลทดสอบ', 'friend-age-long@example.test', university, '2000-01-01', 'female');
  const minimum = await addPerson.get('ทดสอบขั้นต่ำ', 'นามสกุลทดสอบ', 'friend-age-min@example.test', university, null, 'non_binary');
  const maximum = await addPerson.get('ทดสอบขั้นสูง', 'นามสกุลทดสอบ', 'friend-age-max@example.test', university, '2000-01-01', null);
  await addPerson.get(missingName, 'นามสกุลทดสอบ', 'friend-age-empty@example.test', university, null, null);
  await addPreference.run(long.user_id, 'non_binary', 20, 25);
  await addPreference.run(minimum.user_id, 'any', 20, null);
  await addPreference.run(maximum.user_id, 'other', null, 25);
  const age = `อายุ ${new Date().getFullYear() - 2000} ปี`;

  await signIn(page, environment);
  await page.goto('/friends');
  await expect(page.getByRole('heading', { name: 'ค้นหาเพื่อนใหม่', exact: true })).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'ทำความรู้จักเพื่อน' });
  const personCard = name => page.locator('.friend-card').filter({ has: page.getByRole('heading', { name: `${name} นามสกุลทดสอบ`, exact: true }) });

  async function checkAge(container, expected, name) {
    const badge = container.locator('.profile-demographics');
    const heading = container.getByRole('heading', { name: `${name} นามสกุลทดสอบ`, exact: true });
    const school = container.getByText(university, { exact: true });
    await expect(badge).toHaveText(expected);
    const [nameBox, badgeBox, schoolBox] = await Promise.all([heading.boundingBox(), badge.boundingBox(), school.boundingBox()]);
    expect(badgeBox.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height);
    expect(schoolBox.y).toBeGreaterThanOrEqual(badgeBox.y + badgeBox.height);
    expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(schoolBox.x + schoolBox.width + 1);
  }

  const preferenceHeading = 'เพศที่สะดวกแชร์ห้อง';
  const ageHeading = 'ช่วงอายุที่สะดวกแชร์ห้อง';
  const expectModalDetails = async (gender, range) => {
    await expect(dialog.locator('.friend-full-profile h3')).toHaveText(['เกี่ยวกับฉัน', 'ไลฟ์สไตล์', preferenceHeading, ageHeading, 'งบค่าห้องที่ตั้งไว้']);
    await expect(dialog.getByRole('heading', { name: preferenceHeading }).locator('xpath=following-sibling::p[1]')).toHaveText(gender);
    await expect(dialog.getByRole('heading', { name: ageHeading }).locator('xpath=following-sibling::p[1]')).toHaveText(range);
  };
  for (const [name, summary, gender, range] of [
    [missingName, 'ยังไม่ระบุอายุ · ยังไม่ระบุเพศ', 'ยังไม่ระบุ', 'ยังไม่ระบุ'],
    ['ทดสอบขั้นต่ำ', 'ยังไม่ระบุอายุ · เพศนอนไบนารี', 'สะดวกแชร์ห้องได้ทุกเพศ', 'ตั้งแต่ 20 ปี'],
    ['ทดสอบขั้นสูง', `${age} · ยังไม่ระบุเพศ`, 'อื่น ๆ', 'ไม่เกิน 25 ปี'],
  ]) {
    const card = personCard(name);
    await checkAge(card, summary, name);
    await expect(card.getByText(preferenceHeading, { exact: true }).locator('xpath=following-sibling::dd')).toHaveText(gender);
    await card.getByRole('button', { name: 'ดูโปรไฟล์' }).click();
    await checkAge(dialog, summary, name);
    await expectModalDetails(gender, range);
    await dialog.getByRole('button', { name: 'ปิด', exact: true }).click();
  }

  const card = personCard(longName);
  const summary = `${age} · เพศหญิง`;
  await checkAge(card, summary, longName);
  await expect(card.locator('.friend-facts dt')).toHaveText(['ไลฟ์สไตล์', preferenceHeading, 'งบค่าห้องที่ตั้งไว้']);
  await expect(card.getByText(preferenceHeading, { exact: true }).locator('xpath=following-sibling::dd')).toHaveText('นอนไบนารี');
  await noOverflow(page);
  await card.getByRole('button', { name: 'ดูโปรไฟล์' }).click();
  await checkAge(dialog, summary, longName);
  await expectModalDetails('นอนไบนารี', '20–25 ปี');
  await expect(dialog.getByText(invitationNotice, { exact: true })).toHaveCount(0);
  await noOverflow(page);
  await dialog.getByRole('button', { name: 'ปิด', exact: true }).click();
  await expect(card.getByText(invitationNotice, { exact: true })).toHaveCount(0);
  await card.getByRole('button', { name: 'ส่งคำชวนเป็นเพื่อน', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'ยืนยันส่งคำชวนเป็นเพื่อน' });
  await expect(confirmation.getByText(invitationNotice, { exact: true })).toBeVisible();
  await confirmation.getByRole('button', { name: 'ยืนยันส่งคำชวน', exact: true }).click();
  await expect(card.getByText('ส่งคำชวนแล้ว · รอตอบรับ')).toBeVisible();
  await expect(card.getByText(invitationNotice, { exact: true })).toHaveCount(0);
  await card.getByRole('button', { name: 'ดูคำชวนที่ส่ง', exact: true }).click();
  await expect(page).toHaveURL(/invitations=outgoing/);
  await card.getByRole('button', { name: 'ดูโปรไฟล์' }).click();
  await expect(dialog.getByRole('button', { name: 'ถอนคำชวน' })).toBeVisible();
  await expect(dialog.locator('.contact-actions')).toHaveCount(0);
  await checkAge(dialog, summary, longName);
  await expectModalDetails('นอนไบนารี', '20–25 ปี');
  await dialog.getByRole('button', { name: 'ปิด', exact: true }).click();
  await checkAge(card, summary, longName);

  const { connection_id: connectionId } = await environment.db.prepare(
    "SELECT connection_id FROM FRIEND_CONNECTION WHERE sender_id = 1 AND recipient_id = ? AND status = 'pending'",
  ).get(long.user_id);
  const response = await page.request.patch(`/api/friends/connections/${connectionId}`, {
    headers: { Authorization: `Bearer ${createToken(long.user_id)}` },
    data: { status: 'accepted' },
  });
  expect(response.ok()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: /^เพื่อนของฉัน/ }).click();
  await expect(page).toHaveURL(/view=friends/);
  await expect(card.getByRole('link', { name: 'ค้นหาห้องด้วยกัน' })).toBeVisible();
  await checkAge(card, summary, longName);
  await expect(card.getByText(preferenceHeading, { exact: true }).locator('xpath=following-sibling::dd')).toHaveText('นอนไบนารี');
  await noOverflow(page);
  await card.getByRole('button', { name: 'ดูโปรไฟล์' }).click();
  await checkAge(dialog, summary, longName);
  await expectModalDetails('นอนไบนารี', '20–25 ปี');
  await expect(dialog.locator('.contact-actions-email')).toBeVisible();
  await noOverflow(page);
});

test('a friend profile shows the disclosure before sending from its dialog', async ({ page, environment }) => {
  if (page.viewportSize().width === 360) await page.setViewportSize({ width: 320, height: 800 });
  const name = 'Fixture Contact Dialog';
  await environment.db.prepare('INSERT INTO USER(first_name,last_name,email) VALUES(?,?,?)')
    .run(name, 'QA', 'contact-dialog@example.test');
  await signIn(page, environment);
  await page.goto(`/friends?q=${encodeURIComponent(name)}`);
  await page.getByRole('button', { name: 'ดูโปรไฟล์', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'ทำความรู้จักเพื่อน' });
  const send = dialog.getByRole('button', { name: 'ชวนหาห้องด้วยกัน', exact: true });
  const confirmation = page.getByRole('dialog', { name: 'ยืนยันส่งคำชวนเป็นเพื่อน' });
  let posts = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/friends/connections') posts++;
  });
  for (const dismiss of ['ยกเลิก', 'ปิด', 'Escape']) {
    await send.click();
    await expect(confirmation.getByText(invitationNotice, { exact: true })).toBeVisible();
    const title = await confirmation.getByRole('heading').boundingBox();
    const box = await confirmation.locator('.modal-card').boundingBox();
    expect(title.x + title.width / 2).toBeCloseTo(box.x + box.width / 2, 0);
    expect(posts).toBe(0);
    if (dismiss === 'Escape') await page.keyboard.press('Escape');
    else await confirmation.getByRole('button', { name: dismiss, exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(send).toBeFocused();
  }
  await send.click();
  await confirmation.getByRole('button', { name: 'ยืนยันส่งคำชวน', exact: true }).evaluate(button => { button.click(); button.click(); });
  await expect(dialog.getByText('ส่งคำชวนแล้ว · รอเพื่อนตอบรับ', { exact: true })).toBeVisible();
  await expect(confirmation).toHaveCount(0);
  expect(posts).toBe(1);
  await expect(dialog.getByText(invitationNotice, { exact: true })).toHaveCount(0);
  await expect(dialog.locator('.contact-actions')).toHaveCount(0);
  await noOverflow(page);
});
