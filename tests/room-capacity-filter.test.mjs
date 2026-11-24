import './helpers/load-client.mjs';
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, mock, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage,
  HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
  requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider } = await import('react-router-dom');
const { AppProvider } = await import('../src/AppContext.tsx');
const { RoomsPage } = await import('../src/pages/RoomsPage.tsx');
const { api } = await import('../src/lib/api.ts');
let root, router, requests;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  requests = [];
  mock.method(api, 'roomsPage', async params => {
    requests.push(new URLSearchParams(params));
    return { rooms: [], total: 0, page: 1, pageSize: 12, totalPages: 0 };
  });
  root = createRoot(document.getElementById('root'));
});
afterEach(async () => { await act(async () => root.unmount()); router?.dispose(); mock.restoreAll(); });
after(() => dom.window.close());

const button = label => [...document.querySelectorAll('button')].find(el => el.textContent === label);
const capacityField = () => [...document.querySelectorAll('label')].find(el => el.textContent.startsWith('จำนวนผู้พักทั้งหมด')).querySelector('input');
const slotsField = () => [...document.querySelectorAll('label')].find(el => el.textContent.startsWith('จำนวนที่ว่างที่ต้องการ')).querySelector('input');
const settle = () => act(async () => new Promise(resolve => setTimeout(resolve, 10)));
async function waitForRequest(predicate) {
  const deadline = Date.now() + 1000;
  while (!predicate(requests.at(-1)) && Date.now() < deadline) await settle();
  assert.ok(predicate(requests.at(-1)), 'the matching room request should complete');
}
async function mount(url) {
  router = createMemoryRouter([{ path: '/rooms', element: createElement(AppProvider, null, createElement(RoomsPage)) }], { initialEntries: [url] });
  await act(async () => root.render(createElement(RouterProvider, { router })));
  await settle();
}
async function openFilters() { await act(async () => document.querySelector('.filter-button').click()); }
async function fill(field, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(field, value);
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

test('total capacity hydrates from the URL, applies independently, survives remount and clears with all filters', async () => {
  await mount('/rooms?q=บางมด&sort=price_asc&capacity=2');
  assert.equal(requests.at(-1).get('capacity'), '2');
  assert.match(document.querySelector('.active-filter-row').textContent, /พักได้ทั้งหมด 2 คน/);
  await openFilters();
  assert.equal(capacityField().value, '2');
  assert.equal(slotsField().value, '');
  await fill(capacityField(), '3');
  await act(async () => document.querySelector('.filter-sheet [aria-label="ปิด"]').click());
  assert.equal(new URLSearchParams(router.state.location.search).get('capacity'), '2');
  await openFilters();
  assert.equal(capacityField().value, '2');
  await fill(capacityField(), '3');
  await act(async () => button('ใช้ตัวกรอง').click());
  await settle();
  const params = new URLSearchParams(router.state.location.search);
  assert.equal(params.get('capacity'), '3');
  assert.equal(params.get('q'), 'บางมด');
  assert.equal(params.get('sort'), 'price_asc');
  assert.equal(requests.at(-1).get('capacity'), '3');
  assert.equal(requests.at(-1).get('status'), 'available');
  assert.equal(document.querySelector('[role="dialog"]'), null);
  const savedUrl = '/rooms' + router.state.location.search;
  await act(async () => root.unmount()); router.dispose();
  root = createRoot(document.getElementById('root'));
  await mount(savedUrl);
  await openFilters();
  assert.equal(capacityField().value, '3');
  await act(async () => document.querySelector('.filter-sheet [aria-label="ปิด"]').click());
  await act(async () => button('ล้างทั้งหมด').click());
  await waitForRequest(params => !params.has('capacity'));
  assert.equal(new URLSearchParams(router.state.location.search).has('capacity'), false);
  assert.equal(requests.at(-1).has('capacity'), false);
  assert.equal(document.querySelector('.active-filter-row'), null);
});

test('invalid total capacity keeps the filter open and reset clears capacity, vacancies and validation together', async () => {
  await mount('/rooms');
  await openFilters();
  for (const value of ['0', '-1', '1.5', '101']) {
    await fill(capacityField(), value);
    await act(async () => button('ใช้ตัวกรอง').click());
    assert.ok(document.querySelector('[role="dialog"]'));
    assert.match(document.querySelector('[role="alert"]').textContent, /จำนวนผู้พักทั้งหมด.*1 ถึง 100 คน/);
    assert.equal(router.state.location.search, '');
  }
  await fill(capacityField(), '2');
  await fill(slotsField(), '1');
  await act(async () => button('ใช้ตัวกรอง').click());
  await settle();
  assert.equal(requests.at(-1).get('capacity'), '2');
  assert.equal(requests.at(-1).get('minSlots'), '1');
  assert.match(document.querySelector('.active-filter-row').textContent, /พักได้ทั้งหมด 2 คน.*ว่างอย่างน้อย 1 ที่/);
  await openFilters();
  await act(async () => button('ล้างตัวกรอง').click());
  assert.equal(capacityField().value, '');
  assert.equal(slotsField().value, '');
  assert.equal(document.querySelector('[role="alert"]'), null);
  await act(async () => button('ใช้ตัวกรอง').click());
  await settle();
  assert.equal(router.state.location.search, '');
});
