import { test, expect, signIn, noOverflow, reachable, imageHost } from './fixtures.mjs';
import { seedPaginationRooms } from '../support/room-pagination-fixture.mjs';

const widths = [...new Set([
  ...Array.from({ length: 57 }, (_, index) => 320 + index * 20),
  419, 420, 421, 639, 640, 641, 699, 700, 701, 766, 767, 768, 1023, 1024,
  // Half-width and unequal splits of a 1366px viewport (546px + 820px).
  546, 683, 1366,
])].sort((a, b) => a - b);
const resizeWidths = [...widths, ...widths.slice(0, -1).reverse()];

async function resize(page, width, height) {
  await page.setViewportSize({ width, height });
  // Measure after Chromium has applied media queries for the new viewport.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

const cardTest = test.extend({
  longRoom: async ({ environment }, use) => {
    const { db } = environment;
    const title = 'LongUnbrokenRoomTitle'.repeat(9);
    const { insertId: roomId } = await db.prepare(
      'INSERT INTO ROOM(owner_id, google_maps_url, price, capacity, description, locality) VALUES (1, ?, 2500, 2, ?, ?) RETURNING room_id',
    ).run('https://maps.google.com', title, 'LongUnbrokenAddress'.repeat(9));
    try {
      await db.prepare('INSERT INTO ROOM_IMAGE(room_id, image_url) VALUES (?, ?)')
        .run(roomId, `${imageHost}/responsive-room.svg`);
      await db.prepare('INSERT INTO ROOM_FAVORITE(user_id, room_id) VALUES (1, ?)').run(roomId);
      await use({ roomId, title });
    } finally {
      await db.prepare('DELETE FROM ROOM WHERE room_id=?').run(roomId);
    }
  },
});

for (const path of ['/rooms', '/favorites']) {
  cardTest(`room cards keep image and copy separate while resizing ${path}`, async ({ page, environment, longRoom }) => {
    test.slow();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signIn(page, environment);
    await page.goto(path);
    const card = page.locator('.room-card').filter({ has: page.locator(`#room-card-${longRoom.roomId}`) });
    await expect(card.getByRole('heading')).toHaveText(longRoom.title);
    await expect(card.locator('.room-card-image > img')).toBeVisible();
    for (const width of resizeWidths) {
      await resize(page, width, 760);
      const layout = await card.evaluate(element => {
        const rect = selector => element.querySelector(selector).getBoundingClientRect();
        const image = rect('.room-card-image');
        const copy = rect('.room-card-copy');
        const favorite = rect('.favorite-button');
        return {
          grid: element.parentElement.clientWidth,
          card: element.clientWidth,
          image: image.width,
          gap: copy.left - image.right,
          verticalGap: copy.top - image.bottom,
          favoriteInImage: favorite.left >= image.left && favorite.right <= image.right,
          textFits: [...element.querySelectorAll('h2, .location, .price, .room-card-meta')]
            .every(text => text.getBoundingClientRect().right <= copy.right + 1),
        };
      });
      const label = `${width}px: ${JSON.stringify(layout)}`;
      if (width <= 700) {
        expect.soft(layout.gap, label).toBeCloseTo(0, 0);
        expect.soft(layout.image, label).toBeCloseTo(width <= 420 ? 100 : 126, 0);
      } else {
        expect.soft(layout.verticalGap, label).toBeGreaterThanOrEqual(-1);
      }
      expect.soft(layout.favoriteInImage && layout.textFits, label).toBe(true);
      await noOverflow(page);
    }
    await page.setViewportSize({ width: 683, height: 760 });
    const favorite = card.locator('.favorite-button');
    await reachable(favorite);
    if (path === '/favorites') {
      await favorite.click();
      await expect(card).toHaveCount(0);
    }
  });
}

test('room filter stays inside the viewport while open on pages 1 and 2', async ({ page, environment }) => {
  test.slow(); // Resize in both directions with the sheet open on each route.
  await seedPaginationRooms(environment.db);
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signIn(page, environment);
    for (const path of ['/rooms', '/rooms?page=2']) {
      await page.setViewportSize({ width: 701, height: 390 });
      await page.goto(path);
      await expect(page.locator('.room-card').first()).toBeVisible();
      await expect(page).toHaveURL(environment.baseURL + path);
      await page.locator('.filter-button').click();
      const sheet = page.locator('.filter-sheet');
      const body = sheet.locator('.filter-scroll');
      for (const width of resizeWidths) {
        await resize(page, width, 390);
        const { x, y, width: panelWidth, height } = await sheet.boundingBox();
        const inset = width <= 700 ? 0 : 24;
        const label = `${path} at ${width}px: x=${x}, y=${y}, width=${panelWidth}, height=${height}`;
        expect.soft(x, label).toBeGreaterThanOrEqual(inset);
        expect.soft(x + panelWidth, label).toBeLessThanOrEqual(width - inset);
        expect.soft(y, label).toBeGreaterThanOrEqual(0);
        expect.soft(y + height, label).toBeLessThanOrEqual(390);
        await noOverflow(page);
      }
      await page.setViewportSize({ width: 701, height: 390 });
      const scrollTop = await body.evaluate(element => {
        element.scrollTop = element.scrollHeight;
        return element.scrollTop;
      });
      expect(scrollTop).toBeGreaterThan(0);
      const close = sheet.locator('header button');
      const [reset, apply] = await sheet.locator('footer button').all();
      await reachable(close);
      await sheet.locator('input').first().fill('1000');
      await reset.click();
      await expect(sheet.locator('input').first()).toHaveValue('');
      if (path === '/rooms') {
        await close.click();
      } else {
        await sheet.locator('input').first().fill('1000');
        await apply.click();
        await expect(page).toHaveURL(/minPrice=1000/);
        expect(new URL(page.url()).searchParams.has('page')).toBe(false);
      }
      await expect(sheet).toBeHidden();
    }
  } finally {
    await environment.db.prepare("DELETE FROM ROOM WHERE description LIKE 'RM12 fixture %'").run();
  }
});
