import './helpers/load-client.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

test('an unfavorite refresh cannot steal focus from an open filter', { timeout: 5000 }, async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  // jsdom does not lay out controls; expose the visible dialog controls to the focus trap.
  window.HTMLElement.prototype.getClientRects = () => [{}];
  const { createRoot } = await import('react-dom/client');
  const { MemoryRouter } = await import('react-router-dom');
  const { AppProvider } = await import('../src/AppContext.tsx');
  const { FavoritesPage } = await import('../src/pages/FavoritesPage.tsx');
  const { api } = await import('../src/lib/api.ts');
  const room = { roomId: '100', title: 'Favorite fixture', description: 'Test', price: 4000,
    capacity: 3, availableSlots: 2, memberCount: 0, status: 'available', createdAt: '', images: [], isFavorite: true };
  let firstReady, secondReady, finishRefresh;
  const first = new Promise(resolve => { firstReady = resolve; });
  const second = new Promise(resolve => { secondReady = resolve; });
  const refresh = new Promise(resolve => { finishRefresh = resolve; });
  let calls = 0;
  api.favoritesPage = async () => {
    if (++calls === 1) { firstReady(); return { rooms: [room], total: 1, page: 1, pageSize: 12, totalPages: 1 }; }
    secondReady(); return refresh;
  };
  api.removeFavorite = async () => {};
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(createElement(MemoryRouter, null, createElement(AppProvider, null, createElement(FavoritesPage)))));
    await act(async () => first);
    await act(async () => document.querySelector('.favorite-button').click());
    await act(async () => second);
    const trigger = document.querySelector('.personal-list-filter-trigger');
    await act(async () => { trigger.focus(); trigger.click(); });
    assert.ok(document.querySelector('.filter-sheet').contains(document.activeElement));
    await act(async () => finishRefresh({ rooms: [{ ...room, roomId: '101' }], total: 1, page: 1, pageSize: 12, totalPages: 1 }));
    assert.ok(document.querySelector('.filter-sheet').contains(document.activeElement), 'refresh must keep focus inside the filter');
    await act(async () => document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.ok(document.activeElement === trigger, 'Escape restores focus to the filter trigger');
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
