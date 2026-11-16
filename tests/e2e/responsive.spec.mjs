import { test, expect, openRoute, signIn, noOverflow, reachable, capture } from './fixtures.mjs';
import { routes, declaredRoutes } from './routes.mjs';
import { randomBytes } from 'node:crypto';

test('route inventory stays synchronized with the router', () => {
  expect(routes.map(route => route.path).sort()).toEqual(declaredRoutes());
});

for (const route of routes) {
  test(`baseline ${route.name}`, async ({ page, environment }, testInfo) => {
    await openRoute(page, environment, route);
    await capture(page, testInfo, route.name);
    await noOverflow(page);
    const controls = page.locator('main button:visible,main a:visible,form button:visible');
    if (await controls.count()) await reachable(controls.last());
    if (route.actor !== 'guest') {
      const nav = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }).filter({ visible: true });
      await expect(nav).toBeVisible();
      for (const link of await nav.getByRole('link').all()) await reachable(link);
      if (page.viewportSize().width < 1024) await reachable(page.getByRole('button', { name: 'เปิดโปรไฟล์', exact: true }));
      if (route.name === 'detail-owner') await expect(page.getByRole('button', { name: 'แก้ไขประกาศของฉัน', exact: true })).toBeVisible();
    }
  });
}

test('navigation and create-listing controls are usable', async ({ page, environment }) => {
  await openRoute(page, environment, routes.find(route => route.name === 'rooms'));
  const nav = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }).filter({ visible: true });
  for (const path of ['/friends', '/favorites', '/requests', '/matches', '/my-listings']) {
    await nav.locator(`a[href="${path}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${path}(\\?|$)`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  const create = page.getByRole('button', { name: 'ลงประกาศใหม่', exact: true }).filter({ visible: true }).first();
  await reachable(create); await create.click();
  await expect(page).toHaveURL(/\/my-listings\/new$/);
  await reachable(page.getByRole('button', { name: 'สร้างประกาศ', exact: true }));
});

test('profile preferences and validation remain reachable', async ({ page, environment }, testInfo) => {
  await openRoute(page, environment, routes.find(route => route.name === 'profile'));
  await page.getByRole('button', { name: 'แก้ไขโปรไฟล์', exact: true }).click();
  await page.getByLabel('ชื่อ', { exact: true }).fill('');
  await page.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง', exact: true }).click();
  await expect(page.getByText('กรุณากรอกข้อมูลนี้', { exact: true }).first()).toBeVisible();
  await noOverflow(page);
  for (const label of ['ไลฟ์สไตล์', 'อายุต่ำสุด', 'อายุสูงสุด', 'งบต่ำสุด', 'งบสูงสุด', 'LINE ID', 'Instagram']) {
    const input = page.getByLabel(label, { exact: true });
    await reachable(input); await input.focus(); await expect(input).toBeFocused();
  }
  await reachable(page.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง', exact: true }));
  await capture(page, testInfo, 'profile-edit-validation');
});

test('listing required-field errors and bottom actions', async ({ page, environment }, testInfo) => {
  await openRoute(page, environment, routes.find(route => route.name === 'create'));
  await page.getByRole('button', { name: 'สร้างประกาศ', exact: true }).click();
  await expect(page.getByText('กรุณากรอกหัวข้อประกาศ', { exact: true }).first()).toBeVisible();
  await noOverflow(page);
  for (const field of await page.locator('form input:not([type=file]),form textarea,form select').all()) {
    await reachable(field); await field.focus(); await expect(field).toBeFocused();
  }
  await reachable(page.getByRole('button', { name: 'สร้างประกาศ', exact: true }));
  await capture(page, testInfo, 'listing-validation');
});

for (const name of ['login', 'register']) {
  test(`${name} form validation and password control`, async ({ page, environment }, testInfo) => {
    await openRoute(page, environment, routes.find(route => route.name === name));
    const submit = page.getByRole('button', { name: name === 'login' ? 'เข้าสู่ระบบ' : 'สร้างบัญชี', exact: true });
    await submit.click();
    // Auth forms use native required-field validation, not custom field errors.
    await expect(page.locator('form input:invalid').first()).toBeVisible();
    expect(await page.locator('form').evaluate(form => form.checkValidity())).toBe(false);
    await noOverflow(page);
    const toggle = page.getByRole('button', { name: /แสดงรหัสผ่าน/ });
    await reachable(toggle); await toggle.click();
    await expect(page.locator('input[name=password]')).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'ซ่อนรหัสผ่าน', exact: true }).click();
    await expect(page.locator('input[name=password]')).toHaveAttribute('type', 'password');
    await page.getByLabel('อีเมล', { exact: true }).fill('layout-only@responsive.test');
    await page.locator('input[name=password]').fill(randomBytes(16).toString('hex'));
    if (name === 'register') {
      await page.getByLabel('ชื่อ', { exact: true }).fill('ทดสอบชื่อภาษาไทยยาวสำหรับตรวจแบบฟอร์ม');
      await page.getByLabel('นามสกุล', { exact: true }).fill('นามสกุลทดสอบ');
      await page.getByLabel('เบอร์โทรศัพท์', { exact: true }).fill('0800000000');
    }
    await page.route(`**/api/auth/${name}`, route => route.fulfill({ status: 400,
      json: { error: 'ทดสอบข้อความตรวจสอบข้อมูลภาษาไทยยาว '.repeat(8) } }));
    await submit.click();
    await expect(page.getByRole('alert')).toBeVisible();
    await noOverflow(page);
    await reachable(submit);
    await capture(page, testInfo, `${name}-validation`);
  });
}

test('filter sheet scrolls, validates, applies and closes', async ({ page, environment }, testInfo) => {
  await openRoute(page, environment, routes.find(route => route.name === 'rooms'));
  await page.getByRole('button', { name: /^ตัวกรอง/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('ราคาต่ำสุด', { exact: true }).fill('9000');
  await dialog.getByLabel('ราคาสูงสุด', { exact: true }).fill('100');
  await dialog.getByRole('button', { name: 'ใช้ตัวกรอง', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('ราคาสูงสุด');
  await noOverflow(page);
  await reachable(dialog.getByRole('spinbutton', { name: /^ที่ว่างขั้นต่ำในห้อง/ }));
  await reachable(dialog.getByRole('button', { name: 'ใช้ตัวกรอง', exact: true }));
  await capture(page, testInfo, 'filter-sheet');
  await dialog.getByRole('button', { name: 'ล้างตัวกรอง', exact: true }).click();
  await dialog.getByRole('button', { name: 'ใช้ตัวกรอง', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: /^ตัวกรอง/ }).click();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
});

async function inspectDialog(page, testInfo, name) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await capture(page, testInfo, name);
  await noOverflow(page);
  const card = dialog.locator('.modal-card');
  const box = await card.boundingBox();
  expect.soft(box.y, 'dialog top must remain on screen').toBeGreaterThanOrEqual(0);
  expect.soft(box.y + box.height, 'dialog must fit the short viewport or scroll internally').toBeLessThanOrEqual(page.viewportSize().height + 1);
  const lastContent = dialog.locator('.modal-body > *').last();
  if (await lastContent.count()) { await lastContent.scrollIntoViewIfNeeded(); await expect.soft(lastContent).toBeInViewport(); }
  await reachable(dialog.getByRole('button', { name: 'ปิด', exact: true }));
  const actions = dialog.locator('footer button');
  if (await actions.count()) await reachable(actions.last());
  await dialog.getByRole('button', { name: 'ปิด', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test('delete-listing confirmation modal', async ({ page, environment }, testInfo) => {
  await openRoute(page, environment, routes.find(route => route.name === 'my-listings'));
  await page.getByRole('button', { name: /^ลบ / }).first().click();
  await inspectDialog(page, testInfo, 'delete-modal');
});

test('friend profile and invitation views', async ({ page, environment }, testInfo) => {
  await openRoute(page, environment, routes.find(route => route.name === 'friends'));
  await page.getByRole('button', { name: 'ดูโปรไฟล์', exact: true }).first().click();
  await inspectDialog(page, testInfo, 'friend-profile-modal');
  for (const suffix of ['?view=invitations&invitations=incoming', '?view=invitations&invitations=outgoing', '?view=invitations&invitations=history', '?view=friends']) {
    await page.goto(`/friends${suffix}`);
    await expect(page.locator('.friend-card,.empty-state').first()).toBeVisible();
    await noOverflow(page);
    await capture(page, testInfo, `friends-${suffix.split('=').at(-1)}`);
  }
  await page.goto('/friends?view=invitations&invitations=outgoing');
  await page.getByRole('button', { name: 'ถอนคำชวน', exact: true }).first().click();
  await inspectDialog(page, testInfo, 'friend-withdraw-modal');
});

test('request owner and seeker modals', async ({ page, environment }, testInfo) => {
  await openRoute(page, environment, routes.find(route => route.name === 'requests'));
  await page.locator('#request-2').getByRole('button', { name: 'ดูโปรไฟล์', exact: true }).click();
  await expect(page.locator('.requester-profile')).toBeVisible();
  await inspectDialog(page, testInfo, 'request-profile-modal');
  await page.getByRole('button', { name: /^อนุมัติ$/ }).first().click();
  await expect(page.getByRole('dialog').locator('.request-confirm-note')).toBeVisible();
  await inspectDialog(page, testInfo, 'approve-modal');
  await page.getByRole('button', { name: /^ปฏิเสธ$/ }).first().click();
  await inspectDialog(page, testInfo, 'reject-modal');
  await signIn(page, environment, 'seeker'); await page.goto('/requests?view=sent');
  await page.getByRole('button', { name: 'ถอนคำขอ', exact: true }).first().click();
  await inspectDialog(page, testInfo, 'request-withdraw-modal');
});

test('long-title approval dialog fits and keeps its actions reachable', async ({ page, environment }, testInfo) => {
  await openRoute(page, environment, routes.find(route => route.name === 'requests'));
  await page.locator('#request-2').getByRole('button', { name: 'อนุมัติ', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'ยืนยันอนุมัติ', exact: true })).toBeEnabled();
  await inspectDialog(page, testInfo, 'long-title-approval-modal');
});

test('detail member, applicant and missing room states', async ({ page, environment }, testInfo) => {
  for (const [actor, button, name] of [['member', 'ออกจากห้องนี้', 'leave-modal'], ['seeker', 'ถอนคำขอ', 'detail-withdraw-modal']]) {
    await signIn(page, environment, actor); await page.goto('/rooms/1');
    await expect(page.getByRole('button', { name: 'แก้ไขประกาศของฉัน', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: button, exact: true }).click();
    await inspectDialog(page, testInfo, name);
  }
  await page.goto('/rooms/999999');
  await expect(page.getByRole('heading', { name: 'เปิดประกาศนี้ไม่ได้' })).toBeVisible();
  await noOverflow(page); await capture(page, testInfo, 'missing-room');
});

test('normal full and paused room layouts and gallery controls', async ({ page, environment }, testInfo) => {
  for (const [id, status] of [[2, 'เต็มแล้ว'], [4, 'พักประกาศ']]) {
    await openRoute(page, environment, { url: `/rooms/${id}`, actor: 'seeker', ready: '.gallery' });
    await expect(page.locator('.detail-title .status')).toHaveText(status);
    await noOverflow(page);
    const next = page.getByRole('button', { name: 'รูปถัดไป', exact: true });
    if (await next.count()) { await reachable(next); await next.click(); await expect(page.locator('.gallery-main > span')).toHaveText('2 / 2'); }
    await capture(page, testInfo, `normal-room-${id}`);
  }
});

test('empty layouts and list error layouts', async ({ page, environment }, testInfo) => {
  await signIn(page, environment, 'empty');
  for (const path of ['/favorites', '/my-listings', '/requests?view=sent', '/matches', '/friends?q=NoMatchingFixture', '/rooms?q=NoMatchingFixture']) {
    await page.goto(path); await expect(page.locator('.empty-state,.mini-empty')).toBeVisible();
    await noOverflow(page); await reachable(page.locator('.empty-state button,.empty-state a,.mini-empty a').last());
    await capture(page, testInfo, `empty-${path.split('?')[0].slice(1)}`);
  }
  await signIn(page, environment, 'owner');
  const cases = [['/rooms','/api/rooms*'], ['/favorites','/api/favorites'], ['/my-listings','/api/my/rooms'], ['/profile','/api/profile'], ['/matches','/api/matches'], ['/friends','/api/friends*'], ['/requests?view=incoming','/api/owner/requests']];
  for (const [path, endpoint] of cases) {
    const pattern = `**${endpoint}`;
    await page.route(pattern, route => route.fulfill({ status: 503, json: { error: 'Service temporarily unavailable' } }));
    await page.goto(path); await expect(page.locator('.empty-state')).toBeVisible();
    await noOverflow(page); await reachable(page.locator('.empty-state button').last());
    await capture(page, testInfo, `error-${path.split('?')[0].slice(1)}`);
    await page.unroute(pattern);
  }
  await page.route('**/api/auth/me', route => route.fulfill({ status: 503, json: { error: 'Service temporarily unavailable' } }));
  await page.goto('/profile');
  await expect(page.locator('.route-loading')).toBeVisible();
  await reachable(page.getByRole('button', { name: 'ลองเชื่อมต่ออีกครั้ง', exact: true }));
  await noOverflow(page); await capture(page, testInfo, 'auth-bootstrap-error');
});

test('guest redirect, non-owner edit denial and wildcard route', async ({ page, environment }, testInfo) => {
  await signIn(page, environment, 'guest'); await page.goto('/my-listings/new');
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page, environment, 'seeker'); await page.goto('/my-listings/1/edit');
  await expect(page.getByText('คุณแก้ไขได้เฉพาะประกาศของตัวเอง')).toBeVisible();
  await expect(page.locator('form')).toHaveCount(0);
  await noOverflow(page); await capture(page, testInfo, 'non-owner');
  await page.goto('/not-a-roommatch-route'); await expect(page).toHaveURL(/\/rooms$/);
});
