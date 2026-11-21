import './helpers/load-client.mjs';
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, mock, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement, StrictMode } from 'react';

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  sessionStorage: dom.window.sessionStorage,
  HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLSelectElement: dom.window.HTMLSelectElement,
  HTMLTextAreaElement: dom.window.HTMLTextAreaElement, FormData: dom.window.FormData,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  IS_REACT_ACT_ENVIRONMENT: true });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider, Outlet } = await import('react-router-dom');
const { AppProvider, useApp } = await import('../src/AppContext.tsx');
const { ProfileReminder } = await import('../src/components/ProfileReminder.tsx');
const { ProfilePage } = await import('../src/pages/ProfilePage.tsx');
const { api, tokenStorage } = await import('../src/lib/api.ts');
let root, router, account, app, acknowledgement;
function Session() { app = useApp(); return createElement(ProfileReminder, { key: app.user?.userId }); }
const button = label => [...document.querySelectorAll('button')].find(element => element.textContent === label);
const dialog = () => document.querySelector('.profile-reminder');
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  account = { userId: '1', firstName: 'New', lastName: 'Student', email: 'reminder@example.test', phone: '0801234567', gender: '',
    dateOfBirth: '2000-01-01', university: '', profileImage: '', bio: '', instagram: '', lineId: '', profileReminderSeen: false };
  mock.method(api, 'me', async () => structuredClone(account));
  mock.method(api, 'login', async () => ({ token: `session-${account.userId}`, user: structuredClone(account) }));
  mock.method(api, 'profile', async () => ({ user: structuredClone(account), lifestyle: null, preference: null }));
  acknowledgement = mock.method(api, 'acknowledgeProfileReminder', async () => { account.profileReminderSeen = true; });
  root = createRoot(document.getElementById('root'));
});
afterEach(async () => { await act(async () => root.unmount()); router?.dispose(); mock.restoreAll(); });
after(() => dom.window.close());
async function mount(path = '/rooms') {
  tokenStorage.set(`session-${account.userId}`);
  router = createMemoryRouter([{ element: createElement(AppProvider, null, createElement(Session), createElement(Outlet)), children: [
    { path: '/rooms', element: createElement('h1', null, 'Rooms') }, { path: '/profile', element: createElement(ProfilePage) },
  ] }], { initialEntries: [path] });
  await act(async () => root.render(createElement(StrictMode, null, createElement(RouterProvider, { router }))));
}
async function remount(path = '/rooms') {
  await act(async () => root.unmount()); router.dispose();
  root = createRoot(document.getElementById('root')); await mount(path);
}

test('first authenticated visit shows one reminder; later acknowledgement survives logout and a fresh client session', async () => {
  await mount();
  assert.ok(dialog()); assert.equal(acknowledgement.mock.callCount(), 0);
  assert.equal(document.body.style.overflow, 'hidden');
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
  assert.match(dialog().textContent, /ไลฟ์สไตล์.*LINE ID หรือ Instagram/);
  await act(async () => button('ไว้ทีหลัง').click());
  assert.equal(dialog(), null); assert.equal(app.user.profileReminderSeen, true);
  assert.equal(document.body.style.overflow, '');
  await act(async () => app.logout());
  await act(async () => app.login(account.email, 'test-password'));
  assert.equal(dialog(), null);
  await remount(); assert.equal(dialog(), null);
  assert.equal(acknowledgement.mock.callCount(), 1);
});

test('primary action opens the actual profile editor and consumes its navigation intent', async () => {
  await mount();
  await act(async () => button('ไปเติมโปรไฟล์').click());
  assert.equal(dialog(), null); assert.equal(router.state.location.pathname, '/profile');
  assert.ok(document.querySelector('[name="lifestyleName"]'));
  assert.ok(document.querySelector('[name="lineId"]'));
  assert.ok(button('บันทึกการเปลี่ยนแปลง'));
  assert.equal(router.state.location.state?.editProfile, undefined);
  await remount('/profile');
  assert.equal(dialog(), null); assert.ok(button('แก้ไขโปรไฟล์'));
});

for (const action of ['close button', 'Escape', 'backdrop']) {
  test(`${action} acknowledges the reminder once and restores access to the page`, async () => {
    await mount();
    await act(async () => {
      if (action === 'Escape') document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      else document.querySelector(action === 'backdrop' ? '.modal-scrim' : '.profile-reminder [aria-label="ปิด"]').click();
    });
    assert.equal(dialog(), null); assert.equal(acknowledgement.mock.callCount(), 1);
    await remount(); assert.equal(dialog(), null);
  });
}

test('a failed acknowledgement keeps the reminder available for retry and prevents duplicate pending requests', async () => {
  let reject;
  acknowledgement.mock.mockImplementationOnce(() => new Promise((resolve, onReject) => { reject = onReject; }));
  await mount();
  await act(async () => { button('ไปเติมโปรไฟล์').click(); button('ไว้ทีหลัง').click(); document.querySelector('.modal-scrim').click(); });
  assert.equal(acknowledgement.mock.callCount(), 1);
  assert.equal(button('ไว้ทีหลัง').disabled, true);
  await act(async () => reject(new Error('Database unavailable')));
  assert.ok(dialog()); assert.match(document.querySelector('[role="alert"]').textContent, /ลองกดอีกครั้ง/);
  assert.equal(app.user.profileReminderSeen, false); assert.equal(router.state.location.pathname, '/rooms');
  await act(async () => button('ไว้ทีหลัง').click());
  assert.equal(dialog(), null); assert.equal(acknowledgement.mock.callCount(), 2);
});

test('mandatory Google setup takes priority and an older API without the new flag remains usable', async () => {
  account.profileSetupPending = true;
  await mount(); assert.equal(dialog(), null);
  await act(async () => app.refreshUser({ ...account, profileSetupPending: false }));
  assert.ok(dialog());
  delete account.profileReminderSeen; delete account.profileSetupPending;
  await remount(); assert.equal(dialog(), null);
});

test('an acknowledgement completing after an account switch cannot dismiss the new account reminder', async () => {
  let finish;
  acknowledgement.mock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount();
  await act(async () => button('ไว้ทีหลัง').click());
  await act(async () => app.logout());
  account = { ...account, userId: '2', email: 'other@example.test', profileReminderSeen: false };
  await act(async () => app.login(account.email, 'test-password'));
  await act(async () => finish());
  assert.ok(dialog()); assert.equal(app.user.userId, '2'); assert.equal(app.user.profileReminderSeen, false);
  assert.equal(document.querySelector('[role="alert"]'), null);
});
