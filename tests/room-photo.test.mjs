import './helpers/load-client.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

test('compact demo photos fall back to their original URL before showing an error, and external images stay unchanged', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client');
  const { RoomPhoto } = await import('../src/components/RoomPhoto.tsx');
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(createElement(RoomPhoto, { src: 'http://localhost:5173/assets/room-main.png', alt: 'ห้องเดโม' })));
    assert.match(document.querySelector('img').src, /room-main\.webp$/);
    await act(async () => document.querySelector('img').dispatchEvent(new dom.window.Event('error')));
    assert.match(document.querySelector('img').src, /room-main\.png$/);
    await act(async () => document.querySelector('img').dispatchEvent(new dom.window.Event('error')));
    assert.equal(document.querySelector('img'), null);
    assert.match(document.querySelector('[role="img"]').getAttribute('aria-label'), /โหลดรูปไม่สำเร็จ/);
    const external = 'https://example.test/assets/room-main.png';
    await act(async () => root.render(createElement(RoomPhoto, { src: external, alt: 'ห้องอื่น', priority: true })));
    assert.equal(document.querySelector('img').src, external);
    assert.equal(document.querySelector('img').getAttribute('loading'), 'eager');
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
