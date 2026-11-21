import { test as base, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openDatabase, cleanupDatabases } from '../support/postgres-fixtures.mjs';
import { startRoomMatchServer } from '../../server/app.js';
import { createToken } from '../../server/auth.js';

export const imageHost = 'https://rm-fixture.invalid';
export const imageSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#cbd8ca"/><text x="80" y="300" font-size="48">RoomMatch fixture</text></svg>';

export const test = base.extend({
  environment: [async ({}, use) => {
    await access(new URL('../../dist/index.html', import.meta.url));
    let app;
    try {
      const db = await openDatabase({ filename: ':memory:', seed: true });
      if (!process.env.ROOMMATCH_E2E_RESOURCES) throw new Error('E2E resource ownership was not initialized');
      await writeFile(join(process.env.ROOMMATCH_E2E_RESOURCES, `${db.schema}.txt`), db.schema);
      const uploadDirectory = join(process.env.ROOMMATCH_E2E_RESOURCES, `${db.schema}-uploads`);
      await mkdir(uploadDirectory);
      const long = 'ทดสอบชื่อยาวและภาษาไทยสำหรับตรวจการจัดวาง '.repeat(5);
      await db.prepare("UPDATE USER SET profile_image=? || '/profile-' || user_id || '.svg'").run(imageHost);
      await db.prepare("UPDATE ROOM_IMAGE SET image_url=? || '/room-' || room_id || '-' || image_id || '.svg'").run(imageHost);
      await db.prepare('UPDATE USER SET first_name=?, last_name=?, university=?, bio=?, profile_image=? WHERE user_id=1')
        .run('แพรทดสอบชื่อยาวสำหรับหน้าจอมือถือ', 'นามสกุลสำหรับทดสอบ', long, long.repeat(3), `${imageHost}/profile-1.svg`);
      await db.prepare('UPDATE USER SET profile_image=? WHERE user_id=2').run(`${imageHost}/profile-2.svg`);
      await db.prepare('UPDATE USER SET profile_image=? WHERE user_id=3').run(`${imageHost}/profile-3.svg`);
      await db.prepare('UPDATE USER SET profile_image=?, bio=? WHERE user_id=4').run(`${imageHost}/profile-4.svg`, long.repeat(3));
      await db.prepare('UPDATE ROOM SET description=?, price_basis=?, locality=?, cost_notes=? WHERE room_id=1')
        .run(`${long.slice(0, 180)}\n${long.repeat(5)}\n${'LongUnbrokenText'.repeat(12)}`, 'per_room', long.slice(0, 180), long.repeat(3).slice(0, 900));
      await db.prepare('UPDATE ROOM_IMAGE SET image_url=? WHERE room_id=1').run(`${imageHost}/room-1.svg`);
      await db.prepare('INSERT INTO ROOM_FAVORITE(user_id,room_id) VALUES(1,1) ON CONFLICT DO NOTHING').run();
      await db.prepare("INSERT INTO FRIEND_CONNECTION(sender_id,recipient_id,status,responded_at) VALUES(1,2,'accepted',CURRENT_TIMESTAMP),(3,1,'pending',NULL),(1,5,'pending',NULL) ON CONFLICT DO NOTHING").run();
      const empty = await db.prepare('INSERT INTO USER(first_name,last_name,email,password_hash) VALUES(?,?,?,?) RETURNING user_id')
        .run('บัญชีว่าง', 'ทดสอบ', 'empty@responsive.test', randomBytes(32).toString('hex'));
      // General page scenarios use returning users; first-login coverage explicitly resets its own account.
      await db.exec('UPDATE USER SET profile_reminder_seen_at=CURRENT_TIMESTAMP');
      app = await startRoomMatchServer({ db, host: '127.0.0.1', port: 0, uploadDirectory, logger: { error() {} } });
      const friend = await db.prepare('SELECT first_name,last_name FROM USER WHERE user_id=4').get();
      // Server receives this explicit db; no path can open the development database.
      await use({ db, baseURL: `http://127.0.0.1:${app.server.address().port}`, friendName: `${friend.first_name} ${friend.last_name}`, tokens: {
        owner: createToken(1), member: createToken(2), seeker: createToken(3), empty: createToken(empty.insertId),
      } });
    } finally {
      try { if (app) await new Promise(resolve => app.server.close(resolve)); }
      finally { await cleanupDatabases(); }
    }
  }, { scope: 'worker' }],
  baseURL: async ({ environment }, use) => use(environment.baseURL),
  page: async ({ page }, use) => {
    await page.route(`${imageHost}/**`, route => route.fulfill({ contentType: 'image/svg+xml', body: imageSvg }));
    await use(page);
  },
});
export { expect };

const initializedPages = new WeakSet();
export async function signIn(page, environment, actor = 'owner') {
  const token = environment.tokens[actor] ?? null;
  const writeToken = token => {
    if (token) sessionStorage.setItem('roommatch:token', token);
    else sessionStorage.removeItem('roommatch:token');
  };
  if (initializedPages.has(page)) {
    // Switch the actual storage before the next navigation. Do not register several
    // competing init scripts: Playwright does not promise their execution order.
    await page.evaluate(writeToken, token);
  } else {
    await page.addInitScript(token => {
      if (sessionStorage.getItem('roommatch:e2e:initialized')) return;
      if (token) sessionStorage.setItem('roommatch:token', token);
      else sessionStorage.removeItem('roommatch:token');
      sessionStorage.setItem('roommatch:e2e:initialized', 'true');
    }, token);
    initializedPages.add(page);
  }
}

export async function openRoute(page, environment, route) {
  await signIn(page, environment, route.actor);
  await page.goto(route.url ?? route.path);
  await expect(page.locator(route.ready).first()).toBeVisible();
  await expect(page.locator('.detail-skeleton,.match-skeleton,.skeleton-card')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

export async function selectPersonalListFilter(page, name, value) {
  const trigger = page.getByRole('button', { name: /^ตัวกรอง/ });
  if (await trigger.isVisible()) {
    await trigger.click();
    const sheet = page.getByRole('dialog', { name: /^ตัวกรอง/ });
    await sheet.getByRole('combobox', { name, exact: true }).selectOption(value);
    await sheet.getByRole('button', { name: 'ใช้ตัวกรอง' }).click();
  } else {
    await page.getByRole('combobox', { name, exact: true }).selectOption(value);
  }
}

export async function noOverflow(page) {
  const widths = await page.evaluate(() => {
    const workspace = document.querySelector('.workspace');
    return { viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth,
      workspace: workspace ? { client: workspace.clientWidth, scroll: workspace.scrollWidth } : null };
  });
  if (widths.document > widths.viewport + 1 || (widths.workspace && widths.workspace.scroll > widths.workspace.client + 1)) {
    const elements = await page.locator('body *').evaluateAll(nodes => nodes.filter(node => {
      const box = node.getBoundingClientRect(); return box.width && box.right > document.documentElement.clientWidth + 1;
    }).slice(0, 25).map(node => ({ tag: node.tagName, class: node.className?.baseVal ?? node.className, right: node.getBoundingClientRect().right, width: node.getBoundingClientRect().width })));
    await test.info().attach('overflow-elements', { body: JSON.stringify({ ...widths, elements }, null, 2), contentType: 'application/json' });
  }
  expect.soft(widths.document, 'document horizontal overflow').toBeLessThanOrEqual(widths.viewport + 1);
  // Workspace is designed to scroll vertically. Gallery thumbnail scrollers are exempt,
  // but desktop's overflow-hidden shell must not conceal a wider page underneath it.
  if (widths.workspace) expect.soft(widths.workspace.scroll, 'workspace horizontal overflow/clipping').toBeLessThanOrEqual(widths.workspace.client + 1);
}

export async function reachable(locator) {
  await locator.scrollIntoViewIfNeeded();
  if (await locator.isEnabled()) {
    // Playwright's trial action tests actual hit targeting without submitting/mutating.
    await locator.click({ trial: true, timeout: 3000 });
  }
  // The action may reposition a sticky layout to obtain a real hit target. Check
  // the viewport after that positioning, rather than rejecting an intermediate scroll.
  await expect.soft(locator).toBeInViewport();
}

export async function capture(page, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: !/modal|filter-sheet/.test(name), animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}
