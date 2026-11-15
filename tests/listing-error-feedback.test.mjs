import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

test('listing errors render once at the image, field or above the save buttons', async t => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  t.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
    delete globalThis.__listingFeedbackTestErrors;
  });
  const vite = await createServer({
    configFile: false, envDir: false,
    plugins: [{
      name: 'seed-listing-errors-for-render', enforce: 'pre',
      transform(code, id) {
        if (id.replaceAll('\\', '/').endsWith('/src/pages/ListingFormPage.tsx')) {
          // Seed only the initial errors; render the real page and child components.
          return code.replace('useState<Record<string, string>>({})', 'useState<Record<string, string>>(globalThis.__listingFeedbackTestErrors)');
        }
      },
    }, react()],
    server: { middlewareMode: true, watch: null, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] },
  });
  t.after(() => vite.close());
  const { ListingFormPage } = await vite.ssrLoadModule('/src/pages/ListingFormPage.tsx');
  const { AppProvider } = await vite.ssrLoadModule('/src/AppContext.tsx');
  for (const [field, message] of [
    ['images', 'อัปโหลดรูปไม่สำเร็จ กรุณาลองอีกครั้ง'],
    ['form', 'บันทึกประกาศไม่สำเร็จ กรุณาลองอีกครั้ง'],
    ['title', 'กรุณาตรวจสอบหัวข้อประกาศ'],
  ]) {
    globalThis.__listingFeedbackTestErrors = { [field]: message };
    const html = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(AppProvider, null, createElement(ListingFormPage))));
    assert.equal(html.split(message).length - 1, 1);
    const position = html.indexOf(message);
    const footer = html.indexOf('<footer');
    if (field === 'form') {
      assert.ok(position > footer && position < html.indexOf('class="form-action-buttons"'));
      assert.match(html, /class="form-feedback" role="alert" tabindex="-1"/);
    } else {
      assert.ok(position < footer);
      assert.doesNotMatch(html, /class="form-feedback"/);
      if (field === 'images') assert.ok(position > html.indexOf('data-error-field="images"'));
      else assert.ok(position < html.indexOf('data-error-field="images"'));
    }
  }
});

test('feedback effect focuses and scrolls to the related field, image group or save error', () => {
  const source = readFileSync(new URL('../src/components/FormFeedback.tsx', import.meta.url), 'utf8');
  const effect = source.match(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[errors, form, focusOnError\]\);/)[1]
    .replace('querySelectorAll<HTMLElement>', 'querySelectorAll');
  class Element {
    constructor(name, errorField) { this.name = name; this.dataset = { errorField }; this.calls = []; }
    getAttribute() { return this.name; }
    focus(options) { this.calls.push(['focus', options]); }
    scrollIntoView(options) { this.calls.push(['scroll', options]); }
  }
  for (const key of ['title', 'images', 'form']) {
    const input = new Element('title');
    const group = new Element(null, 'images');
    const summary = new Element();
    const form = { current: { elements: [input], querySelectorAll: () => [group] } };
    const run = new Function('errors', 'form', 'summary', 'focusOnError', 'HTMLElement', 'requestAnimationFrame', 'cancelAnimationFrame', effect);
    run({ [key]: 'error' }, form, { current: summary }, true, Element, callback => { callback(); return 1; }, () => {});
    const target = key === 'title' ? input : key === 'images' ? group : summary;
    assert.deepEqual(target.calls, [['focus', { preventScroll: true }], ['scroll', { block: 'center', behavior: 'instant' }]]);
    for (const other of [input, group, summary].filter(element => element !== target)) assert.deepEqual(other.calls, []);
  }
});
