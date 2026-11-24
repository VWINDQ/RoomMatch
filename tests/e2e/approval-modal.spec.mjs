import { test, expect, openRoute, reachable, capture, signIn, imageHost, noOverflow } from './fixtures.mjs';
import { routes } from './routes.mjs';

async function checkConfirmationLayout(dialog) {
  const card = await dialog.locator('.modal-card').boundingBox();
  const heading = await dialog.getByRole('heading', { level: 2 }).boundingBox();
  const close = await dialog.getByRole('button', { name: 'ปิด', exact: true }).boundingBox();
  expect(heading.x + heading.width / 2).toBeCloseTo(card.x + card.width / 2, 0);
  expect(heading.x + heading.width).toBeLessThanOrEqual(close.x);
  const cancel = await dialog.getByRole('button', { name: 'ยกเลิก', exact: true }).boundingBox();
  const confirm = await dialog.getByRole('button', { name: /^ยืนยัน/ }).boundingBox();
  expect(cancel.x + cancel.width <= confirm.x || cancel.y + cancel.height <= confirm.y).toBe(true);
}

test('approval modal scrolls long content and preserves keyboard focus', async ({ page, environment }, testInfo) => {
  await openRoute(page, environment, routes.find(route => route.name === 'requests'));
  const opener = page.locator('#request-2').getByRole('button', { name: 'อนุมัติ', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog');
  const close = dialog.getByRole('button', { name: 'ปิด', exact: true });
  const approve = dialog.getByRole('button', { name: 'ยืนยันอนุมัติ', exact: true });
  const cancel = dialog.getByRole('button', { name: 'ยกเลิก', exact: true });
  await expect(approve).toBeEnabled();
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(approve).toBeFocused();
  await page.keyboard.press('Tab'); await expect(close).toBeFocused();
  const body = dialog.locator('.modal-body');
  await page.keyboard.press('Tab');
  // Chromium includes an overflowing, text-only scroll region in the Tab order.
  // Preserve keyboard reading of the body as well as access to footer controls.
  const bodyScrolls = await body.evaluate(element => element.scrollHeight > element.clientHeight);
  if (bodyScrolls) {
    await expect(body).toBeFocused();
    await page.keyboard.press('PageDown');
    await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press('Tab');
  }
  await expect(cancel).toBeFocused();
  if (bodyScrolls) {
    await body.evaluate(element => { element.scrollTop = 0; });
    await body.hover(); await page.mouse.wheel(0, 600);
    await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  }
  for (const control of [approve, cancel, close]) await reachable(control);
  const bounds = await dialog.locator('.modal-card').boundingBox();
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize().height);
  await capture(page, testInfo, 'approval-keyboard-modal');
  await cancel.click(); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  await opener.click(); await expect(close).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  await opener.click(); await close.click();
  await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
});

test('contact notices match what each participant can see after approval', async ({ page, context, environment }) => {
  const owner = await context.newPage();
  const resident = await context.newPage();
  const headers = actor => ({ Authorization: `Bearer ${environment.tokens[actor]}` });
  const contactKeys = person => ['phone', 'lineId', 'instagram', 'email'].filter(key => Object.hasOwn(person, key));
  const viewport = page.viewportSize();
  try {
    await signIn(page, environment, 'seeker');
    await signIn(owner, environment, 'owner');
    await signIn(resident, environment, 'member');
    for (const social of [false, true]) {
      const remaining = social ? 1 : 0;
      const size = viewport.width === 360 && !social ? { width: 320, height: 800 } : viewport;
      await page.setViewportSize(size);
      await owner.setViewportSize(size);
      await resident.setViewportSize(size);
      await environment.db.prepare('UPDATE USER SET phone=?, line_id=?, instagram=? WHERE user_id=1')
        .run('0890101010', social ? 'demo-owner-line' : null, social ? 'demo.owner' : null);
      const created = await page.request.post('/api/rooms', { headers: headers('owner'), data: {
        title: social ? 'QA contact social' : 'QA contact phone', capacity: 2 + remaining, price: 4000, ownerIsResident: false,
        locality: 'Fixture', priceBasis: 'per_room', googleMapsUrl: 'https://maps.google.com/?q=KMUTT',
        images: [`${imageHost}/contact-room.svg`],
      } });
      expect(created.status()).toBe(201);
      const { room } = await created.json();
      const id = room.roomId;
      const existing = await page.request.post(`/api/rooms/${id}/requests`, { headers: headers('member') });
      expect(existing.status()).toBe(201);
      const { request: prior } = await existing.json();
      expect((await page.request.patch(`/api/requests/${prior.requestId}`, { headers: headers('owner'), data: { status: 'approved' } })).ok()).toBe(true);

      await page.goto(`/rooms/${id}`);
      const apply = page.getByRole('button', { name: 'ขอเข้าพักห้องนี้', exact: true });
      const confirmRequest = page.getByRole('dialog', { name: 'ยืนยันขอเข้าพัก', exact: true });
      let postCount = 0;
      const countPosts = request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/rooms/${id}/requests`) postCount++;
      };
      page.on('request', countPosts);
      await expect(page.locator('.detail-sidebar .contact-disclosure')).toHaveCount(0);
      for (const dismiss of ['ยกเลิก', 'ปิด', 'Escape']) {
        await apply.click();
        await expect(confirmRequest.locator('.contact-disclosure p')).toHaveCount(1);
        await expect(confirmRequest.locator('.contact-disclosure')).toContainText('เมื่อคำขอได้รับอนุมัติ');
        await checkConfirmationLayout(confirmRequest);
        expect(postCount).toBe(0);
        if (dismiss === 'Escape') await page.keyboard.press('Escape');
        else await confirmRequest.getByRole('button', { name: dismiss, exact: true }).click();
        await expect(confirmRequest).toHaveCount(0);
        await expect(apply).toBeFocused();
      }
      expect(postCount).toBe(0);
      const before = await page.request.get(`/api/rooms/${id}`, { headers: headers('seeker') });
      expect(contactKeys((await before.json()).room.owner)).toEqual([]);
      await noOverflow(page);
      const sending = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/rooms/${id}/requests`);
      await apply.click();
      await confirmRequest.getByRole('button', { name: 'ยืนยันส่งคำขอ', exact: true }).evaluate(button => { button.click(); button.click(); });
      const { request } = await (await sending).json();
      await expect(confirmRequest).toHaveCount(0);
      expect(postCount).toBe(1);
      page.off('request', countPosts);
      const profile = await page.request.get(`/api/requests/${request.requestId}/profile`, { headers: headers('owner') });
      expect(contactKeys((await profile.json()).profile)).toEqual([]);

      await owner.goto('/requests?view=incoming');
      const approveRequest = owner.locator(`#request-${request.requestId}`).getByRole('button', { name: 'อนุมัติ', exact: true });
      await approveRequest.click();
      const dialog = owner.getByRole('dialog');
      const approvalNotice = dialog.locator('.modal-body .contact-disclosure');
      await expect(approvalNotice.locator('p')).toHaveCount(1);
      await expect(dialog.locator('footer .contact-disclosure')).toHaveCount(0);
      await expect(dialog.locator('footer')).toHaveCSS('border-top-width', '1px');
      await expect(approvalNotice).toHaveText(`ผู้สมัครจะเห็น ${social ? 'LINE และ Instagram' : 'เบอร์โทร'} ของคุณ และคุณจะเห็นช่องทางติดต่อที่ผู้สมัครระบุไว้`);
      await expect(dialog.getByText('เมื่อยืนยัน ผู้ขอจะอยู่ในรายชื่อผู้พัก', { exact: true })).toHaveCount(0);
      await expect(dialog.locator('.request-confirm-note')).toContainText(`ว่างอยู่ ${remaining + 1} ที่ · หลังอนุมัติจะเหลือ ${remaining} ที่`);
      await checkConfirmationLayout(dialog);
      await expect(approvalNotice).not.toContainText('0890101010');
      await expect(approvalNotice).not.toContainText('demo-owner-line');
      await expect(dialog.getByRole('button', { name: 'ยืนยันอนุมัติ' })).toBeEnabled();
      await noOverflow(owner);
      await dialog.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const afterCancel = await page.request.get('/api/requests/mine', { headers: headers('seeker') });
      expect((await afterCancel.json()).requests.find(item => item.requestId === request.requestId)?.status).toBe('pending');
      await approveRequest.click();
      await expect(dialog.getByRole('button', { name: 'ยืนยันอนุมัติ' })).toBeEnabled();
      let approvalCount = 0;
      const countApprovals = apiRequest => {
        if (apiRequest.method() === 'PATCH' && new URL(apiRequest.url()).pathname === `/api/requests/${request.requestId}`) approvalCount++;
      };
      owner.on('request', countApprovals);
      await dialog.getByRole('button', { name: 'ยืนยันอนุมัติ' }).evaluate(button => { button.click(); button.click(); });
      await expect(dialog).toHaveCount(0);
      expect(approvalCount).toBe(1);
      owner.off('request', countApprovals);
      const approved = await page.request.get(`/api/rooms/${id}`, { headers: headers('seeker') });
      expect((await approved.json()).room).toMatchObject({ status: remaining ? 'available' : 'full', availableSlots: remaining });

      for (const tab of [page, owner, resident]) await tab.goto('/matches');
      const card = tab => tab.locator('.match-card').filter({ has: tab.locator(`a[href="/rooms/${id}"]`) });
      await expect(card(page).locator(social ? '.contact-actions-line' : '.contact-actions-phone')).toBeVisible();
      if (social) await expect(card(page).locator('.contact-actions-instagram')).toBeVisible();
      await expect(card(page).locator('.contact-actions-phone')).toHaveCount(social ? 0 : 1);
      await expect(card(owner)).toHaveCount(2);
      await expect(card(resident)).toHaveCount(1);
      const residentMatches = await page.request.get('/api/matches', { headers: headers('member') });
      const visiblePeople = (await residentMatches.json()).matches.filter(match => match.room.roomId === id).map(match => match.otherUser.userId);
      expect(visiblePeople).toEqual([1]);
    }
  } finally {
    await owner.close();
    await resident.close();
  }
});
