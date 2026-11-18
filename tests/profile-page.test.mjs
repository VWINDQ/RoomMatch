import './helpers/load-client.mjs';
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, mock, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, FormData: dom.window.FormData,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  IS_REACT_ACT_ENVIRONMENT: true,
});
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { AppProvider } = await import('../src/AppContext.tsx');
const { ProfilePage } = await import('../src/pages/ProfilePage.tsx');
const { api, ApiError } = await import('../src/lib/api.ts');

let root, profile, save, upload;
beforeEach(() => {
  localStorage.clear();
  profile = {
    user: { userId: '1', firstName: 'Profile', lastName: 'Test', email: 'profile@example.test',
      phone: '0890000000', gender: '', dateOfBirth: '2000-12-25', university: '',
      profileImage: 'https://example.test/original.jpg', bio: '', lineId: '', instagram: '' },
    lifestyle: null, preference: null,
  };
  mock.method(api, 'profile', async () => structuredClone(profile));
  save = mock.method(api, 'updateProfile', async payload => {
    profile = { user: { ...profile.user, ...payload },
      lifestyle: payload.lifestyleName ? { lifestyleName: payload.lifestyleName } : profile.lifestyle,
      preference: payload.preference };
    return structuredClone(profile);
  });
  upload = mock.method(api, 'uploadImage', async () => '/uploads/1/review.webp');
  root = createRoot(document.getElementById('root'));
});
afterEach(async () => { await act(async () => root.unmount()); mock.restoreAll(); });
after(() => dom.window.close());

const field = name => document.querySelector(`[name="${name}"]`);
const button = label => [...document.querySelectorAll('button')].find(element => element.textContent === label);
async function mountEditor() {
  await act(async () => root.render(createElement(MemoryRouter, null, createElement(AppProvider, null, createElement(ProfilePage)))));
  assert.ok(document.querySelector('.profile-summary'));
  await act(async () => button('แก้ไขโปรไฟล์').click());
}
async function change(name, value) {
  const input = field(name);
  const prototype = input instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}
const submit = () => act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
async function chooseImage() {
  const file = new File([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0)], 'profile.png', { type: 'image/png' });
  const input = document.querySelector('input[type="file"]');
  assert.ok(input);
  await act(async () => {
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  return file;
}

test('profile renders, retains birth date and age, and saves a complete edit', async () => {
  await mountEditor();
  assert.equal(field('dateOfBirth').value, '25/12/2000');
  await change('firstName', 'Updated');
  await change('bio', 'Updated biography');
  await change('lifestyleName', 'ก'.repeat(400));
  await submit();
  assert.equal(save.mock.callCount(), 1);
  const payload = save.mock.calls[0].arguments[0];
  assert.equal(payload.dateOfBirth, '2000-12-25');
  assert.equal(payload.phone, '0890000000');
  assert.equal(payload.bio, 'Updated biography');
  assert.equal(payload.lifestyleName.length, 400);
  assert.equal(document.querySelector('form'), null);
  assert.match(document.querySelector('.profile-identity').textContent, /Updated/);
  assert.match(document.querySelector('.profile-personal-data').textContent, /อายุ\d+ ปี/);
  await act(async () => button('แก้ไขโปรไฟล์').click());
  assert.equal(field('dateOfBirth').value, '25/12/2000');
});

test('invalid birth dates show visible field feedback and block saving; empty date remains optional', async () => {
  await mountEditor();
  for (const value of ['25/12/3000', '29/02/2001', '2000-12-25']) {
    await change('dateOfBirth', value);
    await submit();
    assert.equal(save.mock.callCount(), 0, value);
    assert.equal(field('dateOfBirth').getAttribute('aria-invalid'), 'true');
    assert.ok(field('dateOfBirth').closest('label').querySelector('.field-error').textContent);
    assert.ok(document.querySelector('.form-feedback[role="alert"]'));
  }
  await change('dateOfBirth', '');
  await submit();
  assert.equal(save.mock.calls[0].arguments[0].dateOfBirth, '');
});

test('incomplete phone is rejected and a corrected ten-digit phone can be saved', async () => {
  await mountEditor();
  await change('phone', '1');
  await submit();
  assert.equal(save.mock.callCount(), 0);
  assert.match(field('phone').closest('label').textContent, /10/);
  await change('phone', '0812345678');
  await submit();
  assert.equal(save.mock.calls[0].arguments[0].phone, '0812345678');
});

test('edited image URLs are saved, invalid URLs are reported, and removing an image clears it', async () => {
  await mountEditor();
  await change('profileImage', 'javascript:alert(1)');
  await submit();
  assert.equal(save.mock.callCount(), 0);
  assert.equal(field('profileImage').getAttribute('aria-invalid'), 'true');
  await change('profileImage', 'https://example.test/replacement.jpg');
  await submit();
  assert.equal(save.mock.calls[0].arguments[0].profileImage, 'https://example.test/replacement.jpg');
  assert.equal(upload.mock.callCount(), 0);
  await act(async () => button('แก้ไขโปรไฟล์').click());
  await act(async () => document.querySelector('[aria-label="ลบรูปโปรไฟล์"]').click());
  assert.equal(field('profileImage').value, '');
  await submit();
  assert.equal(save.mock.calls[1].arguments[0].profileImage, '');
});

test('cancelling an image edit restores the saved image when reopening the form', async () => {
  await mountEditor();
  await chooseImage();
  await act(async () => button('ยกเลิก').click());
  await act(async () => button('แก้ไขโปรไฟล์').click());
  assert.equal(field('profileImage').value, profile.user.profileImage);
  await submit();
  assert.equal(upload.mock.callCount(), 0);
  assert.equal(save.mock.calls[0].arguments[0].profileImage, 'https://example.test/original.jpg');
});

test('selected image is uploaded once and a failed profile save can retry without losing edits', async () => {
  await mountEditor();
  await change('bio', 'Keep my edits');
  const file = await chooseImage();
  save.mock.mockImplementationOnce(async () => { throw new ApiError('Service unavailable', 503); });
  await submit();
  assert.equal(upload.mock.callCount(), 1);
  assert.equal(upload.mock.calls[0].arguments[0], file);
  assert.equal(save.mock.calls[0].arguments[0].profileImage, '/uploads/1/review.webp');
  assert.equal(field('bio').value, 'Keep my edits');
  assert.ok(document.querySelector('.form-feedback'));
  await submit();
  assert.equal(upload.mock.callCount(), 1);
  assert.equal(save.mock.callCount(), 2);
  assert.equal(profile.user.profileImage, '/uploads/1/review.webp');
});

test('upload errors preserve the selected file and never submit an incomplete profile', async () => {
  await mountEditor();
  await chooseImage();
  upload.mock.mockImplementationOnce(async () => { throw new Error('อัปโหลดรูปไม่สำเร็จ'); });
  await submit();
  assert.equal(save.mock.callCount(), 0);
  assert.match(document.querySelector('.form-feedback').textContent, /อัปโหลดรูปไม่สำเร็จ/);
  await submit();
  assert.equal(upload.mock.callCount(), 2);
  assert.equal(save.mock.callCount(), 1);
});

test('repeated submit while saving sends one request and locks editing until completion', async () => {
  await mountEditor();
  let resolveSave;
  save.mock.mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }));
  const form = document.querySelector('form');
  await act(async () => {
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });
  assert.equal(save.mock.callCount(), 1);
  assert.equal(field('firstName').matches(':disabled'), true);
  assert.equal(button('ยกเลิก').matches(':disabled'), true);
  await act(async () => resolveSave(structuredClone(profile)));
  assert.equal(document.querySelector('form'), null);
});
