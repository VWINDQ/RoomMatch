import sharp from 'sharp';
import { test, expect, signIn, reachable, capture, imageHost } from './fixtures.mjs';

const dialogTitle = 'ยังไม่ได้บันทึกประกาศ';
const titleInput = page => page.getByRole('textbox', { name: 'หัวข้อประกาศ', exact: false });
const backButton = page => page.getByRole('button', { name: 'กลับไปประกาศของฉัน', exact: true });
const warning = page => page.getByRole('dialog', { name: dialogTitle });
const menu = (page, path) => page.locator(`.nav-link[href="${path}"]:visible`).first();
const payload = {
  title: 'RM-13 isolated listing', description: 'Original description', price: 3500, capacity: 2,
  priceBasis: 'per_room', locality: 'Bangkok', costNotes: '', status: 'available',
  googleMapsUrl: 'https://maps.google.com/?q=Bangkok',
  images: [`${imageHost}/leave-a.svg`, `${imageHost}/leave-b.svg`],
};

// Every mutable record is created through the isolated test API and owned by this test.
test.beforeEach(async ({ page, environment }) => { await signIn(page, environment); });

async function ownedListing(page, environment, testInfo) {
  const headers = { Authorization: `Bearer ${environment.tokens.owner}` };
  const response = await page.request.post('/api/rooms', { headers, data: payload });
  expect(response.status()).toBe(201);
  const { room } = await response.json();
  const id = room.roomId ?? room.room_id;
  expect(id).toBeTruthy();
  testInfo._rm13Rooms ??= [];
  testInfo._rm13Rooms.push(id);
  return id;
}

test.afterEach(async ({ page, environment }, testInfo) => {
  for (const id of testInfo._rm13Rooms ?? []) {
    const response = await page.request.delete(`/api/rooms/${id}`, { headers: { Authorization: `Bearer ${environment.tokens.owner}` } });
    expect(response.ok()).toBe(true);
  }
});

async function openForm(page, editing, environment, testInfo) {
  const id = editing ? await ownedListing(page, environment, testInfo) : null;
  await page.goto(editing ? `/my-listings/${id}/edit` : '/my-listings/new');
  await expect(titleInput(page)).toBeVisible();
  if (editing) await expect(titleInput(page)).toHaveValue(payload.title);
  return id;
}

for (const editing of [false, true]) {
  const mode = editing ? 'edit' : 'create';
  test(`RM-13 ${mode}: pristine, validation and reverted fields leave without a warning`, async ({ page, environment }, testInfo) => {
    await openForm(page, editing, environment, testInfo);
    await backButton(page).click();
    await expect(page).toHaveURL(/\/my-listings$/);
    await expect(warning(page)).toHaveCount(0);
    await openForm(page, editing, environment, testInfo);
    // Read actual initial values, including optional fields and select/number defaults.
    for (const name of ['title', 'description', 'price', 'capacity', 'locality', 'googleMapsUrl', 'costNotes']) {
      const input = page.locator(`.listing-form [name="${name}"]`);
      const original = await input.inputValue();
      await input.fill(['price', 'capacity'].includes(name) ? '3' : 'changed');
      await backButton(page).click(); await expect(warning(page)).toBeVisible();
      await warning(page).getByRole('button', { name: 'ปิด', exact: true }).click(); await expect(warning(page)).toHaveCount(0);
      await input.fill(original);
      await expect(input).toHaveValue(original);
    }
    const basis = page.getByRole('combobox', { name: /หน่วยราคา/ });
    const originalBasis = await basis.inputValue();
    await basis.selectOption('per_person');
    await backButton(page).click(); await warning(page).getByRole('button', { name: 'ปิด', exact: true }).click(); await expect(warning(page)).toHaveCount(0);
    await basis.selectOption(originalBasis);
    await page.getByRole('button', { name: 'พักประกาศ', exact: true }).click();
    await backButton(page).click(); await warning(page).getByRole('button', { name: 'ปิด', exact: true }).click(); await expect(warning(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'เปิดรับคำขอ', exact: true }).click();
    if (!editing) {
      await page.getByRole('button', { name: 'สร้างประกาศ', exact: true }).click();
      await expect(page.locator('.field-error').first()).toBeVisible();
    }
    await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
    await expect(page).toHaveURL(/\/my-listings$/);
    await expect(warning(page)).toHaveCount(0);
  });

  test(`RM-13 ${mode}: stay preserves edits and discard follows the chosen menu destination`, async ({ page, environment }, testInfo) => {
    await openForm(page, editing, environment, testInfo);
    await titleInput(page).fill('ยังไม่บันทึก RM-13');
    const opener = menu(page, '/favorites');
    await opener.click();
    const dialog = warning(page);
    await expect(dialog).toBeVisible();
    const close = dialog.getByRole('button', { name: 'ปิด', exact: true });
    const save = dialog.getByRole('button', { name: 'บันทึกและไปต่อ', exact: true });
    const discard = dialog.getByRole('button', { name: 'ยกเลิกการแก้ไข', exact: true });
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(save).toBeFocused();
    await page.keyboard.press('Tab'); await expect(close).toBeFocused();
    const bounds = await dialog.locator('.modal-card').boundingBox();
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize().height + 1);
    for (const element of [dialog.getByRole('heading'), dialog.locator('.modal-body'), dialog.locator('footer')]) {
      const box = await element.boundingBox();
      expect(Math.abs(box.x + box.width / 2 - (bounds.x + bounds.width / 2))).toBeLessThanOrEqual(1);
    }
    const discardBox = await discard.boundingBox();
    const saveBox = await save.boundingBox();
    expect(Math.abs((discardBox.x + saveBox.x + saveBox.width) / 2 - (bounds.x + bounds.width / 2))).toBeLessThanOrEqual(1);
    for (const control of [close, discard, save]) await reachable(control);
    await capture(page, testInfo, `leave-${mode}-modal`);
    await close.click();
    await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
    await expect(titleInput(page)).toHaveValue('ยังไม่บันทึก RM-13');
    await opener.click(); await expect(dialog).toBeVisible(); await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
    await backButton(page).click(); await close.click();
    await expect(titleInput(page)).toHaveValue('ยังไม่บันทึก RM-13');
    // A new attempt must use its own destination, not the previously cancelled one.
    await menu(page, '/rooms').click(); await discard.click();
    await expect(page).toHaveURL(/\/rooms$/);
    await expect(page.locator('.room-card').first()).toBeVisible();
  });
}

test('RM-13 browser Back and Forward can stay or proceed to their original history entries', async ({ page }) => {
  await page.goto('/my-listings');
  await page.getByRole('button', { name: /^ลงประกาศ(ใหม่)?$/ }).click();
  await expect(titleInput(page)).toBeVisible();
  await menu(page, '/rooms').click();
  await expect(page).toHaveURL(/\/rooms$/);
  await page.goBack(); await expect(titleInput(page)).toBeVisible();
  await titleInput(page).fill('Forward edits');
  await page.goForward(); await expect(warning(page)).toBeVisible();
  await warning(page).getByRole('button', { name: 'ปิด', exact: true }).click();
  await expect(page).toHaveURL(/\/my-listings\/new$/);
  await expect(titleInput(page)).toHaveValue('Forward edits');
  await page.goForward(); await warning(page).getByRole('button', { name: 'ยกเลิกการแก้ไข', exact: true }).click();
  await expect(page).toHaveURL(/\/rooms$/);
  await page.goBack(); await expect(titleInput(page)).toHaveValue('');
  await titleInput(page).fill('Back edits');
  await page.goBack(); await expect(warning(page)).toBeVisible();
  await warning(page).getByRole('button', { name: 'ปิด', exact: true }).click();
  await expect(titleInput(page)).toHaveValue('Back edits');
  await page.goBack(); await warning(page).getByRole('button', { name: 'ยกเลิกการแก้ไข', exact: true }).click();
  await expect(page).toHaveURL(/\/my-listings$/);
});

test('RM-13 selected files survive staying and removing all additions restores pristine state', async ({ page, environment }, testInfo) => {
  await openForm(page, false, environment, testInfo);
  const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#987654' } }).png().toBuffer();
  await page.getByRole('group', { name: 'รูปภาพห้อง', exact: true }).locator('input[type=file]').setInputFiles([
    { name: 'first.png', mimeType: 'image/png', buffer: bytes }, { name: 'second.png', mimeType: 'image/png', buffer: bytes },
  ]);
  const previews = page.locator('.image-picker-preview img');
  await expect(previews).toHaveCount(2);
  const originalSources = await previews.evaluateAll(images => images.map(image => image.src));
  await backButton(page).click(); await warning(page).getByRole('button', { name: 'ปิด', exact: true }).click();
  expect(await previews.evaluateAll(images => images.map(image => image.src))).toEqual(originalSources);
  await page.getByRole('button', { name: 'เลื่อนรูป 2 ไปก่อนหน้า', exact: true }).click();
  expect(await previews.evaluateAll(images => images.map(image => image.src))).toEqual([...originalSources].reverse());
  await page.getByRole('button', { name: 'ลบรูป 2', exact: true }).click();
  await page.getByRole('button', { name: 'ลบรูป 1', exact: true }).click();
  await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  await expect(page).toHaveURL(/\/my-listings$/); await expect(warning(page)).toHaveCount(0);
});

test('RM-13 saved image deletion and order are dirty, restoring order is pristine', async ({ page, environment }, testInfo) => {
  await openForm(page, true, environment, testInfo);
  await page.getByRole('button', { name: 'เลื่อนรูป 2 ไปก่อนหน้า', exact: true }).click();
  await backButton(page).click(); await warning(page).getByRole('button', { name: 'ปิด', exact: true }).click();
  await page.getByRole('button', { name: 'เลื่อนรูป 2 ไปก่อนหน้า', exact: true }).click();
  await backButton(page).click(); await expect(page).toHaveURL(/\/my-listings$/);
  const id = testInfo._rm13Rooms[0];
  await page.goto(`/my-listings/${id}/edit`); await expect(titleInput(page)).toHaveValue(payload.title);
  await page.getByRole('button', { name: 'ลบรูป 1', exact: true }).click();
  await backButton(page).click(); await expect(warning(page)).toBeVisible();
  await warning(page).getByRole('button', { name: 'ยกเลิกการแก้ไข', exact: true }).click();
  await expect(page).toHaveURL(/\/my-listings$/);
});

for (const editing of [false, true]) {
  test(`RM-13 ${editing ? 'edit' : 'create'}: failed save stays dirty, save and continue retries successfully`, async ({ page, environment }, testInfo) => {
    const id = await openForm(page, editing, environment, testInfo);
    if (!editing) {
      for (const [name, value] of Object.entries(payload)) {
        if (['images', 'status', 'priceBasis'].includes(name)) continue;
        await page.locator(`.listing-form [name="${name}"]`).fill(String(value));
      }
      await page.getByRole('combobox', { name: /หน่วยราคา/ }).selectOption('per_room');
      const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#123456' } }).png().toBuffer();
      await page.getByRole('group', { name: 'รูปภาพห้อง', exact: true }).locator('input[type=file]').setInputFiles({ name: 'save.png', mimeType: 'image/png', buffer: bytes });
      await expect(page.locator('.image-picker-preview img')).toHaveCount(1);
    }
    await titleInput(page).fill('Saved after retry RM-13');
    const endpoint = editing ? `**/api/rooms/${id}` : '**/api/rooms';
    let attempts = 0, uploadCount = 0;
    page.on('request', request => { if (request.url().endsWith('/api/uploads/images')) uploadCount++; });
    await page.route(endpoint, async route => {
      if (route.request().method() !== (editing ? 'PATCH' : 'POST')) return route.fallback();
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 503, json: { error: 'Service temporarily unavailable' } });
      const response = await route.fetch();
      if (!editing) {
        const { room } = await response.json();
        testInfo._rm13Rooms ??= []; testInfo._rm13Rooms.push(room.roomId ?? room.room_id);
      }
      await route.fulfill({ response });
    });
    const save = page.getByRole('button', { name: editing ? 'บันทึกการแก้ไข' : 'สร้างประกาศ', exact: true });
    await save.click(); await expect(page.getByRole('alert')).toBeVisible();
    await expect(save).toBeEnabled();
    await backButton(page).click(); await warning(page).getByRole('button', { name: 'ปิด', exact: true }).click();
    await expect(titleInput(page)).toHaveValue('Saved after retry RM-13');
    await backButton(page).click();
    await warning(page).getByRole('button', { name: 'บันทึกและไปต่อ', exact: true }).click();
    await expect(page).toHaveURL(/\/my-listings$/);
    await expect(warning(page)).toHaveCount(0);
    expect(attempts).toBe(2); expect(uploadCount).toBe(editing ? 0 : 1);
    await page.reload(); await expect(page.getByRole('heading', { name: 'Saved after retry RM-13', exact: true })).toBeVisible();
  });
}

test('RM-13 beforeunload warns on dirty refresh and tab close, not pristine or reverted forms', async ({ page, environment }, testInfo) => {
  await openForm(page, false, environment, testInfo);
  const types = [];
  const dismiss = async dialog => { types.push(dialog.type()); await dialog.dismiss(); };
  page.on('dialog', dismiss);
  await titleInput(page).click(); // Real user activation is required by Chromium.
  await page.reload(); await expect(titleInput(page)).toHaveValue(''); expect(types).toEqual([]);
  await titleInput(page).fill('Pending refresh');
  // A cancelled reload has no load event to await. Wait for the real native dialog.
  const refreshDialog = page.waitForEvent('dialog');
  await page.evaluate(() => { window.setTimeout(() => location.reload(), 0); });
  await refreshDialog;
  expect(types).toEqual(['beforeunload']); await expect(titleInput(page)).toHaveValue('Pending refresh');
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => types.length).toBe(2); expect(page.isClosed()).toBe(false);
  await expect(titleInput(page)).toHaveValue('Pending refresh');
  await titleInput(page).fill('');
  await page.reload(); await expect(titleInput(page)).toHaveValue(''); expect(types.length).toBe(2);
  await titleInput(page).fill('Discard by refresh');
  page.off('dialog', dismiss);
  page.once('dialog', async dialog => { expect(dialog.type()).toBe('beforeunload'); await dialog.accept(); });
  await page.reload(); await expect(titleInput(page)).toHaveValue('');
});

test('RM-13 pending save keeps the guard and submit lock, success clears a pending warning', async ({ page, environment }, testInfo) => {
  const id = await openForm(page, true, environment, testInfo);
  await titleInput(page).fill('Pending save RM-13');
  let release, started, requests = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const saving = new Promise(resolve => { started = resolve; });
  await page.route(`**/api/rooms/${id}`, async route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    requests++; started(); await gate; await route.continue();
  });
  try {
    await page.getByRole('button', { name: 'บันทึกการแก้ไข', exact: true }).click(); await saving;
    await page.locator('.listing-form').evaluate(form => { for (let i = 0; i < 5; i++) form.requestSubmit(); });
    await menu(page, '/favorites').click(); await expect(warning(page)).toBeVisible();
    await warning(page).getByRole('button', { name: 'ปิด', exact: true }).click();
    await expect(titleInput(page)).toHaveValue('Pending save RM-13');
    await expect(titleInput(page)).toBeDisabled();
    await menu(page, '/rooms').click(); await expect(warning(page)).toBeVisible();
    release();
    await expect(page).toHaveURL(/\/my-listings$/); await expect(warning(page)).toHaveCount(0);
    expect(requests).toBe(1);
  } finally { release(); }
});

test('RM-13 external session changes unmount dirty forms without trapping the other account', async ({ page, environment, context }, testInfo) => {
  await openForm(page, false, environment, testInfo);
  await titleInput(page).fill('Private unsaved owner values');
  const otherTab = await context.newPage();
  await otherTab.goto('/rooms');
  await otherTab.evaluate(token => localStorage.setItem('roommatch:token', token), environment.tokens.seeker);
  await expect(warning(page)).toHaveCount(0);
  await expect(titleInput(page)).toBeVisible();
  await expect(titleInput(page)).toHaveValue('');
  await otherTab.evaluate(() => localStorage.removeItem('roommatch:token'));
  await expect(page).toHaveURL(/\/login$/);
  await expect(warning(page)).toHaveCount(0);
  await otherTab.close();
});

test('RM-13 save and continue stays on validation and API errors, then follows the selected destination once', async ({ page, environment }, testInfo) => {
  const id = await openForm(page, true, environment, testInfo);
  const dialog = warning(page);
  const save = dialog.getByRole('button', { name: 'บันทึกและไปต่อ', exact: true });
  await titleInput(page).fill('');
  await menu(page, '/favorites').click();
  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect(titleInput(page)).toBeFocused();
  await expect(titleInput(page)).toHaveAttribute('aria-invalid', 'true');
  await titleInput(page).fill('Saved from leave warning RM-13');
  let release, started, requests = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const saving = new Promise(resolve => { started = resolve; });
  await page.route(`**/api/rooms/${id}`, async route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    requests++;
    if (requests === 1) return route.fulfill({ status: 503, json: { error: 'Service temporarily unavailable' } });
    started(); await gate; await route.continue();
  });
  try {
    await menu(page, '/favorites').click();
    await save.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(titleInput(page)).toHaveValue('Saved from leave warning RM-13');
    await menu(page, '/favorites').click();
    await save.click();
    await saving;
    await expect(save).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'ยกเลิกการแก้ไข', exact: true })).toBeDisabled();
    await page.locator('.listing-form').evaluate(form => form.requestSubmit());
    release();
    await expect(page).toHaveURL(/\/favorites$/);
    await expect(dialog).toHaveCount(0);
    expect(requests).toBe(2);
    const response = await page.request.get(`/api/rooms/${id}`, { headers: { Authorization: `Bearer ${environment.tokens.owner}` } });
    expect((await response.json()).room.title).toBe('Saved from leave warning RM-13');
  } finally { release(); }
});
