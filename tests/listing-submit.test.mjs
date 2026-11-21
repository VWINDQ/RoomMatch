import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './support/postgres.mjs';
import { startRoomMatchServer } from '../server/app.js';
import { createToken } from '../server/auth.js';
import { validateListing, completedListingImageUrls } from '../shared/listingValidation.js';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import sharp from 'sharp';

let vite, api, ApiError, listingSaveFeedback, uploadSelectedImages;
before(async () => {
  vite = await createServer({ configFile: false, envDir: false, plugins: [react()], server: { middlewareMode: true, watch: null, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
  ({ api, ApiError } = await vite.ssrLoadModule('/src/lib/api.ts'));
  ({ listingSaveFeedback } = await vite.ssrLoadModule('/src/lib/listingSaveFeedback.ts'));
  ({ uploadSelectedImages } = await vite.ssrLoadModule('/src/components/ImagePicker.tsx'));
});
after(() => vite?.close());

// Execute the page's actual handler with controlled React state and form boundaries.
// State setters deliberately do not rerender: a state-only guard cannot pass this test.
const source = readFileSync(new URL('../src/pages/ListingFormPage.tsx', import.meta.url), 'utf8');
const handler = source.match(/const submit = (async \(event: FormEvent<HTMLFormElement>\) => \{[\s\S]*?\n  \});/)[1];
const compiled = `const submit = ${handler.replace('event: FormEvent<HTMLFormElement>', 'event')};`;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(t, editing = false, onSaveResponse = () => {}) {
  const directory = mkdtempSync(join(tmpdir(), 'roommatch-submit-'));
  const db = await openDatabase({ filename: ':memory:' });
  let app;
  t.after(async () => {
    try { if (app) await new Promise(resolve => app.server.close(resolve)); }
    finally {
      try { await db.close(); }
      finally { rmSync(directory, { recursive: true, force: true }); }
    }
  });
  app = await startRoomMatchServer({ db, port: 0, uploadDirectory: directory, logger: { error() {} } });
  const baseline = (await db.prepare('SELECT count(*) AS count FROM room').get()).count;
  const state = { saving: false, errors: {}, requests: 0, uploads: 0, navigations: [], fail: false, gate: deferred(), uploadGate: deferred(), requestStarted: deferred() };
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).png().toBuffer();
  const images = [{ id: 'selected', file: new File([bytes], 'test.png', { type: 'image/png' }), url: '' }];
  const values = { title: 'Repeated submit', description: 'Keep this text', price: '3500', capacity: '2', googleMapsUrl: 'https://maps.google.com/?q=Bangkok', priceBasis: 'per_room', locality: 'Bangkok', costNotes: '' };
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  // Browser storage returns the same token until a session explicitly changes.
  const token = createToken(1);
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => token } });
  t.after(() => { if (previousStorage) Object.defineProperty(globalThis, 'sessionStorage', previousStorage); else delete globalThis.sessionStorage; });
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    const uploading = path === '/api/uploads/images';
    if (uploading) { state.uploads++; await state.uploadGate.promise; }
    else {
      state.requests++;
      state.requestStarted.resolve(); await state.gate.promise;
    }
    if (uploading ? (state.uploadFail || state.failUploadAt === state.uploads) : state.fail) throw new TypeError('Failed to fetch');
    const failure = uploading ? state.uploadResponse : state.saveResponse;
    if (failure) return new Response(JSON.stringify(failure.body), { status: failure.status });
    const response = await realFetch(`http://127.0.0.1:${app.server.address().port}${path}`, options);
    if (!uploading) onSaveResponse();
    if (!uploading && state.loseResponse) { await response.arrayBuffer(); throw new TypeError('Connection lost after commit'); }
    return response;
  });
  const dependencies = {
    checkingImages: false, saving: false, ownerIsResident: false, minimumCapacity: 1, submitLocked: { current: false }, mounted: { current: true },
    setSaving: value => { state.saving = value; }, setFocusErrors: value => { state.focusErrors = value; }, setErrors: value => { state.errors = value; },
    FormData: class { constructor() { return Object.entries(values); } },
    validateListing, completedListingImageUrls, images, existing: editing ? { roomId: '1', memberCount: 0 } : null,
    fieldsWithErrors: { current: new Set() }, status: 'available', listingFields: Object.keys(values).concat('images'),
    uploadSelectedImages, listingSaveFeedback,
    setImages: next => { images.splice(0, images.length, ...next); }, updateImageFeedback() {},
    api, notify() {}, saveBeforeLeave: { current: false }, showSaveErrors: () => { state.focusErrors = true; },
    markSaved: () => { state.saved = true; }, returnToList: () => state.navigations.push('/my-listings'),
  };
  const submit = new Function(...Object.keys(dependencies), `${compiled}\nreturn submit;`)(...Object.values(dependencies));
  const event = { preventDefault() {}, currentTarget: {} };
  return { state, values, images, submit: () => submit(event), count: async () => (await db.prepare('SELECT count(*) AS count FROM room').get()).count - baseline };
}

for (const editing of [false, true]) {
  test(`${editing ? 'edit' : 'create'}: repeated submits during upload/request and after success send once`, async t => {
    const f = await fixture(t, editing);
    const first = f.submit();
    Array.from({ length: 10 }, f.submit);
    assert.equal(f.state.uploads, 1);
    assert.equal(f.state.saving, true);
    f.state.uploadGate.resolve();
    await f.state.requestStarted.promise;
    Array.from({ length: 10 }, f.submit);
    assert.equal(f.state.requests, 1);
    f.state.gate.resolve(); await first;
    assert.equal(await f.count(), editing ? 0 : 1);
    assert.deepEqual(f.state.navigations, ['/my-listings']);
    assert.equal(f.state.saved, true);
    await f.submit();
    assert.equal(f.state.requests, 1);
    assert.equal(f.state.saving, true);
  });
}

test('failure unlocks for retry and preserves form values and completed image', async t => {
  const f = await fixture(t);
  const original = { ...f.values };
  f.state.fail = true; f.state.uploadGate.resolve(); f.state.gate.resolve();
  await f.submit();
  assert.notEqual(f.state.saved, true);
  assert.equal(f.state.saving, false); assert.deepEqual(f.state.errors, { form: 'บันทึกประกาศไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง' });
  assert.equal(await f.count(), 0); assert.deepEqual(f.values, original);
  assert.match(f.images[0].url, /^\/uploads\/1\//);
  f.state.fail = false;
  await f.submit();
  assert.equal(f.state.requests, 2); assert.equal(await f.count(), 1);
  assert.equal(f.state.uploads, 1);
});

test('validation failure unlocks so corrected values can be submitted', async t => {
  const f = await fixture(t);
  f.values.title = ''; await f.submit();
  assert.ok(f.state.errors.title); assert.equal(f.state.requests, 0);
  f.values.title = 'Corrected'; f.state.uploadGate.resolve(); f.state.gate.resolve();
  await f.submit(); assert.equal(await f.count(), 1);
});



test('upload failure unlocks and keeps the selected file for retry', async t => {
  const f = await fixture(t);
  const file = f.images[0].file;
  f.state.uploadFail = true; f.state.uploadGate.resolve(); f.state.gate.resolve();
  await f.submit();
  assert.equal(f.state.saving, false);
  assert.deepEqual(f.state.errors, { images: 'อัปโหลดรูปไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง' });
  assert.equal(f.images[0].file, file);
  assert.equal(f.state.requests, 0);
  f.state.uploadFail = false;
  await f.submit();
  assert.equal(f.state.requests, 1); assert.equal(await f.count(), 1);
});

for (const stage of ['upload', 'save']) {
  test(`${stage}: server error is safe, appears only at its stage, and permits retry`, async t => {
    const f = await fixture(t);
    f.state[`${stage}Response`] = { status: 500, body: { error: 'SQLITE_ERROR: private database detail' } };
    f.state.uploadGate.resolve(); f.state.gate.resolve();
    await f.submit();
    assert.deepEqual(f.state.errors, stage === 'upload'
      ? { images: 'อัปโหลดรูปไม่สำเร็จ กรุณาลองอีกครั้ง' }
      : { form: 'บันทึกประกาศไม่สำเร็จ กรุณาลองอีกครั้ง' });
    assert.equal(f.state.focusErrors, true);
    assert.equal(f.state.saving, false); assert.equal(await f.count(), 0);
    f.state[`${stage}Response`] = null;
    await f.submit();
    assert.equal(await f.count(), 1);
    assert.equal(f.state.uploads, stage === 'upload' ? 2 : 1);
  });
}

test('API field errors stay under the field without a duplicate form error', async t => {
  const f = await fixture(t);
  f.state.saveResponse = { status: 400, body: { error: 'Invalid listing fields', fieldErrors: { title: 'กรุณาตรวจสอบหัวข้อประกาศ', internal: 'private' } } };
  f.state.uploadGate.resolve(); f.state.gate.resolve();
  await f.submit();
  assert.deepEqual(f.state.errors, { title: 'กรุณาตรวจสอบหัวข้อประกาศ' });
  assert.equal(f.state.focusErrors, true); assert.equal(f.state.saving, false);
  f.state.saveResponse = null; await f.submit();
  assert.equal(await f.count(), 1); assert.equal(f.state.uploads, 1);
});

test('lost response after committed creation cannot prevent another room on retry', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  // A response may arrive in a later second without the stored session changing.
  const f = await fixture(t, false, () => { now += 2_000; });
  f.state.loseResponse = true; f.state.uploadGate.resolve(); f.state.gate.resolve();
  await f.submit();
  assert.equal(await f.count(), 1);
  assert.deepEqual(f.state.errors, { form: 'บันทึกประกาศไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง' });
  f.state.loseResponse = false; await f.submit();
  assert.equal(await f.count(), 2); assert.equal(f.state.requests, 2); assert.equal(f.state.uploads, 1);
  assert.deepEqual(f.state.errors, {});
  assert.deepEqual(f.state.navigations, ['/my-listings']);
});

test('correcting the form after a failed save permits retry without reuploading', async t => {
  const f = await fixture(t);
  f.state.fail = true; f.state.uploadGate.resolve(); f.state.gate.resolve();
  await f.submit();
  f.values.title = 'New title'; f.state.fail = false; await f.submit();
  assert.equal(await f.count(), 1); assert.equal(f.state.uploads, 1);
});

test('network wording requires an explicit fetch failure; safe HTTP causes remain actionable', () => {
  assert.deepEqual(listingSaveFeedback(new ApiError('Authentication required', 401), 'save', []), { form: 'กรุณาเข้าสู่ระบบอีกครั้ง' });
  assert.deepEqual(listingSaveFeedback(new Error('network? private detail'), 'save', []), { form: 'บันทึกประกาศไม่สำเร็จ กรุณาลองอีกครั้ง' });
  assert.deepEqual(listingSaveFeedback(new ApiError('Unknown', 0), 'upload', []), { images: 'อัปโหลดรูปไม่สำเร็จ กรุณาลองอีกครั้ง' });
});

test('partial upload failure retries only the remaining file', async t => {
  const f = await fixture(t);
  f.images.push({ id: 'second', file: f.images[0].file, url: '' });
  f.state.failUploadAt = 2; f.state.uploadGate.resolve(); f.state.gate.resolve();
  await f.submit();
  assert.equal(f.state.uploads, 2); assert.equal(f.state.requests, 0);
  const savedUrl = f.images[0].url;
  assert.match(savedUrl, /^\/uploads\/1\//); assert.equal(f.images[0].file, undefined);
  assert.ok(f.images[1].file); assert.equal(f.state.saving, false);
  await f.submit();
  assert.equal(f.state.uploads, 3); assert.equal(f.state.requests, 1); assert.equal(await f.count(), 1);
  assert.equal(f.images[0].url, savedUrl);
});
