import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

test('listing form marks required fields, keeps optional text optional and starts without errors', async t => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => null } });
  t.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, 'sessionStorage', previousStorage);
    else delete globalThis.sessionStorage;
  });
  const vite = await createServer({
    configFile: false, envDir: false, plugins: [react()],
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  t.after(() => vite.close());
  const { ListingFormPage } = await vite.ssrLoadModule('/src/pages/ListingFormPage.tsx');
  const { AppProvider } = await vite.ssrLoadModule('/src/AppContext.tsx');
  const html = renderToStaticMarkup(createElement(RouterProvider, { router: createMemoryRouter([{ path: '*',
    element: createElement(AppProvider, null, createElement(ListingFormPage)) }]) }));
  for (const name of ['title', 'price', 'capacity', 'googleMapsUrl', 'priceBasis', 'locality']) {
    const input = html.match(new RegExp(`<(?:input|select)\\b[^>]*name="${name}"[^>]*>`))?.[0];
    assert.ok(input, name);
    assert.match(input, /\brequired=""/, name);
  }
  for (const name of ['description', 'costNotes']) {
    const textarea = html.match(new RegExp(`<textarea\\b[^>]*name="${name}"[^>]*>`))?.[0];
    assert.ok(textarea, name);
    assert.doesNotMatch(textarea, /\brequired=/, name);
  }
  for (const label of ['หัวข้อประกาศ', 'ราคา / เดือน', 'จำนวนผู้พัก', 'Google Maps URL', 'หน่วยราคา', 'ย่านหรือถนน', 'รูปภาพห้อง']) {
    assert.ok(html.replace(/<[^>]*>/g, "").includes(`${label} *`), label);
  }
  assert.match(html, /aria-required="true"/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp,image\/gif,image\/avif,[^"]*\.jfif[^"]*"/);
  assert.doesNotMatch(html, /class="field-error"|class="form-feedback"|aria-invalid="true"/);
  const { ImagePicker } = await vite.ssrLoadModule('/src/components/ImagePicker.tsx');
  const imageHtml = renderToStaticMarkup(createElement(ImagePicker, {
    images: [{ id: 'pending', url: '', file: {} }], onChange() {}, max: 12, label: 'รูปภาพห้อง', required: true,
    fieldName: 'images', error: 'กรุณาเพิ่มรูปห้องอย่างน้อย 1 รูป',
  }));
  assert.match(imageHtml, /tabindex="-1"/);
  assert.match(imageHtml, /data-error-field="images"/);
  assert.match(imageHtml, /aria-invalid="true"/);
  assert.match(imageHtml, /<span>1\/12 รูป<\/span>/);
  const describedIds = imageHtml.match(/aria-describedby="([^"]+)"/)[1].split(' ');
  assert.equal(describedIds.length, 2);
  for (const id of describedIds) assert.ok(imageHtml.includes(`id="${id}"`));
  assert.equal(imageHtml.split('กรุณาเพิ่มรูปห้องอย่างน้อย 1 รูป').length - 1, 1);
});
