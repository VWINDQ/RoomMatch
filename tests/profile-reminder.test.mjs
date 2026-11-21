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
const { createMemoryRouter, RouterProvider, Outlet, useNavigate } = await import('react-router-dom');
const { AppProvider, useApp } = await import('../src/AppContext.tsx');
const { ProfilePage } = await import('../src/pages/ProfilePage.tsx');
const { ProfileReminder } = await import('../src/components/ProfileReminder.tsx');
const { api } = await import('../src/lib/api.ts');
const account = { userId: '1', firstName: 'New', lastName: 'Student', email: 'reminder@example.test', phone: '0801234567', gender: '',
  dateOfBirth: '2000-01-01', university: '', profileImage: '', bio: '', instagram: '', lineId: '', profileReminderSeen: false };
const credentials = { ...account, password: 'test-password', accountType: 'general' };
let root, router, app;
function Session() { app = useApp(); return createElement(Outlet); }
function Rooms() {
  const navigate = useNavigate();
  return createElement(ProfileReminder, { onEdit: () => navigate('/profile', { state: { editProfile: true } }) });
}
const button = label => [...document.querySelectorAll('button')].find(element => element.textContent === label);
const dialog = () => document.querySelector('.profile-reminder');
beforeEach(() => {
  sessionStorage.clear();
  const session = async () => ({ token: 'session-1', user: structuredClone(account) });
  mock.method(api, 'me', async () => structuredClone(account));
  mock.method(api, 'login', session);
  mock.method(api, 'register', session);
  mock.method(api, 'profile', async () => ({ user: structuredClone(account), lifestyle: null, preference: null }));
  root = createRoot(document.getElementById('root'));
});
afterEach(async () => { await act(async () => root.unmount()); router?.dispose(); mock.restoreAll(); });
after(() => dom.window.close());

async function mount(path = '/rooms') {
  router = createMemoryRouter([{ element: createElement(AppProvider, null, createElement(Session)), children: [
    { path: '/rooms', element: createElement(Rooms) }, { path: '/profile', element: createElement(ProfilePage) },
  ] }], { initialEntries: [path] });
  await act(async () => root.render(createElement(StrictMode, null, createElement(RouterProvider, { router }))));
}

async function register() {
  await mount('/profile');
  await act(async () => app.register(credentials));
  assert.equal(dialog(), null);
  await act(async () => router.navigate('/rooms'));
  assert.ok(dialog());
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
  assert.equal(document.body.style.overflow, 'hidden');
}

test('refreshing while the reminder is open does not show it again', async () => {
  await register();
  await act(async () => root.unmount());
  router.dispose();
  root = createRoot(document.getElementById('root'));
  await mount();
  assert.equal(dialog(), null);
  assert.equal(document.body.style.overflow, '');
});

test('primary action opens the existing profile editor', async () => {
  await register();
  await act(async () => button('ไปเติมโปรไฟล์').click());
  assert.equal(dialog(), null);
  assert.ok(document.querySelector('[name="lifestyleName"]'));
  assert.ok(document.querySelector('[name="lineId"]'));
  assert.ok(button('บันทึกการเปลี่ยนแปลง'));
});

for (const action of ['later', 'close button', 'Escape', 'backdrop']) {
  test(`${action} closes the reminder without reopening it on a return visit`, async () => {
    await register();
    await act(async () => {
      if (action === 'later') button('ไว้ทีหลัง').click();
      else if (action === 'Escape') document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      else document.querySelector(action === 'backdrop' ? '.modal-scrim' : '.profile-reminder [aria-label="ปิด"]').click();
    });
    assert.equal(dialog(), null);
    assert.equal(document.body.style.overflow, '');
    await act(async () => router.navigate('/profile'));
    await act(async () => router.navigate(-1));
    assert.equal(dialog(), null);
  });
}

test('a failed registration and an ordinary login cannot open the reminder', async () => {
  await mount();
  api.register.mock.mockImplementationOnce(async () => { throw new Error('Email already registered'); });
  await act(async () => assert.rejects(() => app.register(credentials), /Email already registered/));
  assert.equal(app.consumeRegistrationReminder(), false);
  await act(async () => app.login(account.email, credentials.password));
  await act(async () => router.navigate('/rooms'));
  assert.equal(dialog(), null);
});

test('a new login invalidates a registration reminder before the profile is opened', async () => {
  await mount('/profile');
  await act(async () => app.register(credentials));
  await act(async () => app.logout());
  await act(async () => app.login(account.email, credentials.password));
  await act(async () => router.navigate('/rooms'));
  assert.equal(dialog(), null);
});
