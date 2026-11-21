import { randomBytes } from 'node:crypto';
import { test, expect, signIn, noOverflow, reachable, capture, selectPersonalListFilter } from './fixtures.mjs';
import { seedPersonalPagination } from '../support/personal-pagination-fixture.mjs';
import { hashPassword, createToken } from '../../server/auth.js';

const personalCases = [
  { path: '/favorites', endpoint: '/api/favorites', size: 12, selector: '.room-card', unit: 'ห้อง' },
  { path: '/my-listings', endpoint: '/api/my/rooms', size: 10, selector: '.my-listing', unit: 'ประกาศ' },
];

async function prepare(page, environment, testInfo, count) {
  const hash = await hashPassword(randomBytes(24).toString('hex'));
  const owner = await environment.db.prepare('INSERT INTO USER(first_name,last_name,email,password_hash,profile_reminder_seen_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP) RETURNING user_id')
    .run('Boundary', 'Fixture', `boundary-${randomBytes(8).toString('hex')}@example.test`, hash);
  testInfo.boundaryOwnerId = owner.insertId;
  const rooms = await seedPersonalPagination(environment.db, count, { ownerId: owner.insertId, favoriteUserId: owner.insertId });
  const token = createToken(owner.insertId);
  await signIn(page, { tokens: { owner: token } });
  return { rooms, headers: { Authorization: `Bearer ${token}` } };
}

test.afterEach(async ({ environment }, testInfo) => {
  if (!testInfo.boundaryOwnerId) return;
  await environment.db.prepare('DELETE FROM ROOM WHERE owner_id=?').run(testInfo.boundaryOwnerId);
  await environment.db.prepare('DELETE FROM USER WHERE user_id=?').run(testInfo.boundaryOwnerId);
});

for (const item of personalCases) {
  test(`${item.path} filtered total hides all controls, resets page, survives history and refresh`,async ({page,environment},testInfo)=>{
    const count=2*item.size+1;
    const {rooms,headers}=await prepare(page,environment,testInfo,count);
    await page.goto(`${item.path}?page=3`);
    await expect(page.locator(item.selector)).toHaveCount(1);
    await selectPersonalListFilter(page, 'กรองสถานะ', 'available');
    const expected=rooms.filter(room=>room.status==='available').length;
    await expect(page.locator(item.selector)).toHaveCount(expected);
    await expect(page.locator('.room-pagination')).toHaveCount(0);
    await expect(page.locator('.pagination-mobile')).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has('page')).toBe(false);
    const response=await page.request.get(`${item.endpoint}?page=1&pageSize=${item.size}&status=available`,{headers});
    const body=await response.json();
    expect(body.total).toBe(expected);expect(body.totalPages).toBe(1);expect(body.rooms).toHaveLength(expected);
    await page.reload();await expect(page.locator(item.selector)).toHaveCount(expected);
    await expect(page.locator('.room-pagination')).toHaveCount(0);
    await page.goBack();await expect(page.locator(item.selector)).toHaveCount(1);
    await expect(page.locator('.room-pagination')).toHaveCount(1);
    await page.goForward();await expect(page.locator(item.selector)).toHaveCount(expected);
    await expect(page.locator('.room-pagination')).toHaveCount(0);

    await page.goBack();
    await expect(page.locator('.room-pagination')).toHaveCount(1);
    await environment.db.prepare("DELETE FROM ROOM WHERE owner_id=? AND status='inactive'").run(testInfo.boundaryOwnerId);
    await selectPersonalListFilter(page, 'กรองสถานะ', 'inactive');
    await expect(page).toHaveURL(new URL(`${item.path}?status=inactive`, environment.baseURL).href);
    await expect(page.locator('.empty-state')).toBeVisible();
    await expect(page.locator(item.selector)).toHaveCount(0);
    await expect(page.locator('.room-pagination')).toHaveCount(0);
    const emptyResponse = await page.request.get(`${item.endpoint}?page=1&pageSize=${item.size}&status=inactive`, { headers });
    expect(await emptyResponse.json()).toMatchObject({ total: 0, totalPages: 0, rooms: [] });
  });
  test(`${item.path} rejects a pageSize above its fixed personal-list maximum`, async ({ page,environment },testInfo) => {
    const { headers }=await prepare(page,environment,testInfo,item.size+1);
    const response=await page.request.get(`${item.endpoint}?page=1&pageSize=${item.size+1}`,{headers});
    expect(response.status()).toBe(400);
  });
  for (const count of [0, 1, item.size-1, item.size, item.size+1, item.size*2, item.size*2+1]) {
    test(`${item.path} boundary ${count}: SQL/API metadata matches actual browser cards`, async ({ page, environment }, testInfo) => {
      const { rooms, headers } = await prepare(page,environment,testInfo,count);
      const network = [];
      page.on('response', async response => {
        const url = new URL(response.url());
        if (url.pathname !== item.endpoint) return;
        const body = await response.json();
        network.push({ requested: Object.fromEntries(url.searchParams), page: body.page, pageSize: body.pageSize,
          total: body.total, totalPages: body.totalPages, items: body.rooms?.length });
      });
      const totalPages = Math.ceil(count/item.size);
      const ids = [];
      // A URL pageSize must never override the page's fixed size.
      await page.goto(`${item.path}?pageSize=100`);
      for (let pageNumber=1; pageNumber<=Math.max(1,totalPages); pageNumber++) {
        const expected = Math.min(item.size, Math.max(0,count-(pageNumber-1)*item.size));
        const api = await page.request.get(`${item.endpoint}?page=${pageNumber}&pageSize=${item.size}`, { headers });
        expect(api.status()).toBe(200);
        const body = await api.json();
        expect(body).toMatchObject({ page: pageNumber, pageSize: item.size, total: count, totalPages });
        expect(body.rooms).toHaveLength(expected);
        expect(body.rooms.length).toBeLessThanOrEqual(item.size);
        await expect(page.locator(item.selector)).toHaveCount(expected);
        await expect(page.locator('.personal-list-toolbar > p')).toHaveCount(0);
        const domIds = await page.locator(item.selector).evaluateAll((cards, favorites) => cards.map(card => favorites
          ? card.querySelector('.room-card-link').id.replace('room-card-','') : card.id.replace('listing-','')), item.path==='/favorites');
        expect(domIds).toEqual(body.rooms.map(room=>String(room.roomId)));
        ids.push(...domIds);
        await expect(page.locator('.room-pagination')).toHaveCount(totalPages>1 ? 1 : 0);
        if (totalPages<=1) {
          await expect(page.locator('.pagination-mobile')).toHaveCount(0);
          await expect(page.getByRole('button',{name:'ก่อนหน้า',exact:true})).toHaveCount(0);
          await expect(page.getByRole('button',{name:'ถัดไป',exact:true})).toHaveCount(0);
        } else {
          await expect(page.getByRole('button',{name:'ก่อนหน้า',exact:true})).toBeEnabled({ enabled: pageNumber>1 });
          await expect(page.getByRole('button',{name:'ถัดไป',exact:true})).toBeEnabled({ enabled: pageNumber<totalPages });
        }
        if(pageNumber<totalPages) await page.getByRole('button',{name:'ถัดไป',exact:true}).click();
      }
      expect(new Set(ids).size).toBe(count);
      expect([...ids].sort()).toEqual(rooms.map(room=>String(room.room_id)).sort());
      await expect.poll(() => network.length).toBeGreaterThan(0);
      for (const response of network) {
        expect(response.requested.pageSize).toBe(String(item.size));
        expect(response.requested.page).not.toBe('undefined');
        expect(response.pageSize).toBe(item.size);
        expect(response.items).toBeLessThanOrEqual(item.size);
        expect(response.total).toBe(count); expect(response.totalPages).toBe(totalPages);
      }
      expect(new URL(page.url()).searchParams.get('page')).not.toBe('undefined');
      if(totalPages>1) await reachable(page.getByRole('button',{name:'ก่อนหน้า',exact:true}));
      await noOverflow(page);
      await testInfo.attach('api-and-dom', {body:JSON.stringify({ count,size:item.size,network,renderedIds:ids },null,2),contentType:'application/json'});
      if([item.size,item.size+1,item.size*2+1].includes(count)) await capture(page,testInfo,`${item.path.slice(1)}-${count}-boundary`);
    });
  }

  for(const count of [item.size,item.size+1]) {
    test(`${item.path} legacy ${count}: rejects the running-old-server contract instead of rendering false pages`,async ({page,environment},testInfo)=>{
      await prepare(page,environment,testInfo,count);
      // Match the observed live response exactly, backed by real rows in the isolated
      // schema. Deliberately exercise legacy mode, never slice its array in the client.
      await page.route(`**${item.endpoint}?**`,async route=>{
        const response=await route.fetch({url:new URL(item.endpoint,environment.baseURL).href});
        const body=await response.json();
        expect(body.rooms).toHaveLength(count);
        await route.fulfill({response,json:{rooms:body.rooms}});
      });
      await page.goto(item.path);
      await expect(page.locator('.empty-state')).toBeVisible();
      await expect(page.locator(item.selector)).toHaveCount(0);
      await expect(page.locator('.room-pagination')).toHaveCount(0);
      expect(new URL(page.url()).searchParams.get('page')).not.toBe('undefined');
    });
  }
}
