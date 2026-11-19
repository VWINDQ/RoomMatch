import './helpers/load-client.mjs';
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, mock, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  sessionStorage: dom.window.sessionStorage, HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { createRoot } = await import('react-dom/client');
const { TestRouter: MemoryRouter } = await import('./helpers/test-router.mjs');
const { AppProvider } = await import('../src/AppContext.tsx');
const { ProfilePage } = await import('../src/pages/ProfilePage.tsx');
const { MyListingsPage } = await import('../src/pages/MyListingsPage.tsx');
const { api } = await import('../src/lib/api.ts');

function deferred() {
  let resolve, reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}
let root;
beforeEach(() => { localStorage.clear(); root = createRoot(document.getElementById('root')); });
afterEach(async () => { await act(async () => root.unmount()); mock.restoreAll(); });
after(() => dom.window.close());
const mount = (Page) => act(async () => root.render(createElement(MemoryRouter, null, createElement(AppProvider, null, createElement(Page)))));
const skeleton = () => document.querySelector('.skeleton-region');

test('profile skeleton resolves to an error, returns on retry and is replaced by the saved profile', async () => {
  const first = deferred(), retry = deferred();
  let calls = 0;
  mock.method(api, 'profile', () => (++calls === 1 ? first.promise : retry.promise));
  await mount(ProfilePage);
  assert.equal(skeleton().getAttribute('role'), 'status');
  assert.equal(skeleton().getAttribute('aria-label'), 'กำลังโหลดโปรไฟล์');
  assert.equal(skeleton().querySelectorAll('button, a, input, [tabindex]').length, 0);
  assert.equal(skeleton().querySelector('.skeleton-content').getAttribute('aria-hidden'), 'true');
  await act(async () => first.reject(new Error('เชื่อมต่อไม่ได้ กรุณาลองอีกครั้ง')));
  assert.equal(skeleton(), null);
  assert.match(document.body.textContent, /โหลดโปรไฟล์ไม่สำเร็จ/);
  const retryButton = [...document.querySelectorAll('button')].find(button => button.textContent === 'ลองอีกครั้ง');
  await act(async () => retryButton.click());
  assert.ok(skeleton());
  await act(async () => retry.resolve({
    user: { userId: '1', firstName: 'Skeleton', lastName: 'Test', email: 'skeleton@example.test',
      phone: '0800000000', gender: '', dateOfBirth: '', university: '', profileImage: '', bio: '', lineId: '', instagram: '' },
    lifestyle: null, preference: null,
  }));
  assert.equal(skeleton(), null);
  assert.match(document.body.textContent, /Skeleton Test/);
  assert.doesNotMatch(document.body.textContent, /โหลดโปรไฟล์ไม่สำเร็จ/);
});

test('list loading announces once without fake controls and does not show an empty state before completion', async () => {
  const pending = deferred();
  mock.method(api, 'myRoomsPage', () => pending.promise);
  await mount(MyListingsPage);
  assert.equal(document.querySelectorAll('.skeleton-region[role="status"]').length, 1);
  assert.equal(skeleton().querySelectorAll('button, a, input, [tabindex]').length, 0);
  assert.doesNotMatch(document.body.textContent, /ยังไม่มีประกาศของคุณ/);
  await act(async () => pending.resolve({ rooms: [], total: 0, page: 1, pageSize: 10, totalPages: 0 }));
  assert.equal(skeleton(), null);
  assert.match(document.body.textContent, /ยังไม่มีประกาศของคุณ/);
});
