import './helpers/load-client.mjs';
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, mock, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
// jsdom has no CSS animation engine; let React subscribe to standard animation events.
dom.window.AnimationEvent = dom.window.Event;
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  sessionStorage: dom.window.sessionStorage, HTMLElement: dom.window.HTMLElement,
  MutationObserver: dom.window.MutationObserver,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { createRoot } = await import('react-dom/client');
const { MemoryRouter, Route, Routes } = await import('react-router-dom');
const { AppProvider, useApp } = await import('../src/AppContext.tsx');
const { Toast } = await import('../src/components/Toast.tsx');
const { RoomCard } = await import('../src/components/RoomCard.tsx');
const { RoomDetailPage } = await import('../src/pages/RoomDetailPage.tsx');
const { default: App } = await import('../src/App.tsx');
const { api, SessionChangedError } = await import('../src/lib/api.ts');
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};

const room = {
  roomId: '1', title: 'ห้องทดสอบ', description: 'ห้องทดสอบ', price: 4000, capacity: 3,
  availableSlots: 2, memberCount: 0, status: 'available', createdAt: '', images: [], members: [],
};
function deferred() {
  let resolve, reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}
let root;
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); root = createRoot(document.getElementById('root')); });
afterEach(async () => { await act(async () => root.unmount()); mock.restoreAll(); });
after(() => dom.window.close());

function ToastFeedback() {
  const { toast, toastTone } = useApp();
  return createElement(Toast, { message: toast, tone: toastTone });
}

async function mount(surface, isFavorite = false) {
  const value = { ...room, isFavorite };
  mock.method(api, 'room', async () => value);
  const page = surface === 'card' ? createElement(RoomCard, { room: value })
    : createElement(Routes, null, createElement(Route, { path: '/rooms/:id', element: createElement(RoomDetailPage) }));
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/rooms/1'] },
    createElement(AppProvider, null, page, createElement(ToastFeedback)))));
}
const favorite = () => document.querySelector('button[aria-pressed]');
const hasFeedback = () => favorite().classList.contains('has-favorite-feedback');

for (const surface of ['card', 'detail']) {
  test(`${surface}: favorite feedback waits for a confirmed save, clears and can play on a later save`, async () => {
    const saving = deferred();
    const add = mock.method(api, 'addFavorite', () => saving.promise);
    mock.method(api, 'removeFavorite', async () => {});
    await mount(surface);
    assert.equal(hasFeedback(), false);
    await act(async () => favorite().click());
    await act(async () => favorite().click());
    assert.equal(add.mock.callCount(), 1);
    assert.equal(favorite().disabled, true);
    assert.equal(favorite().getAttribute('aria-pressed'), 'false');
    assert.equal(hasFeedback(), false);
    await act(async () => saving.resolve());
    assert.equal(favorite().getAttribute('aria-pressed'), 'true');
    assert.equal(hasFeedback(), true);
    await act(async () => favorite().querySelector('.lucide-heart').dispatchEvent(new dom.window.Event('animationend', { bubbles: true })));
    assert.equal(hasFeedback(), false);
    await act(async () => favorite().click());
    assert.equal(favorite().getAttribute('aria-pressed'), 'false');
    assert.equal(hasFeedback(), false);
    await act(async () => favorite().click());
    assert.equal(hasFeedback(), true);
  });

  test(`${surface}: existing favorites stay still and a failed save never signals success`, async () => {
    mock.method(api, 'removeFavorite', async () => {});
    mock.method(api, 'addFavorite', async () => { throw new Error('บันทึกไม่สำเร็จ'); });
    await mount(surface, true);
    assert.equal(hasFeedback(), false);
    await act(async () => favorite().click());
    await act(async () => favorite().click());
    assert.equal(favorite().getAttribute('aria-pressed'), 'false');
    assert.equal(favorite().disabled, false);
    assert.equal(hasFeedback(), false);
  });

  test(`${surface}: failed favorite keeps its state and shows an error toast; retry shows success`, async () => {
    let failing = true;
    mock.method(api, 'addFavorite', async () => { if (failing) throw new Error('บันทึกไม่สำเร็จ'); });
    await mount(surface);
    await act(async () => favorite().click());
    const feedback = document.querySelector('.toast');
    assert.equal(feedback.textContent, 'บันทึกไม่สำเร็จ');
    assert.equal(feedback.getAttribute('role'), 'alert');
    assert.ok(feedback.classList.contains('toast-error'));
    assert.equal(feedback.querySelector('.lucide-circle-check'), null);
    assert.equal(favorite().getAttribute('aria-pressed'), 'false');
    assert.equal(favorite().disabled, false);
    failing = false;
    await act(async () => favorite().click());
    assert.equal(favorite().getAttribute('aria-pressed'), 'true');
    assert.equal(document.querySelector('.toast').getAttribute('role'), 'status');
    assert.ok(document.querySelector('.toast .lucide-circle-check'));
    assert.equal(document.querySelector('.toast-error'), null);
  });

  test(`${surface}: an obsolete session cannot display favorite feedback`, async () => {
    mock.method(api, 'addFavorite', async () => { throw new SessionChangedError(); });
    await mount(surface);
    await act(async () => favorite().click());
    assert.equal(document.querySelector('.toast'), null);
    assert.equal(favorite().getAttribute('aria-pressed'), 'false');
    assert.equal(favorite().disabled, false);
  });
}

test('late room results cannot steal focus from an open filter after returning from a room', { timeout: 5000 }, async () => {
  const results = deferred(), queryStarted = deferred();
  sessionStorage.setItem('roommatch:token', 'focus-test-token');
  mock.method(api, 'me', async () => ({ userId: '1', firstName: 'Focus', lastName: 'Test' }));
  mock.method(api, 'ownerRequests', async () => []);
  mock.method(api, 'roomsPage', () => { queryStarted.resolve(); return results.promise; });
  // jsdom does not lay out controls; expose the visible dialog controls to its focus trap.
  mock.method(window.HTMLElement.prototype, 'getClientRects', () => [{}]);
  await act(async () => root.render(createElement(MemoryRouter, {
    initialEntries: [{ pathname: '/rooms', state: { focusTarget: 'room-card-1' } }],
  }, createElement(App))));
  await act(async () => queryStarted.promise);
  const filterButton = [...document.querySelectorAll('button')].find(button => button.textContent === 'ตัวกรอง');
  await act(async () => { filterButton.focus(); filterButton.click(); });
  const dialog = document.querySelector('.filter-sheet');
  assert.ok(dialog.contains(document.activeElement));
  await act(async () => results.resolve({ rooms: [room], page: 1, pageSize: 12, total: 1, totalPages: 1 }));
  assert.ok(document.getElementById('room-card-1'));
  assert.ok(dialog.contains(document.activeElement), 'focus must stay inside the filter when the background list finishes loading');
  await act(async () => document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(document.querySelector('.filter-sheet'), null);
  assert.ok(document.activeElement === filterButton, 'Escape restores focus to the filter button');
});
