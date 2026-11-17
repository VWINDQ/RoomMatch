import { test, expect, signIn, capture } from './fixtures.mjs';
import { seedPersonalPagination } from '../support/personal-pagination-fixture.mjs';

const cases = [
  ['/rooms', '/api/rooms', 'seeker', '.room-card', 12],
  ['/favorites', '/api/favorites', 'seeker', '.room-card', 12],
  ['/my-listings', '/api/my/rooms', 'owner', '.my-listing', 10],
];
test.beforeEach(async ({ environment }) => { await seedPersonalPagination(environment.db); });
test.afterEach(async ({ environment }) => { await environment.db.prepare("DELETE FROM ROOM WHERE description LIKE 'Private pagination%'").run(); });

function installScrollRecorder() {
    window.__listScrollCalls = [];
    if (window.__listScrollRecording) return;
    window.__listScrollRecording = true;
    const originalWindow = window.scrollTo.bind(window);
    window.scrollTo = (...args) => { window.__listScrollCalls.push({ target: 'window', options: args[0] }); originalWindow(...args); };
    const originalElement = HTMLElement.prototype.scrollTo;
    HTMLElement.prototype.scrollTo = function (...args) {
      window.__listScrollCalls.push({ target: this.className, options: args[0] });
      return originalElement.apply(this, args);
    };
}
const observeScroll = page => page.evaluate(installScrollRecorder);
async function ready(page,selector,size,pageNumber=1) {
  await expect(page.locator(selector)).toHaveCount(size);
  if (new URL(page.url()).pathname === '/rooms') await expect(page.locator('.list-toolbar p')).toHaveText(/^พบ \d+ ห้อง$/);
  else await expect(page.locator('.list-toolbar p')).toHaveCount(0);
  expect(Number(new URL(page.url()).searchParams.get('page') || 1)).toBe(pageNumber);
  await expect(page.locator('.skeleton-region')).toHaveCount(0);
}
const clearScroll = page => page.evaluate(() => { window.__listScrollCalls = []; });
const calls = page => page.evaluate(() => window.__listScrollCalls);
const next = page => page.locator('.room-pagination').getByRole('button', { name: 'ถัดไป', exact: true });
const previous = page => page.locator('.room-pagination').getByRole('button', { name: 'ก่อนหน้า', exact: true });
async function bottom(page) {
  await next(page).scrollIntoViewIfNeeded();
  expect((await page.locator('.list-toolbar').boundingBox()).y).toBeLessThan(-50);
  await clearScroll(page);
}
async function atListStart(page) {
  await expect.poll(() => page.locator('.list-toolbar').evaluate(node => {
    const header = document.querySelector('.compact-header');
    const covered = header && /fixed|sticky/.test(getComputedStyle(header).position) ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
    return Math.abs(node.getBoundingClientRect().top - covered - 16);
  })).toBeLessThan(3);
}

for (const [path, endpoint, actor, selector, size] of cases) {
  const url = `${path}?q=Private+pagination`;
  async function open(page, environment, suffix = '') {
    await signIn(page, environment, actor);
    await page.goto(url + suffix);
    await ready(page,selector,size);
    await observeScroll(page);
  }

  test(`${path}: explicit next/previous/numbers scroll only after success, preserve focus and reduced motion`, async ({ page, environment }, testInfo) => {
    await open(page, environment);
    if (page.viewportSize().width < 1024) await page.addStyleTag({ content: '.compact-header { position: sticky; top: 0; z-index: 50; }' });
    await bottom(page);
    let requests = 0;
    page.on('request', request => { if (new URL(request.url()).pathname === endpoint) requests++; });
    await previous(page).focus(); await page.keyboard.press('Enter');
    await expect(previous(page)).toBeDisabled();
    expect(requests).toBe(0); expect(await calls(page)).toEqual([]);
    await next(page).focus(); await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/page=2/);
    await ready(page,selector,size,2);
    await atListStart(page);
    await expect(next(page)).toBeFocused();
    expect(await calls(page)).toHaveLength(1);
    expect((await calls(page))[0].options.behavior).toBe('smooth');
    await capture(page, testInfo, `${path.slice(1)}-pagination-scroll`);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await bottom(page); await previous(page).click();
    await expect(page).not.toHaveURL(/page=/);
    await ready(page,selector,size);
    await atListStart(page);
    await expect(previous(page)).toBeFocused();
    expect(await calls(page)).toHaveLength(1);
    expect((await calls(page))[0].options.behavior).toBe('instant');
    if (page.viewportSize().width > 640) {
      await bottom(page);
      await page.getByRole('button', { name: 'หน้า 2', exact: true }).click();
      await expect(page).toHaveURL(/page=2/); await atListStart(page);
      await expect(page.getByRole('button',{name:'หน้า 2',exact:true})).toBeFocused();
      expect(await calls(page)).toHaveLength(1);
    }
  });

  test(`${path}: history, data reload, filters and detail return do not inherit a pagination scroll`, async ({ page, environment }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, environment);
    await bottom(page); await next(page).click(); await atListStart(page);
    await bottom(page);
    await page.goBack(); await expect(page).not.toHaveURL(/page=/);
    await ready(page,selector,size);
    expect(await calls(page)).toEqual([]);
    await page.goForward(); await expect(page).toHaveURL(/page=2/);
    await ready(page,selector,size,2);
    expect(await calls(page)).toEqual([]);

    // Filter changes reset page, but are not pagination actions.
    if (path !== '/rooms') {
      await page.getByRole('combobox', { name: 'เรียงตาม', exact: true }).selectOption('price_asc');
      await expect(page).not.toHaveURL(/page=/);
      await ready(page,selector,size);
      expect(await calls(page)).toEqual([]);
    }
    const card = page.locator(selector).last();
    await card.scrollIntoViewIfNeeded();
    if (path === '/my-listings') await card.getByRole('button', { name: /^ดู/ }).click();
    else await card.locator('.room-card-link').click();
    await expect(page.locator('.gallery')).toBeVisible(); await clearScroll(page);
    await page.locator('.back-link').click();
    await expect(page.locator(selector)).toHaveCount(size);
    await expect(page.locator('.skeleton-region')).toHaveCount(0);
    // Existing route focus/scroll restoration may scroll to zero, never request
    // our list-header offset. It must remain independent of pagination.
    expect((await calls(page)).filter(call => call.options?.top > 0)).toEqual([]);
    await bottom(page); await clearScroll(page);
    await page.addInitScript(installScrollRecorder);
    await page.reload();
    await expect(page.locator(selector)).toHaveCount(size);
    await expect(page.locator('.skeleton-region')).toHaveCount(0);
    expect((await calls(page)).filter(call => call.options?.top > 0)).toEqual([]);
  });

  test(`${path}: failed and obsolete responses cannot scroll, including retry`, async ({ page, environment }) => {
    await open(page, environment);
    let release, started;
    let delayedRequests = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const waiting = new Promise(resolve => { started = resolve; });
    await page.route(`**${endpoint}?**`, async route => {
      if (new URL(route.request().url()).searchParams.get('page') !== '2') return route.continue();
      delayedRequests++;
      const response = await route.fetch(); started(); await gate; await route.fulfill({ response });
    });
    try {
      await bottom(page);
      await next(page).evaluate(button => { button.click(); button.click(); }); await waiting;
      await expect(next(page)).toBeDisabled();
      await next(page).evaluate(button => button.click());
      expect(delayedRequests).toBe(1);
      expect(await calls(page)).toEqual([]);
      await page.goBack(); await expect(page.locator(selector)).toHaveCount(size);
      release(); await page.waitForTimeout(350);
      expect(await calls(page)).toEqual([]);
    } finally { release(); }
    await page.unroute(`**${endpoint}?**`);
    await page.route(`**${endpoint}?**`, route => new URL(route.request().url()).searchParams.get('page') === '2'
      ? route.fulfill({ status: 503, json: { error: 'Service temporarily unavailable' } }) : route.continue());
    await bottom(page); await next(page).click(); await expect(page.locator('.empty-state')).toBeVisible();
    expect(await calls(page)).toEqual([]);
    await page.unroute(`**${endpoint}?**`);
    await page.getByRole('button', { name: 'ลองอีกครั้ง', exact: true }).click();
    await expect(page.locator(selector)).toHaveCount(size);
    expect(await calls(page)).toEqual([]);
  });

  test(`${path}: favorite/status mutations and automatic page correction do not scroll the list header`, async ({ page, environment }) => {
    await open(page, environment);
    await bottom(page);
    const mutation = page.waitForResponse(response => ['PUT','DELETE','PATCH'].includes(response.request().method()));
    const refreshed = path === '/rooms' ? null : page.waitForResponse(response => new URL(response.url()).pathname === endpoint && response.request().method()==='GET');
    if (path === '/my-listings') {
      await page.locator('.status-toggle').last().click();
    } else await page.locator('.favorite-button').last().click();
    await mutation;
    if(refreshed) await refreshed;
    await expect(page.locator('.toast')).toBeVisible();
    await expect(page.locator('.skeleton-region')).toHaveCount(0);
    await expect(page.locator(selector)).toHaveCount(size);
    expect(await calls(page)).toEqual([]);

    // Simulate a shrinking final page in the isolated schema, then refresh that
    // out-of-range URL. The correction is not an explicit pager click.
    await environment.db.prepare("DELETE FROM ROOM WHERE description LIKE 'Private pagination%' AND room_id NOT IN (SELECT room_id FROM ROOM WHERE description LIKE 'Private pagination%' ORDER BY room_id LIMIT 20)").run();
    await page.addInitScript(installScrollRecorder);
    await page.goto(url + '&page=99');
    await expect(page).not.toHaveURL(/page=99/);
    await expect(page.locator('.skeleton-region')).toHaveCount(0);
    expect((await calls(page)).filter(call => call.options?.top > 0)).toEqual([]);

    if(path!=='/rooms') {
      const db=environment.db;
      const response=await page.request.get(`${endpoint}?q=Private+pagination`,{headers:{Authorization:`Bearer ${environment.tokens[actor]}`}});
      const keep=(await response.json()).rooms.slice(0,size+1).map(room=>room.roomId);
      if(path==='/favorites') await db.prepare("DELETE FROM ROOM_FAVORITE WHERE user_id=3 AND room_id IN (SELECT room_id FROM ROOM WHERE description LIKE 'Private pagination%') AND room_id<>ALL(?::bigint[])").run(keep);
      else await db.prepare("DELETE FROM ROOM WHERE description LIKE 'Private pagination%' AND room_id<>ALL(?::bigint[])").run(keep);
      await page.goto(url+'&page=2'); await expect(page.locator(selector)).toHaveCount(1);
      await clearScroll(page);
      const reloaded=page.waitForResponse(response=>new URL(response.url()).pathname===endpoint&&response.request().method()==='GET');
      if(path==='/favorites') await page.locator('.favorite-button').click();
      else {
        await page.locator('.delete-action').click();
        await page.getByRole('dialog').getByRole('button',{name:'ลบประกาศ',exact:true}).click();
      }
      await reloaded; await ready(page,selector,size);
      expect(new URL(page.url()).searchParams.has('page')).toBe(false);
      expect(await calls(page)).toEqual([]);
    }
  });
}
