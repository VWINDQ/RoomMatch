import './helpers/load-client.mjs';
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement, useRef, useState } from 'react';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  HTMLSelectElement: dom.window.HTMLSelectElement, IS_REACT_ACT_ENVIRONMENT: true,
});
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider } = await import('react-router-dom');
const { useFormLeaveGuard } = await import('../src/lib/useFormLeaveGuard.ts');

let root, router, guard, setImages;
function Editor() {
  const formRef = useRef(null);
  const [images, updateImages] = useState([]);
  setImages = updateImages;
  guard = useFormLeaveGuard(formRef, images, 'active', true, null);
  return createElement('form', { ref: formRef }, createElement('input', { name: 'title', defaultValue: 'Original' }));
}

beforeEach(async () => {
  root = createRoot(document.getElementById('root'));
  router = createMemoryRouter([{ path: '/', element: createElement(Editor) }]);
  await act(async () => root.render(createElement(RouterProvider, { router })));
});
afterEach(async () => { await act(async () => root.unmount()); router.dispose(); });
after(() => dom.window.close());

test('a retained blocker callback does not treat an unmounted form as unsaved changes', async () => {
  const hasChanges = guard.hasChanges;
  assert.equal(hasChanges(), false);
  await act(async () => root.render(null));
  assert.equal(hasChanges(), false);
});

test('a disconnected dirty form cannot block navigation while cleanup is pending', () => {
  const form = document.querySelector('form');
  form.elements.title.value = 'Unsaved';
  assert.equal(guard.hasChanges(), true);
  const parent = form.parentNode;
  form.remove();
  try {
    assert.equal(guard.hasChanges(), false);
  } finally {
    parent.appendChild(form);
  }
});

test('a retained blocker callback reads the latest image changes and reverted values', async () => {
  const hasChanges = guard.hasChanges;
  assert.equal(hasChanges(), false);
  await act(async () => setImages([{ id: 'new-image', url: 'https://example.test/room.jpg' }]));
  assert.equal(hasChanges(), true);
  await act(async () => setImages([]));
  assert.equal(hasChanges(), false);
});
