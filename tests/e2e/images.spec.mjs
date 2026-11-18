import { test, expect, imageHost, signIn, noOverflow, capture } from './fixtures.mjs';

const imageCases = [
  { path: '/rooms', actor: 'owner', target: '.room-card .photo-fallback', name: 'room-card', url: '/room-1.svg' },
  { path: '/favorites', actor: 'owner', target: '.room-card .photo-fallback', name: 'favorite-card', url: '/room-1.svg' },
  { path: '/my-listings', actor: 'owner', target: '.my-listing .photo-fallback', name: 'listing-card', url: '/room-1.svg' },
  { path: '/rooms/1', actor: 'owner', target: '.gallery-main .photo-fallback', name: 'gallery', url: '/room-1.svg' },
  { path: '/profile', actor: 'owner', target: '.profile-avatar', name: 'profile', url: '/profile-1.svg', initials: 'แน' },
  { path: '/matches', actor: 'member', target: '.match-avatar', name: 'match-profile', url: '/profile-1.svg', initials: 'แ' },
  { path: '/friends', actor: 'owner', target: '.friend-avatar', name: 'friend-avatar', url: '/profile-4.svg' },
  { path: '/rooms/1', actor: 'owner', target: '.detail-member > span', name: 'member-profile', url: '/profile-2.svg' },
  { path: '/rooms/1', actor: 'owner', target: '.owner-mini > span', name: 'detail-owner-profile', url: '/profile-1.svg', initials: 'แ' },
  { path: '/my-listings/1/edit', actor: 'owner', target: '.image-picker-unavailable', name: 'listing-image-preview', url: '/room-1.svg', preview: true },
  { path: '/profile', actor: 'owner', target: '.image-picker-unavailable', name: 'profile-image-preview', url: '/profile-1.svg', preview: true },
  { path: '/requests?view=incoming', actor: 'owner', target: '#request-2 .request-person', name: 'request-avatar', url: '/profile-3.svg', hiddenMobile: true, limit: 6 },
  { path: '/requests?view=incoming', actor: 'owner', target: '.requester-profile-avatar', name: 'requester-profile-modal', url: '/profile-3.svg', limit: 6 },
  { path: '/friends', actor: 'owner', target: '.friend-full-profile .friend-avatar', name: 'friend-profile-modal', url: '/profile-4.svg', limit: 4 },
];

for (const item of imageCases) {
  test(`broken fixture image: ${item.name}`, async ({ page, environment }, testInfo) => {
    let requests = 0;
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    // Only this fixture URL fails. All other images retain their normal fixture responses.
    await page.route(`${imageHost}${item.url}`, async route => { requests++; await route.abort('failed'); });
    await signIn(page, environment, item.actor); await page.goto(item.path);
    if (item.name === 'match-profile') {
      // Member previews load independently of the cards and mount another avatar.
      // Wait for both real API results before measuring retries of the failed URL.
      await expect(page.locator('.member-strip')).toHaveCount(2);
      await expect(page.locator('.member-strip[aria-busy="false"]')).toHaveCount(2);
      await expect(page.locator('.member-strip [role="alert"]')).toHaveCount(0);
      await expect(page.locator(`img[src="${imageHost}${item.url}"]`)).toHaveCount(0);
    }
    if (item.name === 'profile-image-preview') await page.getByRole('button', { name: 'แก้ไขโปรไฟล์', exact: true }).click();
    if (item.name === 'requester-profile-modal') await page.locator('#request-2').getByRole('button', { name: 'ดูโปรไฟล์', exact: true }).click();
    if (item.name === 'friend-profile-modal') await page.locator('.friend-card').filter({ has: page.getByRole('heading', { name: environment.friendName, exact: true }) }).getByRole('button', { name: 'ดูโปรไฟล์', exact: true }).click();
    const target = page.locator(item.target);
    if (item.preview) {
      await expect(target.first()).toHaveText('เปิดภาพตัวอย่างไม่ได้');
      await expect(target.first()).toBeVisible();
    } else if (item.target.includes('photo-fallback')) {
      await expect(target.first()).toBeVisible();
      await expect(target.first()).toContainText('โหลดรูปไม่สำเร็จ');
      if (item.name === 'gallery') {
        await expect(page.locator('.gallery-thumbs img')).toHaveCount(0);
        await expect(page.locator('.gallery-thumbs .photo-fallback')).toHaveCount(3);
      }
    } else {
      if (item.hiddenMobile && page.viewportSize().width <= 420) await expect(target.first()).toBeHidden();
      else await expect(target.first()).toBeVisible();
      await expect(target.locator(`img[src="${imageHost}${item.url}"]`)).toHaveCount(0);
      await expect(target.filter({ hasNot: page.locator('img') }).first()).not.toBeEmpty();
      if (item.initials) await expect(target.filter({ hasText: item.initials }).first()).toBeVisible();
    }
    await expect.poll(() => requests).toBeGreaterThan(0);
    // Trigger unrelated React activity and real layout frames, then check requests stay bounded.
    const settled = requests;
    await page.evaluate(async () => { window.dispatchEvent(new Event('resize')); for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame); });
    expect(requests, 'failed image must not retry in an onError loop').toBe(settled);
    expect(requests).toBeLessThanOrEqual(item.limit ?? (['gallery', 'listing-image-preview'].includes(item.name) ? 4 : 2));
    expect(failures).toEqual([]);
    await noOverflow(page); await capture(page, testInfo, `broken-${item.name}`);
  });
}
