import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations, seedDatabase } from '../server/database.js';
import { startRoomMatchServer } from '../server/app.js';
import { createToken } from '../server/auth.js';
import { validateListing, completedListingImageUrls } from '../shared/listingValidation.js';

// Execute the page's actual handler with controlled React state and form boundaries.
// State setters deliberately do not rerender: a state-only guard cannot pass this test.
const source = readFileSync(new URL('../src/pages/ListingFormPage.tsx', import.meta.url), 'utf8');
const handler = source.match(/const submit = (async \(event: FormEvent<HTMLFormElement>\) => \{[\s\S]*?\n  \});/)[1];
const compiled = `const submit = ${handler.replace('event: FormEvent<HTMLFormElement>', 'event')};`;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(t, editing = false) {
  const directory = mkdtempSync(join(tmpdir(), 'roommatch-submit-'));
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  assert.equal(db.prepare('PRAGMA database_list').get().file, '');
  runMigrations(db); seedDatabase(db);
  const app = await startRoomMatchServer({ db, port: 0, uploadDirectory: directory, logger: { error() {} } });
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); db.close(); rmSync(directory, { recursive: true, force: true }); });
  const baseline = db.prepare('SELECT count(*) AS count FROM ROOM').get().count;
  const state = { saving: false, errors: {}, requests: 0, uploads: 0, navigations: [], fail: false, gate: deferred(), uploadGate: deferred() };
  const images = [{ id: 'selected', file: { name: 'test.png' }, url: '' }];
  const values = { title: 'Repeated submit', description: 'Keep this text', price: '3500', capacity: '2', googleMapsUrl: 'https://maps.google.com/?q=Bangkok', priceBasis: 'per_room', locality: 'Bangkok', costNotes: '' };
  const request = async (method, path, payload) => {
    state.requests++;
    await state.gate.promise;
    if (state.fail) throw new Error('Test request failed');
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/rooms${path}`, { method, headers: { Authorization: `Bearer ${createToken(1)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    assert.ok(response.ok, await response.text());
  };
  const dependencies = {
    checkingImages: false, saving: false, submitLocked: { current: false },
    setSaving: value => { state.saving = value; }, setFocusErrors() {}, setErrors: value => { state.errors = value; },
    FormData: class { constructor() { return Object.entries(values); } },
    validateListing, completedListingImageUrls, images, existing: editing ? { roomId: '1', memberCount: 0 } : null,
    fieldsWithErrors: { current: new Set() }, status: 'available', listingFields: Object.keys(values).concat('images'),
    uploadSelectedImages: async (selected, onUploaded) => {
      state.uploads++; await state.uploadGate.promise;
      if (state.uploadFail) throw new Error('Test upload failed');
      const uploaded = { id: selected[0].id, url: 'https://example.test/test.png' };
      onUploaded(uploaded); return [uploaded.url];
    },
    setImages: next => { images.splice(0, images.length, ...next); }, updateImageFeedback() {},
    api: { createRoom: payload => request('POST', '', payload), updateRoom: (id, payload) => request('PATCH', `/${id}`, payload) },
    ApiError: class extends Error { constructor(message, status, fieldErrors = {}) { super(message); this.status = status; this.fieldErrors = fieldErrors; } }, notify() {}, navigate: path => state.navigations.push(path),
  };
  const submit = new Function(...Object.keys(dependencies), `${compiled}\nreturn submit;`)(...Object.values(dependencies));
  const event = { preventDefault() {}, currentTarget: {} };
  return { state, values, images, submit: () => submit(event), count: () => db.prepare('SELECT count(*) AS count FROM ROOM').get().count - baseline };
}

for (const editing of [false, true]) {
  test(`${editing ? 'edit' : 'create'}: repeated submits during upload/request and after success send once`, async t => {
    const f = await fixture(t, editing);
    const first = f.submit();
    Array.from({ length: 10 }, f.submit);
    assert.equal(f.state.uploads, 1);
    assert.equal(f.state.saving, true);
    f.state.uploadGate.resolve();
    await new Promise(resolve => setImmediate(resolve));
    Array.from({ length: 10 }, f.submit);
    assert.equal(f.state.requests, 1);
    f.state.gate.resolve(); await first;
    assert.equal(f.count(), editing ? 0 : 1);
    assert.deepEqual(f.state.navigations, ['/my-listings']);
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
  assert.equal(f.state.saving, false); assert.match(f.state.errors.form, /Test request failed/);
  assert.equal(f.count(), 0); assert.deepEqual(f.values, original);
  assert.equal(f.images[0].url, 'https://example.test/test.png');
  f.state.fail = false;
  await f.submit();
  assert.equal(f.state.requests, 2); assert.equal(f.count(), 1);
});

test('validation failure unlocks so corrected values can be submitted', async t => {
  const f = await fixture(t);
  f.values.title = ''; await f.submit();
  assert.ok(f.state.errors.title); assert.equal(f.state.requests, 0);
  f.values.title = 'Corrected'; f.state.uploadGate.resolve(); f.state.gate.resolve();
  await f.submit(); assert.equal(f.count(), 1);
});



test('upload failure unlocks and keeps the selected file for retry', async t => {
  const f = await fixture(t);
  const file = f.images[0].file;
  f.state.uploadFail = true; f.state.uploadGate.resolve(); f.state.gate.resolve();
  await f.submit();
  assert.equal(f.state.saving, false);
  assert.match(f.state.errors.images, /Test upload failed/);
  assert.equal(f.images[0].file, file);
  assert.equal(f.state.requests, 0);
  f.state.uploadFail = false;
  await f.submit();
  assert.equal(f.state.requests, 1); assert.equal(f.count(), 1);
});
