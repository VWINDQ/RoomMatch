import './helpers/load-client.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

test('gallery reveals offscreen selections inside the thumbnail rail and wraps back to the first photo', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client');
  const { RoomGallery } = await import('../src/components/RoomGallery.tsx');
  const root = createRoot(document.getElementById('root'));
  const room = { roomId: '1', title: 'ห้องทดสอบ', images: Array.from({ length: 12 }, (_, i) => ({ imageId: String(i), imageUrl: `/photo-${i}.webp` })) };
  const click = async name => act(async () => document.querySelector(`[aria-label="${name}"]`).click());
  try {
    await act(async () => root.render(createElement(RoomGallery, { room })));
    const rail = document.querySelector('.gallery-thumbs-scroll');
    // jsdom has no layout engine; model a rail that exposes three thumbnails.
    Object.defineProperty(rail, 'clientHeight', { value: 300 });
    [...rail.children].forEach((button, index) => {
      Object.defineProperty(button, 'offsetTop', { value: index * 100 });
      Object.defineProperty(button, 'offsetHeight', { value: 90 });
    });
    await click('รูปก่อนหน้า');
    assert.equal(document.querySelector('.gallery-main > span').textContent, '12 / 12');
    assert.equal(rail.scrollTop, 890);
    assert.equal(rail.children[11].getAttribute('aria-pressed'), 'true');
    await click('รูปถัดไป');
    assert.equal(document.querySelector('.gallery-main > span').textContent, '1 / 12');
    assert.equal(rail.scrollTop, 0);
    await click('ดูรูปที่ 9');
    assert.equal(document.querySelector('.gallery-main > img').getAttribute('src'), '/photo-8.webp');
    assert.equal(rail.scrollTop, 590);
    await act(async () => root.render(createElement(RoomGallery, { room: { ...room, images: room.images.slice(0, 2) } })));
    assert.equal(document.querySelector('.gallery-main > span').textContent, '2 / 2');
    await act(async () => root.render(createElement(RoomGallery, { room: { ...room, roomId: '2', images: room.images.slice(0, 1) } })));
    assert.equal(document.querySelector('.gallery-main > span').textContent, '1 / 1');
    assert.equal(document.querySelector('.gallery-thumbs'), null);
    await act(async () => root.render(createElement(RoomGallery, { room: { ...room, images: [] } })));
    assert.match(document.querySelector('.gallery-empty').textContent, /ยังไม่มีรูปภาพ/);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
