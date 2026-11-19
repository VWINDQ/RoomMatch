import './helpers/load-client.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

test('initial loads and page buttons fetch immediately while successive search changes are debounced', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client');
  const { MemoryRouter } = await import('react-router-dom');
  const { useRoomPagination } = await import('../src/lib/useRoomPagination.ts');
  const calls = [];
  const load = async params => {
    calls.push(new URLSearchParams(params));
    return { rooms: [], total: 30, page: Number(params.get('page')), pageSize: 12, totalPages: 3 };
  };
  function Probe() {
    const { changePage, changeParams } = useRoomPagination(load, 12, {}, 250);
    return createElement('div', null,
      createElement('button', { onClick: () => changePage(2) }, 'next'),
      createElement('button', { onClick: () => changeParams({ q: 'บาง' }) }, 'search-one'),
      createElement('button', { onClick: () => changeParams({ q: 'บางมด' }) }, 'search-two'));
  }
  const root = createRoot(document.getElementById('root'));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const tick = amount => act(async () => t.mock.timers.tick(amount));
  const click = index => act(async () => document.querySelectorAll('button')[index].click());
  try {
    await act(async () => root.render(createElement(MemoryRouter, null, createElement(Probe))));
    await tick(0);
    assert.equal(calls.length, 1);
    await click(0); await tick(0);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].get('page'), '2');
    await click(1); await tick(200); await click(2); await tick(249);
    assert.equal(calls.length, 2, 'typing must not send intermediate searches');
    await tick(1);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].get('q'), 'บางมด');
    assert.equal(calls[2].get('page'), '1');
  } finally { await act(async () => root.unmount()); t.mock.timers.reset(); dom.window.close(); }
});
