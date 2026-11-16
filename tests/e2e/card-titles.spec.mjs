import { test, expect, signIn, reachable, noOverflow, capture } from './fixtures.mjs';

const longTitle = `ห้อง${'LongUnbrokenRoomTitle'.repeat(9)}`;

async function titleFixture(page) {
  // Keep the real isolated PostgreSQL records and replace only their display title.
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (!['/api/rooms', '/api/favorites', '/api/my/rooms', '/api/rooms/1'].includes(url.pathname)) return route.fallback();
    const response = await route.fetch();
    const payload = await response.json();
    for (const room of payload.rooms ?? (payload.room ? [payload.room] : [])) {
      if (String(room.roomId) === '1') room.title = longTitle;
    }
    await route.fulfill({ response, json: payload });
  });
}

async function cardGeometry(card, listing) {
  return card.evaluate((element, listing) => {
    const rect = node => {
      const box = node.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const title = element.querySelector('h2');
    const price = element.querySelector('.price');
    const content = element.querySelector(listing ? '.my-listing-main' : '.room-card-copy');
    const style = getComputedStyle(title), padding = getComputedStyle(content);
    return {
      card: rect(element), title: rect(title), price: rect(price),
      image: rect(element.querySelector(listing ? ':scope > img,:scope > .photo-fallback' : '.room-card-image')),
      controls: [...element.querySelectorAll('button')].map(rect),
      priceParts: [...price.children].map(rect),
      titleStyle: { whiteSpace: style.whiteSpace, textOverflow: style.textOverflow, overflowX: style.overflowX },
      titleClient: title.clientWidth, titleScroll: title.scrollWidth,
      content: rect(content), paddingLeft: parseFloat(padding.paddingLeft), paddingRight: parseFloat(padding.paddingRight),
    };
  }, listing);
}

function inside(inner, outer, name) {
  expect.soft(inner.width, `${name} has width`).toBeGreaterThan(0);
  expect.soft(inner.left, `${name} left`).toBeGreaterThanOrEqual(outer.left - 1);
  expect.soft(inner.right, `${name} right`).toBeLessThanOrEqual(outer.right + 1);
  expect.soft(inner.top, `${name} top`).toBeGreaterThanOrEqual(outer.top - 1);
  expect.soft(inner.bottom, `${name} bottom`).toBeLessThanOrEqual(outer.bottom + 1);
}

function separate(a, b, name) {
  const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  expect.soft(overlapX <= 1 || overlapY <= 1, `${name} do not overlap`).toBe(true);
}

for (const path of ['/rooms', '/favorites', '/my-listings']) {
  test(`unbroken card title: ${path}`, async ({ page, environment }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await titleFixture(page); await signIn(page, environment);
    await page.goto(path);
    const listing = path === '/my-listings';
    const card = listing ? page.locator('#listing-1') : page.locator('.room-card').filter({ has: page.locator('#room-card-1') });
    const title = card.getByRole('heading', { name: longTitle, exact: true });
    await expect(title).toBeVisible(); await page.evaluate(() => document.fonts.ready);
    expect(await title.textContent()).toBe(longTitle);
    if (!listing) await expect(card.getByRole('link')).toHaveAccessibleName(`ดูห้อง ${longTitle}`);
    else await expect(card.getByRole('button', { name: `ลบ ${longTitle}`, exact: true })).toBeVisible();
    await card.scrollIntoViewIfNeeded(); await page.mouse.move(0, 0);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const geometry = await cardGeometry(card, listing);
    await testInfo.attach('card-geometry', { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
    await capture(page, testInfo, `unbroken-${path.slice(1)}`);
    expect.soft(geometry.titleScroll, 'fixture really requires truncation').toBeGreaterThan(geometry.titleClient);
    expect.soft(geometry.titleStyle).toEqual({ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflowX: 'hidden' });
    for (const [name, box] of [['title', geometry.title], ['price', geometry.price], ['image', geometry.image], ...geometry.priceParts.map((box, i) => [`price part ${i}`, box]), ...geometry.controls.map((box, i) => [`button ${i}`, box])]) inside(box, geometry.card, name);
    separate(geometry.title, geometry.price, 'title and price');
    separate(geometry.title, geometry.image, 'title and image');
    separate(geometry.price, geometry.image, 'price and image');
    for (let i = 0; i < geometry.controls.length; i++) {
      separate(geometry.title, geometry.controls[i], 'title and button');
      separate(geometry.price, geometry.controls[i], 'price and button');
      for (let j = i + 1; j < geometry.controls.length; j++) separate(geometry.controls[i], geometry.controls[j], 'buttons');
    }
    if (!listing) {
      expect.soft(geometry.paddingLeft).toBeGreaterThan(0);
      expect.soft(geometry.paddingLeft).toBe(geometry.paddingRight);
      expect.soft(Math.abs(geometry.title.left - geometry.content.left - geometry.paddingLeft)).toBeLessThanOrEqual(1);
      expect.soft(Math.abs(geometry.content.right - geometry.title.right - geometry.paddingRight)).toBeLessThanOrEqual(1);
    }
    for (const button of await card.getByRole('button').all()) await reachable(button);
    await noOverflow(page);
    if (!listing) await card.getByRole('link').click();
    else await card.getByRole('button', { name: /^(ดูรายละเอียดดู|ดูรายละเอียด|ดู)$/ }).click();
    await expect(page).toHaveURL(/\/rooms\/1$/);
    const fullTitle = page.getByRole('heading', { level: 1, name: longTitle, exact: true });
    await expect(fullTitle).toBeVisible();
    expect(await fullTitle.textContent()).toBe(longTitle);
    expect(await fullTitle.evaluate(element => getComputedStyle(element).whiteSpace)).not.toBe('nowrap');
    await noOverflow(page);
  });
}
