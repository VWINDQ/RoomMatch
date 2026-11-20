import './helpers/load-client.mjs';
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, mock, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, FormData: dom.window.FormData,
  HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  HTMLSelectElement: dom.window.HTMLSelectElement,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  IS_REACT_ACT_ENVIRONMENT: true,
});
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider, Outlet } = await import('react-router-dom');
const { AppProvider, useApp } = await import('../src/AppContext.tsx');
const { ProfilePage } = await import('../src/pages/ProfilePage.tsx');
const { api, ApiError } = await import('../src/lib/api.ts');

let root, profile, save, upload, router, app;
function SessionProbe() { app = useApp(); return null; }
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
afterEach(async () => { await act(async () => root.unmount()); router?.dispose(); mock.restoreAll(); });
after(() => dom.window.close());

const field = name => document.querySelector(`[name="${name}"]`);
const button = label => [...document.querySelectorAll('button')].find(element => element.textContent === label);
async function mountEditor() {
  router = createMemoryRouter([{ element: createElement(AppProvider, null, createElement(SessionProbe), createElement(Outlet)), children: [
    { path: '/profile', element: createElement(ProfilePage) },
    { path: '*', element: createElement('p', null, 'Destination') },
  ] }], { initialEntries: ['/rooms', '/profile'], initialIndex: 1 });
  await act(async () => root.render(createElement(RouterProvider, { router })));
  assert.ok(document.querySelector('.profile-summary'));
  if (button('แก้ไขโปรไฟล์')) await act(async () => button('แก้ไขโปรไฟล์').click());
}
async function change(name, value) {
  const input = field(name);
  const prototype = input instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement.prototype : input instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
    input.dispatchEvent(new dom.window.Event(input instanceof dom.window.HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
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

test('required profile fields have the same marker and required semantics while nullable fields stay optional', async () => {
  profile.user.accountType = 'general';
  await mountEditor();
  for (const name of ['firstName', 'lastName', 'phone', 'accountType']) {
    assert.equal(field(name).required, true, name);
    const marker = field(name).closest('label').querySelector('.required-marker');
    assert.equal(marker.textContent, '*', name);
    assert.equal(marker.getAttribute('aria-hidden'), 'true');
  }
  for (const name of ['dateOfBirth', 'bio', 'lifestyleName', 'lineId', 'instagram', 'budgetMin', 'budgetMax']) {
    assert.equal(field(name).required, false, name);
    assert.equal(field(name).closest('label').querySelector('.required-marker'), null, name);
  }
  await change('firstName', '');
  await submit();
  assert.equal(save.mock.callCount(), 0);
  assert.equal(field('firstName').getAttribute('aria-invalid'), 'true');
  await change('firstName', 'Corrected');
  assert.equal(field('firstName').getAttribute('aria-invalid'), null);
});

test('Google profile setup marks birthday and account type required and blocks incomplete submission', async () => {
  Object.assign(profile.user, { profileSetupPending: true, dateOfBirth: '', phone: '' });
  await mountEditor();
  for (const name of ['dateOfBirth', 'accountType']) {
    assert.equal(field(name).required, true, name);
    assert.ok(field(name).closest('label').querySelector('.required-marker'), name);
  }
  await submit();
  assert.equal(save.mock.callCount(), 0);
  assert.equal(field('dateOfBirth').getAttribute('aria-invalid'), 'true');
  assert.equal(field('accountType').getAttribute('aria-invalid'), 'true');
});

test('student university is required only while the student status is selected', async () => {
  profile.user.accountType = 'general';
  await mountEditor();
  await change('accountType', 'student');
  assert.equal(field('universityQuery').getAttribute('aria-required'), 'true');
  assert.ok(document.querySelector('.university-picker label .required-marker'));
  await submit();
  assert.equal(save.mock.callCount(), 0);
  assert.equal(field('universityQuery').getAttribute('aria-invalid'), 'true');
  await change('accountType', 'general');
  assert.equal(field('universityQuery'), null);
  await submit();
  assert.equal(save.mock.callCount(), 1);
  assert.equal(save.mock.calls[0].arguments[0].university, '');
});

test('an existing lifestyle cannot be cleared and shows its required feedback next to the field', async () => {
  profile.lifestyle = { lifestyleName: 'ตื่นเช้า' };
  await mountEditor();
  assert.equal(field('lifestyleName').required, true);
  assert.ok(field('lifestyleName').closest('label').querySelector('.required-marker'));
  await change('lifestyleName', '');
  await submit();
  assert.equal(save.mock.callCount(), 0);
  assert.equal(field('lifestyleName').getAttribute('aria-invalid'), 'true');
  assert.match(field('lifestyleName').closest('label').textContent, /กรุณาระบุไลฟ์สไตล์/);
  await change('lifestyleName', 'ตื่นเช้า');
  assert.equal(field('lifestyleName').getAttribute('aria-invalid'), null);
});

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

test('a profile without a birthday explains how to enable the age display', async () => {
  profile.user.dateOfBirth = '';
  await mountEditor();
  assert.equal(field('dateOfBirth').value, '');
  await act(async () => button('ยกเลิก').click());
  assert.match(document.querySelector('.profile-personal-data').textContent, /กรอกวันเกิดในโปรไฟล์เพื่อคำนวณอายุ/);
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

test('profile is file-only, preserves legacy images, and removing an image clears it', async () => {
  await mountEditor();
  assert.equal(field('profileImage'), null);
  assert.equal(document.querySelector('input[type="url"]'), null);
  assert.ok(document.querySelector('input[type="file"]'));
  await submit();
  assert.equal(save.mock.calls[0].arguments[0].profileImage, 'https://example.test/original.jpg');
  assert.equal(upload.mock.callCount(), 0);
  await act(async () => button('แก้ไขโปรไฟล์').click());
  await act(async () => document.querySelector('[aria-label="ลบรูปโปรไฟล์"]').click());
  assert.equal(document.querySelector('.image-picker img'), null);
  await submit();
  assert.equal(save.mock.calls[1].arguments[0].profileImage, '');
});

test('cancelling an image edit restores the saved image when reopening the form', async () => {
  await mountEditor();
  await chooseImage();
  await act(async () => button('ยกเลิก').click());
  assert.ok(dialog());
  await discard();
  await act(async () => button('แก้ไขโปรไฟล์').click());
  assert.equal(document.querySelector('.image-picker img').getAttribute('src'), profile.user.profileImage);
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

const leave = destination => act(async () => { await router.navigate(destination); });
const dialog = () => document.querySelector('[role="dialog"]');
const confirmSave = () => act(async () => button('บันทึกและไปต่อ').click());
const discard = () => act(async () => button('ยกเลิกการแก้ไข').click());

test('an untouched editor and reverted values leave without a warning', async () => {
  await mountEditor();
  await change('firstName', 'Temporary');
  await change('firstName', profile.user.firstName);
  await leave('/rooms');
  assert.equal(router.state.location.pathname, '/rooms');
  assert.equal(dialog(), null);
  assert.equal(save.mock.callCount(), 0);
});

test('dismissing the warning preserves edits; discard follows the latest chosen destination', async () => {
  await mountEditor();
  await change('bio', 'Unsaved biography');
  await leave('/rooms');
  assert.ok(dialog());
  assert.equal(router.state.location.pathname, '/profile');
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(dialog(), null);
  assert.equal(field('bio').value, 'Unsaved biography');
  await leave('/favorites?view=saved#top');
  await discard();
  assert.equal(router.state.location.pathname + router.state.location.search + router.state.location.hash, '/favorites?view=saved#top');
  assert.equal(save.mock.callCount(), 0);
  assert.equal(profile.user.bio, '');
});

test('save from the warning persists edits before continuing to the requested page', async () => {
  await mountEditor();
  await change('firstName', 'Saved before leaving');
  await leave('/rooms?sort=price#results');
  await confirmSave();
  assert.equal(save.mock.callCount(), 1);
  assert.equal(profile.user.firstName, 'Saved before leaving');
  assert.equal(router.state.location.pathname + router.state.location.search + router.state.location.hash, '/rooms?sort=price#results');
  assert.equal(dialog(), null);
});

test('validation failure cancels navigation, keeps input, and lets the user correct it', async () => {
  await mountEditor();
  await change('phone', '1');
  await leave('/rooms');
  await confirmSave();
  assert.equal(router.state.location.pathname, '/profile');
  assert.equal(dialog(), null);
  assert.equal(save.mock.callCount(), 0);
  assert.equal(field('phone').value, '1');
  assert.equal(field('phone').getAttribute('aria-invalid'), 'true');
  await change('phone', '0812345678');
  await leave('/rooms');
  await confirmSave();
  assert.equal(profile.user.phone, '0812345678');
  assert.equal(router.state.location.pathname, '/rooms');
});

test('a failed save from the warning retains selected images and retries without uploading twice', async () => {
  await mountEditor();
  await chooseImage();
  await change('bio', 'Keep this text');
  save.mock.mockImplementationOnce(async () => { throw new ApiError('Service unavailable', 503); });
  await leave('/rooms');
  await confirmSave();
  assert.equal(router.state.location.pathname, '/profile');
  assert.equal(dialog(), null);
  assert.equal(field('bio').value, 'Keep this text');
  assert.ok(document.querySelector('.form-feedback[role="alert"]'));
  assert.equal(upload.mock.callCount(), 1);
  await leave('/favorites');
  await confirmSave();
  assert.equal(router.state.location.pathname, '/favorites');
  assert.equal(upload.mock.callCount(), 1);
  assert.equal(save.mock.callCount(), 2);
});

test('image-only edits are guarded and discard does not upload the selected image', async () => {
  await mountEditor();
  await chooseImage();
  await leave('/rooms');
  assert.ok(dialog());
  await discard();
  assert.equal(router.state.location.pathname, '/rooms');
  assert.equal(upload.mock.callCount(), 0);
  assert.equal(save.mock.callCount(), 0);
  assert.equal(profile.user.profileImage, 'https://example.test/original.jpg');
});

test('browser history navigation continues to its original entry after saving', async () => {
  await mountEditor();
  await change('bio', 'Saved on Back');
  await leave(-1);
  assert.ok(dialog());
  await confirmSave();
  assert.equal(router.state.location.pathname, '/rooms');
  assert.equal(profile.user.bio, 'Saved on Back');
  await leave(1);
  assert.equal(router.state.location.pathname, '/profile');
  assert.ok(document.querySelector('.profile-summary'));
});

for (const saveFirst of [false, true]) {
  test(`logout waits for the ${saveFirst ? 'save' : 'discard'} decision before clearing the session`, async () => {
    await mountEditor();
    localStorage.setItem('roommatch:token', 'profile-test-session');
    await change('bio', 'Logout edit');
    await act(async () => { assert.equal(app.logout(), false); });
    assert.ok(dialog());
    assert.equal(localStorage.getItem('roommatch:token'), 'profile-test-session');
    if (saveFirst) await confirmSave();
    else await discard();
    assert.equal(router.state.location.pathname, '/login');
    assert.equal(localStorage.getItem('roommatch:token'), null);
    assert.equal(save.mock.callCount(), saveFirst ? 1 : 0);
    assert.equal(profile.user.bio, saveFirst ? 'Logout edit' : '');
  });
}

test('closing the warning during a pending save keeps the page and prevents duplicate requests', async () => {
  await mountEditor();
  await change('bio', 'Pending edit');
  let resolveSave;
  save.mock.mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }));
  await leave('/rooms');
  await confirmSave();
  assert.equal(button('ยกเลิกการแก้ไข').disabled, true);
  await submit();
  assert.equal(save.mock.callCount(), 1);
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(dialog(), null);
  const updated = { ...profile, user: { ...profile.user, bio: 'Pending edit' } };
  await act(async () => resolveSave(updated));
  assert.equal(router.state.location.pathname, '/profile');
  assert.equal(document.querySelector('.profile-editor'), null);
  await leave('/rooms');
  assert.equal(router.state.location.pathname, '/rooms');
});

test('refresh warns only for unsaved changes and explicit cancel resets the next editor baseline', async () => {
  await mountEditor();
  const warns = () => {
    const event = new dom.window.Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(warns(), false);
  await change('bio', 'Unsaved');
  assert.equal(warns(), true);
  await act(async () => button('ยกเลิก').click());
  assert.equal(warns(), true);
  await discard();
  assert.equal(warns(), false);
  await act(async () => button('แก้ไขโปรไฟล์').click());
  assert.equal(field('bio').value, '');
  assert.equal(warns(), false);
  await leave('/rooms');
  assert.equal(router.state.location.pathname, '/rooms');
});
