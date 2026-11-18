import { test, expect, signIn, noOverflow, reachable, capture, selectPersonalListFilter } from './fixtures.mjs';
import { seedPersonalPagination } from '../support/personal-pagination-fixture.mjs';

test.beforeEach(async ({ environment }) => { await seedPersonalPagination(environment.db); });
test.afterEach(async ({ environment }) => { await environment.db.prepare("DELETE FROM ROOM WHERE description LIKE 'Private pagination%'").run(); });

const pagination = page => page.getByRole('navigation', { name: 'แบ่งหน้ารายการห้อง' });
const nextButton = page => pagination(page).getByRole('button', { name: 'ถัดไป', exact: true });
const titleInput = page => page.locator('[name=title]');

test('My Listings filters stay on the list during apply, reset and repeated clicks', async ({ page, environment }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page, environment, 'owner');
  const original = '/my-listings?q=Private+pagination&page=2';
  await page.goto(original);
  const cards = page.locator('.my-listing');
  await expect(cards).toHaveCount(10);

  const paths = [], writes = [], reads = [], detailReads = [];
  await page.evaluate(() => {
    window.filterFormSubmits = 0;
    document.addEventListener('submit', () => { window.filterFormSubmits++; }, true);
  });
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) paths.push(new URL(frame.url()).pathname);
  });
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(url.pathname);
    if (url.pathname === '/api/my/rooms') reads.push(url.searchParams);
    if (/^\/api\/rooms\/\d+$/.test(url.pathname)) detailReads.push(url.pathname);
  });
  const trigger = page.getByRole('button', { name: /^ตัวกรอง/ });
  const compact = await trigger.isVisible();
  const sheet = page.getByRole('dialog', { name: 'ตัวกรองประกาศของฉัน' });
  const fields = compact ? sheet : page.locator('.my-listings-header');
  const status = fields.getByRole('combobox', { name: 'กรองสถานะ' });
  const apply = sheet.getByRole('button', { name: 'ใช้ตัวกรอง' });
  const reset = sheet.getByRole('button', { name: 'ล้างตัวกรอง' });
  const close = sheet.getByRole('button', { name: 'ปิด', exact: true });
  if (compact) {
    await trigger.click();
    await expect(close).toBeFocused();
    await status.selectOption('inactive');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(page).toHaveURL(new URL(original, environment.baseURL).href);
    await trigger.click();
    await expect(status).toHaveValue('');
    await close.click();
    await expect(trigger).toBeFocused();
    await trigger.click();
  } else {
    await status.click();
  }
  await status.selectOption('available');
  if (compact) await apply.click();
  else await page.keyboard.press('Escape');
  const url = new URL('/my-listings?q=Private+pagination&status=available', environment.baseURL);
  await expect(page).toHaveURL(url.href);
  await expect(cards).toHaveCount(10);
  await expect(cards.locator('.status')).toHaveText(Array(10).fill('ว่าง'));

  const repeatOverEdit = async button => {
    const box = await button.boundingBox();
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const edit = cards.first().getByRole('button', { name: 'แก้ไข', exact: true });
    const aligned = await edit.evaluate((element, { x, y }) => {
      Object.assign(element.style, {
        position: 'fixed', left: `${x - 30}px`, top: `${y - 22}px`,
        zIndex: '60', width: '60px', height: '44px',
      });
      const stack = document.elementsFromPoint(x, y);
      return stack.includes(element) && Boolean(stack[0]?.closest('.filter-sheet footer'));
    }, point);
    expect(aligned, 'the edit action must be directly underneath the clicked footer').toBe(true);
    await page.mouse.dblclick(point.x, point.y, { delay: 20 });
    await expect(sheet).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await edit.evaluate(element => element.removeAttribute('style'));
  };
  if (compact) {
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(status).toHaveValue('available');
    await repeatOverEdit(apply);
    await expect(page).toHaveURL(url.href);
    await nextButton(page).click();
    const secondPage = new URL(url);
    secondPage.searchParams.set('page', '2');
    await expect(page).toHaveURL(secondPage.href);
    await expect(cards).toHaveCount(10);
    await trigger.click();
    await expect(status).toHaveValue('available');
    await reset.click();
    await expect(trigger).toBeFocused();
  } else {
    await status.click();
    await status.selectOption('');
    await page.keyboard.press('Escape');
  }
  url.searchParams.delete('status');
  await expect(page).toHaveURL(url.href);
  await expect(cards).toHaveCount(10);
  if (compact) {
    await trigger.click();
    await expect(status).toHaveValue('');
    await expect(fields.getByRole('combobox', { name: 'เรียงตาม' })).toHaveValue('newest');
    await repeatOverEdit(reset);
  } else {
    await expect(status).toHaveValue('');
  }
  await page.waitForTimeout(250);
  const expectedReads = compact ? [['1', 'available'], ['2', 'available'], ['1', null]] : [['1', 'available'], ['1', null]];
  expect(reads.map(query => [query.get('page'), query.get('status')])).toEqual(expectedReads);
  expect(paths).toEqual(expectedReads.map(() => '/my-listings'));
  expect(writes).toEqual([]);
  expect(detailReads).toEqual([]);
  expect(await page.evaluate(() => window.filterFormSubmits)).toBe(0);
  if (compact) {
    await cards.first().getByRole('button', { name: /^ดู/ }).click();
    await expect(page).toHaveURL(/\/rooms\/\d+$/);
    await page.getByRole('button', { name: 'กลับไปประกาศของฉัน', exact: true }).click();
    await expect(page).toHaveURL(url.href);
    await cards.first().getByRole('button', { name: 'แก้ไข', exact: true }).click();
    await expect(page).toHaveURL(/\/my-listings\/\d+\/edit$/);
    await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
    await expect(page).toHaveURL(url.href);
  }
});

for (const [path, endpoint, size, actor, selector] of [
  ['/favorites', '/api/favorites', 12, 'seeker', '.room-card'],
  ['/my-listings', '/api/my/rooms', 10, 'owner', '.my-listing'],
]) {
  const base = `${path}?q=Private+pagination`;
  const ready = async (page, number = 1, total = 125) => {
    const count = Math.min(size, total - (number-1)*size);
    await expect(page.locator(selector)).toHaveCount(Math.max(0,count));
    await expect(page.locator('.personal-list-toolbar > p')).toHaveCount(0);
    await expect(page.locator('.skeleton-region')).toHaveCount(0);
    expect(Number(new URL(page.url()).searchParams.get('page') || 1)).toBe(number);
  };

  test(`${path}: URL, refresh, history, detail return and responsive pagination`, async ({ page, environment }, testInfo) => {
    await signIn(page,environment,actor);
    await page.goto(base); await ready(page);
    await expect(pagination(page).getByRole('button', { name: 'ก่อนหน้า' })).toBeDisabled();
    await reachable(nextButton(page)); await nextButton(page).focus(); await page.keyboard.press('Enter');
    await ready(page,2); expect(new URL(page.url()).searchParams.get('page')).toBe('2');
    await page.reload(); await ready(page,2);
    const first = page.locator(selector).first();
    const title = await first.locator('h2').textContent();
    if (path === '/favorites') await first.locator('.room-card-link').click();
    else await first.getByRole('button', { name: /^(ดูรายละเอียดดู|ดูรายละเอียด|ดู)$/ }).click();
    await expect(page.locator('.gallery')).toBeVisible(); await page.reload();
    await page.getByRole('button', { name: path === '/favorites' ? 'กลับไปห้องโปรด' : 'กลับไปประกาศของฉัน' }).click();
    await ready(page,2); await expect(page.locator(selector).first().locator('h2')).toHaveText(title);
    await nextButton(page).click(); await ready(page,3);
    await page.goBack(); await ready(page,2);
    await page.goForward(); await ready(page,3);
    await reachable(nextButton(page)); await noOverflow(page);
    if (page.viewportSize().width <= 640) {
      await expect(pagination(page).locator('.pagination-mobile')).toHaveText(`หน้า 3 จาก ${Math.ceil(125/size)}`);
      const nav = await page.locator('.mobile-nav').boundingBox();
      const button = await nextButton(page).boundingBox();
      if (nav) expect(button.y+button.height).toBeLessThanOrEqual(nav.y);
    } else {
      await expect(pagination(page).locator('[aria-current=page]')).toHaveText('3');
      await expect(pagination(page).locator('.pagination-desktop')).toContainText('…');
    }
    await capture(page,testInfo,`personal-pagination-${actor}`);
  });

  test(`${path}: status and sort reset page; oversized page corrects once`, async ({ page, environment }) => {
    await signIn(page,environment,actor);
    await page.goto(`${base}&page=3`); await ready(page,3);
    await selectPersonalListFilter(page, 'กรองสถานะ', 'available');
    await ready(page,1,42); expect(new URL(page.url()).searchParams.has('page')).toBe(false);
    await nextButton(page).click(); await ready(page,2,42);
    await selectPersonalListFilter(page, 'เรียงตาม', 'price_desc');
    await ready(page,1,42); expect(new URL(page.url()).searchParams.get('status')).toBe('available');
    expect(new URL(page.url()).searchParams.has('page')).toBe(false);
    let requests=0;
    page.on('request', request => { if (new URL(request.url()).pathname === endpoint && request.method()==='GET') requests++; });
    await page.goto(`${base}&page=999`); await ready(page,Math.ceil(125/size));
    await expect(nextButton(page)).toBeDisabled();
    await page.waitForTimeout(400); expect(requests).toBe(1);
  });

  test(`${path}: last item removal clamps without loops; zero state and mutation lock`, async ({ page, environment }) => {
    const db=environment.db;
    const fixtures=await db.prepare("SELECT room_id FROM ROOM WHERE description LIKE 'Private pagination%' ORDER BY room_id").all();
    const ids=fixtures.map(row=>row.room_id);
    const keepIds=ids.slice(0,size+1);
    if (path === '/favorites') await db.prepare('DELETE FROM ROOM_FAVORITE WHERE user_id=3 AND room_id=ANY(?::bigint[]) AND room_id<>ALL(?::bigint[])').run(ids,keepIds);
    else await db.prepare('DELETE FROM ROOM WHERE room_id=ANY(?::bigint[]) AND room_id<>ALL(?::bigint[])').run(ids,keepIds);
    await signIn(page,environment,actor);
    await page.goto(`${base}&page=2`); await ready(page,2,size+1);
    let deletes=0, reads=0;
    page.on('request', request => {
      if (request.method()==='DELETE') deletes++;
      if (new URL(request.url()).pathname===endpoint && request.method()==='GET') reads++;
    });
    const remove = async () => {
      if (path === '/favorites') await page.locator('.favorite-button').last().evaluate(button=>{button.click();button.click();});
      else {
        await page.locator('.delete-action').last().click();
        await page.getByRole('dialog').getByRole('button', { name: 'ลบประกาศ', exact: true }).evaluate(button=>{button.click();button.click();});
      }
    };
    await remove(); await ready(page,1,size);
    await page.waitForTimeout(400); expect(deletes).toBe(1); expect(reads).toBe(1);
    expect(new URL(page.url()).searchParams.has('page')).toBe(false);
    await expect(pagination(page)).toHaveCount(0);
    if (path === '/favorites') {
      const remaining = await db.prepare('SELECT room_id FROM ROOM_FAVORITE WHERE user_id=3 AND room_id=ANY(?::bigint[]) ORDER BY room_id LIMIT 1').get(keepIds);
      await db.prepare('DELETE FROM ROOM_FAVORITE WHERE user_id=3 AND room_id=ANY(?::bigint[]) AND room_id!=?').run(ids, remaining.room_id);
    } else {
      await db.prepare('DELETE FROM ROOM WHERE room_id=ANY(?::bigint[]) AND room_id!=?').run(ids, keepIds[0]);
    }
    await page.reload(); await ready(page,1,1);
    await remove(); await ready(page,1,0);
    await expect(page.locator('.empty-state')).toBeVisible(); await expect(pagination(page)).toHaveCount(0);
  });

  test(`${path}: late page response cannot overwrite a newer page or account`, async ({ page, environment }) => {
    await signIn(page,environment,actor);
    let release, started;
    let gate=new Promise(resolve=>{release=resolve;});
    let waiting=new Promise(resolve=>{started=resolve;});
    await page.route(`**${endpoint}?**`,async route=>{
      if(new URL(route.request().url()).searchParams.get('page')!=='2' || route.request().headers().authorization!==`Bearer ${environment.tokens[actor]}`)return route.continue();
      const response=await route.fetch(); started(); await gate; await route.fulfill({response});
    });
    try {
      await page.goto(base); await ready(page);
      const first=await page.locator(selector).first().locator('h2').textContent();
      await nextButton(page).click(); await waiting;
      await expect(nextButton(page)).toBeDisabled();
      await page.goBack(); await ready(page);
      release(); await page.waitForTimeout(400);
      await ready(page); await expect(page.locator(selector).first().locator('h2')).toHaveText(first);
      gate=new Promise(resolve=>{release=resolve;});
      waiting=new Promise(resolve=>{started=resolve;});
      await nextButton(page).click(); await waiting;
      // Real storage event remounts protected pages for the other account.
      await page.evaluate(token=>{localStorage.setItem('roommatch:token',token);window.dispatchEvent(new StorageEvent('storage',{key:'roommatch:token',storageArea:localStorage}));},environment.tokens.empty);
      await expect(page.locator('.personal-list-toolbar > p')).toHaveCount(0);
      await expect(page.locator('.skeleton-region')).toHaveCount(0);
      await expect(page.locator(selector)).toHaveCount(0);
      release(); await page.waitForTimeout(400);
      await expect(page.locator(selector)).toHaveCount(0);
    } finally {release();}
  });
}

test('edit back/cancel/save preserve the source query for Rooms, Favorites and My Listings', async ({ page,environment }) => {
  await signIn(page,environment,'owner');
  for (const [path, selector, count, backName] of [
    ['/my-listings', '.my-listing', 10, 'กลับไปประกาศของฉัน'],
    ['/favorites', '.room-card', 12, 'กลับไปห้องโปรด'],
    ['/rooms', '.room-card', 12, 'กลับไปดูห้องทั้งหมด'],
  ]) {
    const source = `${path}?q=Private+pagination&sort=price_asc&page=2`;
    if(path === '/favorites') await environment.db.prepare("INSERT INTO ROOM_FAVORITE(user_id,room_id) SELECT 1,room_id FROM ROOM WHERE description LIKE 'Private pagination%' ON CONFLICT DO NOTHING").run();
    await page.goto(source);
    await expect(page.locator(selector)).toHaveCount(count);
    await expect(page.locator('.personal-list-toolbar > p')).toHaveCount(0);
    const openEditor = async () => {
      if (path === '/my-listings') await page.locator(selector).first().getByRole('button', { name: /^ดู/ }).click();
      else await page.locator('.room-card-link').first().click();
      await page.getByRole('button', { name: 'แก้ไขประกาศของฉัน', exact: true }).click();
      await expect(titleInput(page)).toHaveValue(/Private pagination/);
    };
    await openEditor();
    await expect(titleInput(page)).toBeVisible(); await page.reload();
    await page.getByRole('button',{name:backName,exact:true}).click();
    await expect(page).toHaveURL(new URL(source,environment.baseURL).href);
    await openEditor();
    await page.getByRole('button',{name:'ยกเลิก',exact:true}).click();
    await expect(page).toHaveURL(new URL(source,environment.baseURL).href);
    await openEditor();
    await expect(titleInput(page)).toHaveValue(/Private pagination/);
    await titleInput(page).fill((await titleInput(page).inputValue())+' edited');
    await page.getByRole('button',{name:'บันทึกการแก้ไข',exact:true}).click();
    await expect(page).toHaveURL(new URL(source,environment.baseURL).href);
    await expect(page.locator(selector)).toHaveCount(count);
    await expect(page.locator('.personal-list-toolbar > p')).toHaveCount(0);
  }
});

test('My Listings status mutation clamps a filtered last page and then shows zero', async ({ page,environment }) => {
  const db=environment.db;
  const rows=await db.prepare("SELECT room_id FROM ROOM WHERE description LIKE 'Private pagination%' AND status='available' ORDER BY room_id LIMIT 11").all();
  await db.prepare("UPDATE ROOM SET status='inactive' WHERE description LIKE 'Private pagination%' AND room_id<>ALL(?::bigint[])").run(rows.map(row=>row.room_id));
  await signIn(page,environment,'owner');
  await page.goto('/my-listings?q=Private+pagination&status=available&page=2');
  await expect(page.locator('.my-listing')).toHaveCount(1);
  await page.getByRole('button',{name:'พักประกาศ',exact:true}).click();
  await expect(page.locator('.my-listing')).toHaveCount(10);
  await expect(page.locator('.personal-list-toolbar > p')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('page')).toBe(false);
  const remaining=await db.prepare("SELECT room_id FROM ROOM WHERE description LIKE 'Private pagination%' AND status='available' ORDER BY room_id LIMIT 1").get();
  await db.prepare("UPDATE ROOM SET status='inactive' WHERE description LIKE 'Private pagination%' AND room_id!=?").run(remaining.room_id);
  await page.reload(); await expect(page.locator('.my-listing')).toHaveCount(1);
  await page.getByRole('button',{name:'พักประกาศ',exact:true}).click();
  await expect(page.locator('.personal-list-toolbar > p')).toHaveCount(0);
  await expect(page.locator('.skeleton-region')).toHaveCount(0);
  await expect(page.locator('.empty-state')).toBeVisible();
});
