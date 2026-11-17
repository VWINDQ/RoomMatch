import { test, expect, signIn, noOverflow, reachable, capture } from './fixtures.mjs';
import { seedPersonalPagination } from '../support/personal-pagination-fixture.mjs';

test.beforeEach(async ({ environment }) => { await seedPersonalPagination(environment.db); });
test.afterEach(async ({ environment }) => { await environment.db.prepare("DELETE FROM ROOM WHERE description LIKE 'Private pagination%'").run(); });

const pagination = page => page.getByRole('navigation', { name: 'แบ่งหน้ารายการห้อง' });
const nextButton = page => pagination(page).getByRole('button', { name: 'ถัดไป', exact: true });
const titleInput = page => page.locator('[name=title]');

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
    await page.getByRole('combobox', { name: 'กรองสถานะ' }).selectOption('available');
    await ready(page,1,42); expect(new URL(page.url()).searchParams.has('page')).toBe(false);
    await nextButton(page).click(); await ready(page,2,42);
    await page.getByRole('combobox', { name: 'เรียงตาม', exact: true }).selectOption('price_desc');
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
    const keep=keepIds[0];
    if (path==='/favorites') await db.prepare('DELETE FROM ROOM_FAVORITE WHERE user_id=3 AND room_id=ANY(?::bigint[]) AND room_id!=?').run(ids,keep);
    else await db.prepare('DELETE FROM ROOM WHERE room_id=ANY(?::bigint[]) AND room_id!=?').run(ids,keep);
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

test('edit back/cancel/save preserve the source query, including favorites → detail → edit', async ({ page,environment }) => {
  await signIn(page,environment,'owner');
  for(const source of ['/my-listings?q=Private+pagination&sort=price_asc&page=2','/favorites?q=Private+pagination&sort=price_asc&page=2']) {
    if(source.startsWith('/favorites')) await environment.db.prepare("INSERT INTO ROOM_FAVORITE(user_id,room_id) SELECT 1,room_id FROM ROOM WHERE description LIKE 'Private pagination%' ON CONFLICT DO NOTHING").run();
    await page.goto(source);
    await expect(page.locator(source.startsWith('/favorites') ? '.room-card' : '.my-listing')).toHaveCount(source.startsWith('/favorites') ? 12 : 10);
    await expect(page.locator('.personal-list-toolbar > p')).toHaveCount(0);
    const openEditor = async () => {
      if(source.startsWith('/favorites')) {
        await page.locator('.room-card-link').first().click();
        await page.getByRole('button',{name:'แก้ไขประกาศของฉัน',exact:true}).click();
      } else await page.locator('.my-listing').first().getByRole('button',{name:'แก้ไข',exact:true}).click();
      await expect(titleInput(page)).toHaveValue(/Private pagination/);
    };
    await openEditor();
    await expect(titleInput(page)).toBeVisible(); await page.reload();
    const backName=source.startsWith('/favorites')?'กลับไปห้องโปรด':'กลับไปประกาศของฉัน';
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
    await expect(page.locator(source.startsWith('/favorites') ? '.room-card' : '.my-listing')).toHaveCount(source.startsWith('/favorites') ? 12 : 10);
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
