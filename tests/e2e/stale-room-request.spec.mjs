import { test, expect, signIn, imageHost } from './fixtures.mjs';

for (const scenario of [
  { name: 'deleted', status: 404 },
  { name: 'paused', status: 409, label: 'ประกาศนี้พักรับคำขอ' },
  { name: 'full', status: 409, label: 'ห้องนี้เต็มแล้ว' },
]) {
  test(`requesting from a stale detail after the room is ${scenario.name}`, async ({ page, browser, environment }) => {
    const title = `QA-17 ${scenario.name} listing`;
    const ownerHeaders = { Authorization: `Bearer ${environment.tokens.owner}` };
    const created = await page.request.post('/api/rooms', {
      headers: ownerHeaders,
      data: {
        title, description: 'QA-17 room fixture', price: 3500, capacity: 1,
        ownerIsResident: false, priceBasis: 'per_room', locality: 'Bangkok',
        googleMapsUrl: 'https://maps.google.com/?q=Bangkok', images: [`${imageHost}/qa17.svg`],
      },
    });
    expect(created.status()).toBe(201);
    const { room: { roomId } } = await created.json();
    const endpoint = `/api/rooms/${roomId}/requests`;
    const browsePath = `/rooms?q=${encodeURIComponent(title)}`;
    const apply = page.getByRole('button', { name: 'ขอเข้าพักห้องนี้', exact: true });
    const unavailable = page.getByRole('heading', { name: 'ประกาศนี้ไม่พร้อมใช้งาน' });
    const card = page.getByRole('link', { name: `ดูห้อง ${title}`, exact: true });

    await signIn(page, environment, 'seeker');
    await page.goto(browsePath);
    await card.click();
    await expect(apply).toBeEnabled();

    if (scenario.name === 'full') {
      const joined = await page.request.post(endpoint, {
        headers: { Authorization: `Bearer ${environment.tokens.member}` },
      });
      expect(joined.status()).toBe(201);
      const { request } = await joined.json();
      const approved = await page.request.patch(`/api/requests/${request.requestId}`, {
        headers: ownerHeaders, data: { status: 'approved' },
      });
      expect(approved.status()).toBe(200);
    } else {
      const owner = await browser.newPage({ baseURL: environment.baseURL });
      try {
        await signIn(owner, environment, 'owner');
        await owner.goto('/my-listings');
        const listing = owner.locator(`#listing-${roomId}`);
        if (scenario.name === 'deleted') {
          await listing.getByRole('button', { name: `ลบ ${title}`, exact: true }).click();
          await owner.getByRole('dialog').getByRole('button', { name: 'ลบประกาศ', exact: true }).click();
          await expect(listing).toHaveCount(0);
        } else {
          await listing.getByRole('button', { name: 'พักประกาศ', exact: true }).click();
          await expect(listing.getByRole('button', { name: 'เปิดประกาศ', exact: true })).toBeEnabled();
        }
      } finally {
        await owner.close();
      }
    }

    await apply.click();
    const dialog = page.getByRole('dialog', { name: 'ยืนยันขอเข้าพัก' });
    const response = page.waitForResponse(result =>
      result.request().method() === 'POST' && new URL(result.url()).pathname === endpoint);
    await dialog.getByRole('button', { name: 'ยืนยันส่งคำขอ', exact: true }).click();
    expect((await response).status()).toBe(scenario.status);
    await expect(dialog).toHaveCount(0);
    await expect(apply).toHaveCount(0);

    if (scenario.status === 404) {
      await expect(unavailable).toBeVisible();
      await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'เพิ่มในรายการโปรด' })).toHaveCount(0);
      await page.getByRole('button', { name: 'กลับไปดูห้องทั้งหมด', exact: true }).click();
      await expect(page).toHaveURL(url => url.pathname === '/rooms' && url.searchParams.get('q') === title);
      await expect(card).toHaveCount(0);
    } else {
      await expect(unavailable).toHaveCount(0);
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: scenario.label, exact: true })).toBeDisabled();
    }
  });
}
