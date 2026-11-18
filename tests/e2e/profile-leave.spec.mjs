import { test, expect, signIn, noOverflow, capture } from './fixtures.mjs';

const warning = page => page.getByRole('dialog', { name: 'ยังไม่ได้บันทึกการแก้ไขโปรไฟล์', exact: true });
const menu = (page, path) => page.locator(`nav a[href="${path}"]`).filter({ visible: true });
const edit = page => page.getByRole('button', { name: 'แก้ไขโปรไฟล์', exact: true }).click();
const biographyInput = page => page.getByRole('textbox', { name: 'เกี่ยวกับฉัน', exact: true });
const readProfile = async (page, environment) => {
  const response = await page.request.get('/api/profile', { headers: { Authorization: `Bearer ${environment.tokens.owner}` } });
  expect(response.ok()).toBe(true);
  return response.json();
};

test.beforeEach(async ({ page, environment }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await signIn(page, environment);
  await page.goto('/profile');
  await edit(page);
});

test('profile unchanged, reverted and explicitly cancelled edits leave without a warning', async ({ page }) => {
  const firstName = page.getByLabel('ชื่อ', { exact: true });
  const original = await firstName.inputValue();
  await firstName.fill('Temporary edit');
  await firstName.fill(original);
  await menu(page, '/rooms').click();
  await expect(page).toHaveURL(/\/rooms$/);
  await page.goto('/profile');
  await edit(page);
  await firstName.fill('Discard through the normal button');
  await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  await menu(page, '/rooms').click();
  await expect(page).toHaveURL(/\/rooms$/);
  await expect(warning(page)).toHaveCount(0);
});

test('profile warning supports keyboard, preserves edits when dismissed and discards without saving', async ({ page, environment }, testInfo) => {
  const original = await readProfile(page, environment);
  let saves = 0;
  page.on('request', request => { if (request.method() === 'PATCH' && request.url().endsWith('/api/profile')) saves++; });
  await biographyInput(page).fill('Unsaved profile biography');
  const opener = menu(page, '/favorites');
  await opener.click();
  const dialog = warning(page);
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole('button', { name: 'ปิด', exact: true });
  const save = dialog.getByRole('button', { name: 'บันทึกและไปต่อ', exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(save).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await noOverflow(page);
  await capture(page, testInfo, 'profile-unsaved-modal');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(biographyInput(page)).toHaveValue('Unsaved profile biography');
  await menu(page, '/rooms').click();
  await dialog.getByRole('button', { name: 'ยกเลิกการแก้ไข', exact: true }).click();
  await expect(page).toHaveURL(/\/rooms$/);
  expect(saves).toBe(0);
  expect((await readProfile(page, environment)).user.bio).toBe(original.user.bio);
});

test('profile saves before following the selected menu and survives reload', async ({ page, environment }) => {
  const biography = `Saved before leaving at ${page.viewportSize().width}px`;
  await biographyInput(page).fill(biography);
  await menu(page, '/favorites').click();
  await warning(page).getByRole('button', { name: 'บันทึกและไปต่อ', exact: true }).click();
  await expect(page).toHaveURL(/\/favorites$/);
  expect((await readProfile(page, environment)).user.bio).toBe(biography);
  await page.goto('/profile');
  await expect(page.locator('.profile-personal-data')).toContainText(biography);
  await edit(page);
  await menu(page, '/rooms').click();
  await expect(page).toHaveURL(/\/rooms$/);
  await expect(warning(page)).toHaveCount(0);
});

test('profile validation and API failure keep changes; retry saves and leaves', async ({ page }) => {
  const phone = page.getByRole('textbox', { name: /^เบอร์โทรศัพท์/ });
  const replacement = await phone.inputValue() === '0898765432' ? '0812345678' : '0898765432';
  await phone.fill('1');
  await menu(page, '/rooms').click();
  await warning(page).getByRole('button', { name: 'บันทึกและไปต่อ', exact: true }).click();
  await expect(warning(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/profile$/);
  await expect(phone).toHaveValue('1');
  await expect(phone).toBeFocused();
  await phone.fill(replacement);
  await page.route('**/api/profile', route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 503, json: { error: 'Service unavailable' } }) : route.fallback());
  await menu(page, '/rooms').click();
  await warning(page).getByRole('button', { name: 'บันทึกและไปต่อ', exact: true }).click();
  await expect(warning(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.locator('.form-feedback')).toBeVisible();
  await expect(phone).toHaveValue(replacement);
  await page.unroute('**/api/profile');
  await menu(page, '/rooms').click();
  await warning(page).getByRole('button', { name: 'บันทึกและไปต่อ', exact: true }).click();
  await expect(page).toHaveURL(/\/rooms$/);
});

test('profile logout waits for a decision and saves while the session is still valid', async ({ page, environment }) => {
  await biographyInput(page).fill('Saved before logout');
  const logout = page.viewportSize().width >= 1024
    ? page.locator('.desktop-rail').getByRole('button', { name: 'ออกจากระบบ', exact: true })
    : page.locator('.profile-page').getByRole('button', { name: 'ออกจากระบบ', exact: true });
  await logout.click();
  await expect(warning(page)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('roommatch:token'))).toBe(environment.tokens.owner);
  await warning(page).getByRole('button', { name: 'ปิด', exact: true }).click();
  await page.locator('.profile-page').getByRole('button', { name: 'ออกจากระบบ', exact: true }).click();
  await warning(page).getByRole('button', { name: 'บันทึกและไปต่อ', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => localStorage.getItem('roommatch:token'))).toBeNull();
  expect((await readProfile(page, environment)).user.bio).toBe('Saved before logout');
});

test('profile refresh uses the native warning while an external logout clears the dirty editor', async ({ page, context }) => {
  await biographyInput(page).fill('Protect this edit');
  const dismissed = new Promise(resolve => page.once('dialog', async dialog => {
    expect(dialog.type()).toBe('beforeunload');
    await dialog.dismiss();
    resolve();
  }));
  await page.evaluate(() => { window.setTimeout(() => location.reload(), 0); });
  await dismissed;
  await expect(biographyInput(page)).toHaveValue('Protect this edit');
  const otherTab = await context.newPage();
  await otherTab.goto('/rooms', { waitUntil: 'domcontentloaded' });
  await otherTab.evaluate(() => localStorage.removeItem('roommatch:token'));
  await expect(page).toHaveURL(/\/login$/);
  await expect(warning(page)).toHaveCount(0);
  await otherTab.close();
});
