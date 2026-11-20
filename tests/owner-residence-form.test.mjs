import './helpers/load-client.mjs';
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, mock, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  sessionStorage: dom.window.sessionStorage, HTMLElement: dom.window.HTMLElement, FormData: dom.window.FormData,
  HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement, HTMLSelectElement: dom.window.HTMLSelectElement,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true });
window.HTMLElement.prototype.scrollIntoView = () => {};
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider, Outlet } = await import('react-router-dom');
const { AppProvider } = await import('../src/AppContext.tsx');
const { ListingFormPage } = await import('../src/pages/ListingFormPage.tsx');
const { api } = await import('../src/lib/api.ts');
const room = { roomId: '5', title: 'Shared room', description: 'Existing room', googleMapsUrl: 'https://maps.google.com/',
  price: 6000, priceBasis: 'per_room', locality: 'บางมด', capacity: 2, memberCount: 1, ownerIsResident: true, occupantCount: 2,
  status: 'full', isOwner: true, availableSlots: 0, images: [{ imageId: '1', imageUrl: 'https://example.test/room.jpg', imageOrder: 0 }] };
let root, router, create, update;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  mock.method(api, 'room', async () => structuredClone(room));
  create = mock.method(api, 'createRoom', async () => room);
  update = mock.method(api, 'updateRoom', async () => room);
  mock.method(api, 'uploadImage', async () => '/uploads/1/test.webp');
  root = createRoot(document.getElementById('root'));
});
afterEach(async () => { await act(async () => root.unmount()); router?.dispose(); mock.restoreAll(); });
after(() => dom.window.close());
const field = name => document.querySelector(`[name="${name}"]`);
const button = text => [...document.querySelectorAll('button')].find(node => node.textContent === text);
async function mount(editing = false) {
  router = createMemoryRouter([{ element: createElement(AppProvider, null, createElement(Outlet)), children: [
    { path: '/my-listings/new', element: createElement(ListingFormPage) },
    { path: '/my-listings/:id/edit', element: createElement(ListingFormPage) },
    { path: '*', element: createElement('p', null, 'Destination') },
  ] }], { initialEntries: [editing ? '/my-listings/5/edit' : '/my-listings/new'] });
  await act(async () => root.render(createElement(RouterProvider, { router })));
}
async function change(name, value) {
  const input = field(name);
  const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value); input.dispatchEvent(new dom.window.Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}

test('new rental defaults to no owner occupant and submits the explicit flag with its capacity', async () => {
  await mount();
  assert.equal(field('ownerIsResident').checked, false);
  assert.ok(document.querySelector('.form-tip').textContent.includes('รับเพิ่มได้ 2 คน'));
  await act(async () => field('ownerIsResident').click());
  assert.ok(document.querySelector('.form-tip').textContent.includes('รับเพิ่มได้ 1 คน'));
  await act(async () => field('ownerIsResident').click());
  for (const [name, value] of Object.entries({ title: 'Rental', price: '6000', priceBasis: 'per_room', locality: 'บางมด', googleMapsUrl: 'https://maps.google.com/' })) await change(name, value);
  const input = document.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0)], 'room.png', { type: 'image/png' })] });
  await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
  await act(async () => button('สร้างประกาศ').click());
  assert.equal(create.mock.callCount(), 1);
  assert.equal(create.mock.calls[0].arguments[0].ownerIsResident, false);
  assert.equal(create.mock.calls[0].arguments[0].capacity, 2);
});

test('editing counts only existing residents and the selected owner, and validates their combined minimum', async () => {
  await mount(true);
  assert.equal(field('ownerIsResident').checked, true);
  assert.equal(field('capacity').min, '2');
  await change('capacity', '1');
  await act(async () => button('บันทึกการแก้ไข').click());
  assert.equal(update.mock.callCount(), 0);
  assert.ok(document.querySelector('.field-error').textContent.includes('2 คน'));
  await act(async () => field('ownerIsResident').click());
  assert.equal(field('capacity').min, '1');
  await act(async () => button('บันทึกการแก้ไข').click());
  assert.equal(update.mock.callCount(), 1);
  assert.equal(update.mock.calls[0].arguments[1].ownerIsResident, false);
  assert.equal(update.mock.calls[0].arguments[1].capacity, 1);
});

test('changing only the owner residence checkbox is protected by the unsaved listing guard', async () => {
  await mount(true);
  await act(async () => field('ownerIsResident').click());
  await act(async () => router.navigate('/rooms'));
  assert.ok(document.querySelector('.form-leave-modal'));
  assert.ok(document.body.textContent.includes('ยังไม่ได้บันทึกประกาศ'));
  await act(async () => button('ยกเลิกการแก้ไข').click());
  assert.ok(document.body.textContent.includes('Destination'));
  assert.equal(update.mock.callCount(), 0);
});
