import './helpers/load-client.mjs';
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, mock, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement, StrictMode } from 'react';
import { startRoomMatchServer } from '../server/app.js';
import { createToken } from '../server/auth.js';
import { openDatabase } from './support/postgres.mjs';

const nativeFetch = globalThis.fetch;

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.FormData = dom.window.FormData;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};

const { createRoot } = await import('react-dom/client');
const { useLocation } = await import('react-router-dom');
const { TestRouter: MemoryRouter } = await import('./helpers/test-router.mjs');
const { AppProvider, useApp } = await import('../src/AppContext.tsx');
const { api, ApiError, InvalidAuthResponseError, SessionChangedError, subscribeUnauthorized, tokenStorage } = await import('../src/lib/api.ts');
const { default: App } = await import('../src/App.tsx');

const user = { userId: '1', firstName: 'Auth', lastName: 'Test', email: 'auth@example.test' };
const credentials = { email: user.email, password: 'test-password' };
const sessionMessage = 'การเข้าสู่ระบบสิ้นสุด กรุณาเข้าสู่ระบบอีกครั้ง';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const rejected = () => json({ error: 'Invalid or expired authentication token' }, 401);
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

let root;
let state;
let location;
let respond;
function StateProbe() { state = useApp(); return null; }
function LocationProbe() { location = useLocation(); return null; }

beforeEach(() => {
  localStorage.clear();
  state = null;
  location = null;
  respond = async path => {
    if (path === '/api/auth/oauth/providers') return json({ google: false });
    if (path === '/api/auth/me') return json({ user });
    if (path === '/api/auth/login' || path === '/api/auth/register') return json({ user, token: 'new-token' });
    if (path === '/api/profile') return json({ user, lifestyle: null, preference: null });
    if (new URL(path, 'http://localhost').pathname === '/api/rooms') return json({ rooms: [], total: 0, page: 1, pageSize: 12, totalPages: 0 });
    if (path === '/api/owner/requests') return json({ requests: [] });
    throw new Error(`Unexpected request: ${path}`);
  };
  mock.method(globalThis, 'fetch', (path, options) => respond(path, options));
  root = createRoot(document.getElementById('root'));
});

afterEach(async () => {
  await act(async () => root.unmount());
  mock.restoreAll();
});
after(() => dom.window.close());

async function mountProvider(token = 'old-token') {
  if (token) tokenStorage.set(token);
  await act(async () => root.render(createElement(StrictMode, null,
    createElement(AppProvider, null, createElement(StateProbe)))));
}

function changeTokenInAnotherTab(token, { clear = false } = {}) {
  const oldValue = tokenStorage.get();
  if (clear) localStorage.clear();
  else if (token === null) localStorage.removeItem('roommatch:token');
  else localStorage.setItem('roommatch:token', token);
  window.dispatchEvent(new window.StorageEvent('storage', {
    key: clear ? null : 'roommatch:token', oldValue, newValue: token,
    storageArea: localStorage,
  }));
}

test('another tab switching accounts hides the previous user until the new token is verified', async () => {
  await mountProvider();
  await act(async () => state.notify('Old account notification'));
  const pending = deferred();
  let authorization;
  respond = (_path, options) => {
    authorization = options.headers.get('Authorization');
    return pending.promise;
  };
  const setItem = mock.method(window.Storage.prototype, 'setItem');
  const removeItem = mock.method(window.Storage.prototype, 'removeItem');
  await act(async () => changeTokenInAnotherTab('other-tab-token'));
  assert.equal(state.user, null);
  assert.equal(state.authLoading, true);
  assert.equal(state.authError, '');
  assert.equal(state.toast, '');
  assert.equal(authorization, 'Bearer other-tab-token');
  assert.equal(setItem.mock.callCount(), 1, 'only the simulated other tab writes storage');
  assert.equal(removeItem.mock.callCount(), 0);
  const nextUser = { ...user, userId: '2', email: 'other@example.test' };
  await act(async () => pending.resolve(json({ user: nextUser })));
  assert.equal(state.user.userId, nextUser.userId);
  assert.equal(state.authLoading, false);
  assert.equal(tokenStorage.get(), 'other-tab-token');
});

for (const clear of [false, true]) {
  test(`another tab ${clear ? 'clearing storage' : 'logging out'} clears the local session`, async () => {
    await mountProvider();
    respond = async () => json({ error: 'Unavailable' }, 503);
    await act(async () => state.retryAuth());
    assert.ok(state.authError);
    await act(async () => state.notify('Old notification'));
    const removeItem = mock.method(window.Storage.prototype, 'removeItem');
    await act(async () => changeTokenInAnotherTab(null, { clear }));
    assert.equal(state.user, null);
    assert.equal(state.authLoading, false);
    assert.equal(state.authError, '');
    assert.equal(state.toast, '');
    assert.equal(tokenStorage.get(), null);
    assert.equal(removeItem.mock.callCount(), clear ? 0 : 1);
  });
}

test('authenticated 401 clears session, loading and stale errors and notifies once', async () => {
  await mountProvider();
  assert.equal(state.user.userId, user.userId);
  const first = deferred();
  const second = deferred();
  let calls = 0;
  let notifications = 0;
  const unsubscribe = subscribeUnauthorized(() => { notifications++; });
  respond = () => (++calls === 1 ? first.promise : second.promise);
  const requests = [api.profile(), api.mineRequests()];
  const errors = requests.map(request => assert.rejects(request, error =>
    (error instanceof ApiError && error.status === 401) || error instanceof SessionChangedError));
  try {
    await act(async () => {
      first.resolve(rejected());
      second.resolve(rejected());
      await Promise.all(errors);
    });
    assert.equal(tokenStorage.get(), null);
    assert.equal(state.user, null);
    assert.equal(state.authError, '');
    assert.equal(state.authLoading, false);
    assert.equal(state.toast, sessionMessage);
    assert.equal(notifications, 1);
  } finally { unsubscribe(); }
});

test('expired token during startup returns to a signed-out state', async () => {
  respond = async () => rejected();
  await mountProvider();
  assert.equal(tokenStorage.get(), null);
  assert.equal(state.user, null);
  assert.equal(state.authLoading, false);
  assert.equal(state.authError, '');
  assert.equal(state.toast, sessionMessage);
});

test('a real expired signed token ends the session and a fresh login works against the API', async t => {
  const db = await openDatabase({ filename: ':memory:', seed: false });
  t.after(() => db.close());
  const application = await startRoomMatchServer({ host: '127.0.0.1', port: 0, db });
  const baseUrl = `http://127.0.0.1:${application.server.address().port}`;
  try {
    const registration = await nativeFetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...credentials, firstName: 'Auth', lastName: 'Test', phone: '0890000000', dateOfBirth: '2000-02-29' }),
    });
    assert.equal(registration.status, 201);
    const account = await registration.json();
    respond = (path, options) => nativeFetch(`${baseUrl}${path}`, options);
    await mountProvider(account.token);
    await act(async () => { await state.retryAuth(); });
    assert.equal(state.user.email, credentials.email);

    tokenStorage.set(createToken(account.user.userId, Date.now() - 8 * 24 * 60 * 60 * 1000));
    await act(async () => { await assert.rejects(api.profile(), error => error.status === 401); });
    assert.equal(tokenStorage.get(), null);
    assert.equal(state.user, null);
    assert.equal(state.toast, sessionMessage);

    await act(async () => { await state.login(credentials.email, credentials.password); });
    assert.equal(state.user.email, credentials.email);
    assert.equal(state.authError, '');
    assert.equal((await api.profile()).user.email, credentials.email);
  } finally {
    await new Promise(resolve => application.server.close(resolve));
  }
});

for (const status of [403, 500]) {
  test(`HTTP ${status} preserves the active session`, async () => {
    await mountProvider();
    respond = async () => json({ error: 'Request failed' }, status);
    await act(async () => {
      await assert.rejects(api.profile(), error => error.status === status);
    });
    assert.equal(tokenStorage.get(), 'old-token');
    assert.equal(state.user.userId, user.userId);
    assert.equal(state.toast, '');
  });
}

test('network failure preserves the session and a later retry restores access', async () => {
  await mountProvider();
  respond = async () => { throw new TypeError('Network unavailable'); };
  await act(async () => { await state.retryAuth(); });
  assert.equal(tokenStorage.get(), 'old-token');
  assert.equal(state.user.userId, user.userId);
  assert.ok(state.authError);
  assert.equal(state.authLoading, false);
  respond = async () => json({ user });
  await act(async () => { await state.retryAuth(); });
  assert.equal(state.authError, '');
  assert.equal(state.user.userId, user.userId);
});

for (const method of ['login', 'register']) {
  test(`${method} 401 stays a form error and does not send an existing bearer token`, async () => {
    await mountProvider();
    let authorization;
    respond = async (_path, options) => {
      authorization = options.headers.get('Authorization');
      return json({ error: 'Invalid credentials' }, 401);
    };
    await act(async () => {
      const request = method === 'login' ? state.login(credentials.email, credentials.password) : state.register(credentials);
      await assert.rejects(request, error => error.status === 401);
    });
    assert.equal(authorization, null);
    assert.equal(tokenStorage.get(), 'old-token');
    assert.equal(state.user.userId, user.userId);
    assert.equal(state.toast, '');
  });

  test(`${method} clears an earlier account-check error`, async () => {
    respond = async () => json({ error: 'Server unavailable' }, 503);
    await mountProvider();
    assert.ok(state.authError);
    respond = async () => json({ user, token: 'new-token' });
    await act(async () => {
      if (method === 'login') await state.login(credentials.email, credentials.password);
      else await state.register(credentials);
    });
    assert.equal(tokenStorage.get(), 'new-token');
    assert.equal(state.user.userId, user.userId);
    assert.equal(state.authError, '');
    assert.equal(state.authLoading, false);
  });
}

for (const replacementToken of ['new-token', 'old-token']) {
  test(`late account-check 401 cannot clear a newer login using ${replacementToken}`, async () => {
    await mountProvider();
    const pending = deferred();
    respond = path => path === '/api/auth/me' ? pending.promise : Promise.resolve(json({ user, token: replacementToken }));
    let retry;
    await act(async () => { retry = state.retryAuth(); });
    assert.equal(state.authLoading, true);
    await act(async () => { await state.login(credentials.email, credentials.password); });
    await act(async () => { pending.resolve(rejected()); await retry; });
    assert.equal(tokenStorage.get(), replacementToken);
    assert.equal(state.user.userId, user.userId);
    assert.equal(state.authError, '');
    assert.equal(state.authLoading, false);
    assert.equal(state.toast, '');
  });
}

test('late account-check success cannot restore a logged-out user', async () => {
  await mountProvider();
  const pending = deferred();
  respond = () => pending.promise;
  let retry;
  await act(async () => { retry = state.retryAuth(); });
  await act(async () => { state.logout(); });
  await act(async () => { pending.resolve(json({ user })); await retry; });
  assert.equal(tokenStorage.get(), null);
  assert.equal(state.user, null);
  assert.equal(state.authLoading, false);
  assert.equal(state.authError, '');
});

for (const method of ['login', 'register']) {
  test(`late network failure cannot restore an error after a successful ${method}`, async () => {
    await mountProvider();
    const pending = deferred();
    respond = path => path === '/api/auth/me' ? pending.promise : Promise.resolve(json({ user, token: 'new-token' }));
    let retry;
    await act(async () => { retry = state.retryAuth(); });
    await act(async () => {
      if (method === 'login') await state.login(credentials.email, credentials.password);
      else await state.register(credentials);
    });
    await act(async () => { pending.reject(new TypeError('Network unavailable')); await retry; });
    assert.equal(tokenStorage.get(), 'new-token');
    assert.equal(state.user.userId, user.userId);
    assert.equal(state.authError, '');
    assert.equal(state.authLoading, false);
  });
}

test('logout clears an earlier account-check error', async () => {
  respond = async () => json({ error: 'Server unavailable' }, 503);
  await mountProvider();
  assert.ok(state.authError);
  await act(async () => { state.logout(); });
  assert.equal(tokenStorage.get(), null);
  assert.equal(state.user, null);
  assert.equal(state.authError, '');
  assert.equal(state.authLoading, false);
});

test('late account-check success cannot overwrite a newly signed-in account', async () => {
  await mountProvider();
  const pending = deferred();
  const nextUser = { ...user, userId: '2', email: 'next@example.test' };
  respond = path => path === '/api/auth/me'
    ? pending.promise
    : Promise.resolve(json({ user: nextUser, token: 'new-token' }));
  let retry;
  await act(async () => { retry = state.retryAuth(); });
  await act(async () => { await state.login(nextUser.email, credentials.password); });
  await act(async () => { pending.resolve(json({ user })); await retry; });
  assert.equal(tokenStorage.get(), 'new-token');
  assert.equal(state.user.userId, nextUser.userId);
  assert.equal(state.authError, '');
  assert.equal(state.authLoading, false);
});

test('an unauthenticated 401 does not emit an expired-session notification', async () => {
  await mountProvider(null);
  respond = async () => rejected();
  await act(async () => { await assert.rejects(api.profile(), error => error.status === 401); });
  assert.equal(state.user, null);
  assert.equal(state.toast, '');
});

test('expiration redirects to login, wrong password shows an error, and login restores the complete route', async () => {
  tokenStorage.set('old-token');
  const originalRoute = '/profile?tab=account#details';
  await act(async () => root.render(createElement(StrictMode, null,
    createElement(MemoryRouter, { initialEntries: [originalRoute] }, createElement(App), createElement(LocationProbe)))));
  assert.equal(location.pathname, '/profile');
  respond = async path => path === '/api/auth/oauth/providers' ? json({ google: false }) : rejected();
  await act(async () => { await assert.rejects(api.profile(), error => error.status === 401); });
  assert.equal(location.pathname, '/login');
  assert.equal(location.state.from, originalRoute);
  assert.equal(document.querySelector('[role="status"]').textContent, sessionMessage);
  await act(async () => document.querySelector('.auth-switch a').click());
  assert.equal(location.pathname, '/register');
  assert.equal(location.state.from, originalRoute);
  await act(async () => document.querySelector('.auth-switch a').click());
  assert.equal(location.pathname, '/login');
  assert.equal(location.state.from, originalRoute);
  document.querySelector('input[name="email"]').value = credentials.email;
  document.querySelector('input[name="password"]').value = 'wrong-password';
  respond = async () => json({ error: 'Invalid email or password' }, 401);
  await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(location.pathname, '/login');
  assert.equal(document.querySelector('[role="alert"]').textContent, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  assert.equal(tokenStorage.get(), null);
  document.querySelector('input[name="password"]').value = credentials.password;
  respond = async path => path === '/api/auth/login'
    ? json({ user, token: 'new-token' })
    : json({ user, lifestyle: null, preference: null });
  await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(location.pathname + location.search + location.hash, originalRoute);
  assert.equal(tokenStorage.get(), 'new-token');
  assert.ok(document.querySelector('.profile-summary'));
});

test('a signed-out tab verifies an account signed in elsewhere', async () => {
  await mountProvider(null);
  await act(async () => changeTokenInAnotherTab('external-token'));
  assert.equal(state.user.userId, user.userId);
  assert.equal(state.authLoading, false);
  assert.equal(tokenStorage.get(), 'external-token');
});

for (const failure of [401, 503, 'network']) {
  test(`external account verification handles ${failure} without restoring the previous user`, async () => {
    await mountProvider();
    respond = async () => {
      if (failure === 'network') throw new TypeError('Network unavailable');
      return json({ error: 'Verification failed' }, failure);
    };
    await act(async () => changeTokenInAnotherTab('external-token'));
    assert.equal(state.user, null);
    assert.equal(state.authLoading, false);
    if (failure === 401) {
      assert.equal(tokenStorage.get(), null);
      assert.equal(state.authError, '');
    } else {
      assert.equal(tokenStorage.get(), 'external-token');
      assert.ok(state.authError);
      const nextUser = { ...user, userId: '2' };
      respond = async () => json({ user: nextUser });
      await act(async () => state.retryAuth());
      assert.equal(state.user.userId, nextUser.userId);
      assert.equal(state.authError, '');
    }
  });
}

test('unrelated storage events are ignored and the storage listener is removed on unmount', async () => {
  await mountProvider();
  let calls = 0;
  respond = async () => { calls++; return json({ user }); };
  await act(async () => {
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'theme', newValue: 'dark', storageArea: localStorage }));
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'roommatch:token', newValue: 'different', storageArea: window.sessionStorage }));
  });
  assert.equal(calls, 0);
  assert.equal(state.user.userId, user.userId);
  await act(async () => root.unmount());
  changeTokenInAnotherTab('after-unmount');
  assert.equal(calls, 0);
  root = createRoot(document.getElementById('root'));
});

for (const outcome of ['success', 'unauthorized', 'network']) {
  test(`a previous account's late ${outcome} response is discarded`, async () => {
    await mountProvider();
    const pending = deferred();
    const nextUser = { ...user, userId: '2' };
    respond = path => path === '/api/auth/me' ? Promise.resolve(json({ user: nextUser })) : pending.promise;
    const ignored = assert.rejects(api.profile(), SessionChangedError);
    await act(async () => changeTokenInAnotherTab('external-token'));
    await act(async () => {
      if (outcome === 'network') pending.reject(new TypeError('Old network failure'));
      else pending.resolve(outcome === 'success' ? json({ user }) : rejected());
      await ignored;
    });
    assert.equal(state.user.userId, nextUser.userId);
    assert.equal(tokenStorage.get(), 'external-token');
    assert.equal(state.authError, '');
    assert.equal(state.toast, '');
  });
}

test('a response still reading its body is discarded after an external logout', async () => {
  await mountProvider();
  const body = deferred();
  let reading = false;
  respond = async () => ({ ok: true, status: 200, json: () => { reading = true; return body.promise; } });
  const ignored = assert.rejects(api.profile(), SessionChangedError);
  await act(async () => {});
  assert.equal(reading, true);
  await act(async () => changeTokenInAnotherTab(null));
  await act(async () => { body.resolve({ user }); await ignored; });
  assert.equal(state.user, null);
});

test('external logout and login with an identical token invalidate earlier requests', async () => {
  await mountProvider();
  const pending = deferred();
  respond = path => path === '/api/auth/me' ? Promise.resolve(json({ user })) : pending.promise;
  const ignored = assert.rejects(api.profile(), SessionChangedError);
  await act(async () => {
    changeTokenInAnotherTab(null);
    changeTokenInAnotherTab('old-token');
  });
  await act(async () => { pending.resolve(rejected()); await ignored; });
  assert.equal(tokenStorage.get(), 'old-token');
  assert.equal(state.user.userId, user.userId);
  assert.equal(state.toast, '');
});

test('queued storage events verify the latest stored token instead of replaying an old logout', async () => {
  await mountProvider();
  const nextUser = { ...user, userId: '2' };
  let authorization;
  respond = async (_path, options) => {
    authorization = options.headers.get('Authorization');
    return json({ user: nextUser });
  };
  await act(async () => {
    localStorage.setItem('roommatch:token', 'latest-token');
    window.dispatchEvent(new window.StorageEvent('storage', {
      key: 'roommatch:token', oldValue: 'old-token', newValue: null, storageArea: localStorage,
    }));
  });
  assert.equal(authorization, 'Bearer latest-token');
  assert.equal(tokenStorage.get(), 'latest-token');
  assert.equal(state.user.userId, nextUser.userId);
});

test('a slower external account check cannot overwrite a later account switch', async () => {
  await mountProvider();
  const pending = deferred();
  const latestUser = { ...user, userId: '3' };
  respond = (_path, options) => options.headers.get('Authorization') === 'Bearer middle-token'
    ? pending.promise : Promise.resolve(json({ user: latestUser }));
  await act(async () => changeTokenInAnotherTab('middle-token'));
  await act(async () => changeTokenInAnotherTab('latest-token'));
  await act(async () => pending.resolve(rejected()));
  assert.equal(state.user.userId, latestUser.userId);
  assert.equal(tokenStorage.get(), 'latest-token');
  assert.equal(state.authLoading, false);
  assert.equal(state.authError, '');
});

test('an old screen cannot send a mutation using a changed token before the storage event arrives', async () => {
  await mountProvider();
  const nextUser = { ...user, userId: '2' };
  const paths = [];
  respond = async (path, options) => {
    paths.push(path);
    assert.equal(options.headers.get('Authorization'), 'Bearer external-token');
    return json({ user: nextUser });
  };
  localStorage.setItem('roommatch:token', 'external-token');
  await act(async () => { await assert.rejects(api.deleteRoom('1'), SessionChangedError); });
  assert.deepEqual(paths, ['/api/auth/me']);
  assert.equal(state.user.userId, nextUser.userId);
});

for (const method of ['login', 'register']) {
  test(`a pending ${method} cannot overwrite a session adopted from another tab`, async () => {
    await mountProvider(null);
    const pending = deferred();
    const nextUser = { ...user, userId: '2' };
    respond = path => path === '/api/auth/me' ? Promise.resolve(json({ user: nextUser })) : pending.promise;
    let ignored;
    await act(async () => {
      ignored = assert.rejects(method === 'login'
        ? state.login(credentials.email, credentials.password) : state.register(credentials), SessionChangedError);
    });
    await act(async () => changeTokenInAnotherTab('external-token'));
    await act(async () => { pending.resolve(json({ user, token: 'late-token' })); await ignored; });
    assert.equal(tokenStorage.get(), 'external-token');
    assert.equal(state.user.userId, nextUser.userId);
  });
}

test('protected profile content is cleared during a switch and logout preserves the destination', async () => {
  tokenStorage.set('old-token');
  const route = '/profile?tab=account#details';
  await act(async () => root.render(createElement(StrictMode, null,
    createElement(MemoryRouter, { initialEntries: [route] }, createElement(App), createElement(LocationProbe)))));
  assert.ok(document.querySelector('.profile-summary'));
  const pending = deferred();
  const nextUser = { ...user, userId: '2', firstName: 'Next' };
  respond = path => path === '/api/auth/me' ? pending.promise
    : Promise.resolve(json({ user: nextUser, lifestyle: null, preference: null }));
  await act(async () => changeTokenInAnotherTab('external-token'));
  assert.equal(document.querySelector('.profile-summary'), null);
  assert.ok(document.querySelector('.route-loading'));
  await act(async () => pending.resolve(json({ user: nextUser })));
  assert.match(document.querySelector('.profile-identity h2').textContent, /Next/);
  await act(async () => changeTokenInAnotherTab(null));
  assert.equal(location.pathname, '/login');
  assert.equal(location.state.from, route);
  assert.equal(document.querySelector('.profile-summary'), null);
});

test('a cancelled login does not navigate or display an obsolete form error', async () => {
  await act(async () => root.render(createElement(StrictMode, null,
    createElement(MemoryRouter, { initialEntries: ['/login'] }, createElement(App), createElement(LocationProbe)))));
  document.querySelector('[name="email"]').value = credentials.email;
  document.querySelector('[name="password"]').value = credentials.password;
  const pending = deferred();
  respond = () => pending.promise;
  await act(async () => document.querySelector('form').requestSubmit());
  await act(async () => changeTokenInAnotherTab(null, { clear: true }));
  await act(async () => pending.resolve(json({ user, token: 'late-token' })));
  assert.equal(location.pathname, '/login');
  assert.equal(tokenStorage.get(), null);
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.equal(document.querySelector('button.w-full').disabled, false);
});

for (const action of ['status', 'delete']) {
test(`an old listing action cannot show a notification in the next account (${action})`, async () => {
  tokenStorage.set('old-token');
  const pending = deferred();
  const room = { roomId: '1', title: 'Old listing', status: 'available', price: 5000, capacity: 2 };
  respond = async path => path === '/api/auth/me' ? json({ user }) : json({ rooms: [room], total: 1, page: 1, pageSize: 10, totalPages: 1 });
  await act(async () => root.render(createElement(StrictMode, null,
    createElement(MemoryRouter, { initialEntries: ['/my-listings'] }, createElement(App)))));
  respond = () => pending.promise;
  if (action === 'status') {
    await act(async () => document.querySelector('.status-toggle').click());
  } else {
    await act(async () => document.querySelector('.delete-action').click());
    const confirm = [...document.querySelectorAll('button')].find(button => button.textContent === 'ลบประกาศ');
    assert.ok(confirm);
    await act(async () => confirm.click());
  }
  const nextUser = { ...user, userId: '2' };
  respond = async path => path === '/api/auth/me' ? json({ user: nextUser }) : json({ rooms: [], total: 0, page: 1, pageSize: 10, totalPages: 0 });
  await act(async () => changeTokenInAnotherTab('external-token'));
  await act(async () => pending.resolve(action === 'status' ? json({ room }) : new Response(null, { status: 204 })));
  assert.equal(Boolean(document.querySelector('.my-listing')), false);
  assert.equal(document.querySelector('[role="status"]')?.textContent ?? '', '');
});
}

test('external account changes keep the displayed user and real API identity in sync', async t => {
  const db = await openDatabase({ filename: ':memory:', seed: false });
  t.after(() => db.close());
  const application = await startRoomMatchServer({ host: '127.0.0.1', port: 0, db });
  const baseUrl = `http://127.0.0.1:${application.server.address().port}`;
  try {
    const accounts = [];
    for (const email of ['first-tab@example.test', 'second-tab@example.test']) {
      const registration = await nativeFetch(`${baseUrl}/api/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...credentials, email, firstName: 'Tab', lastName: 'Test', phone: '0890000000', dateOfBirth: '2000-02-29' }),
      });
      assert.equal(registration.status, 201);
      accounts.push(await registration.json());
    }
    respond = (path, options) => nativeFetch(`${baseUrl}${path}`, options);
    await mountProvider(accounts[0].token);
    await act(async () => {
      changeTokenInAnotherTab(accounts[1].token);
      await state.retryAuth();
    });
    assert.equal(state.user.userId, String(accounts[1].user.userId));
    assert.equal(state.user.userId, (await api.me()).userId);
    await act(async () => changeTokenInAnotherTab(null));
    assert.equal(state.user, null);
    await act(async () => { await assert.rejects(api.me(), error => error.status === 401); });
    assert.equal(state.user, null);
  } finally { await new Promise(resolve => application.server.close(resolve)); }
});

for (const latestOutcome of ['success', 'failure']) {
  test(`only the latest login attempt may sign in when the older response arrives first (${latestOutcome})`, async () => {
    await mountProvider(null);
    const older = deferred();
    const latest = deferred();
    const nextUser = { ...user, userId: '2', email: 'latest@example.test' };
    let calls = 0;
    respond = () => (++calls === 1 ? older.promise : latest.promise);
    let olderResult;
    let latestResult;
    await act(async () => {
      olderResult = state.login(credentials.email, credentials.password).then(() => null, error => error);
      latestResult = state.login(nextUser.email, credentials.password).then(() => null, error => error);
    });
    let tokenBeforeLatest;
    let userBeforeLatest;
    await act(async () => {
      older.resolve(json({ user, token: 'older-token' }));
      await olderResult;
    });
    tokenBeforeLatest = tokenStorage.get();
    userBeforeLatest = state.user;
    await act(async () => {
      latest.resolve(latestOutcome === 'success'
        ? json({ user: nextUser, token: 'latest-token' }) : json({ error: 'อีเมลหรือรหัสผ่านล่าสุดไม่ถูกต้อง' }, 401));
      await latestResult;
    });
    assert.ok(await olderResult instanceof SessionChangedError);
    assert.equal(tokenBeforeLatest, null);
    assert.equal(userBeforeLatest, null);
    if (latestOutcome === 'success') {
      assert.equal(await latestResult, null);
      assert.equal(state.user.userId, nextUser.userId);
      assert.equal(tokenStorage.get(), 'latest-token');
    } else {
      const failure = await latestResult;
      assert.ok(failure instanceof ApiError);
      assert.equal(failure.status, 401);
      assert.equal(failure.message, 'อีเมลหรือรหัสผ่านล่าสุดไม่ถูกต้อง');
      assert.equal(state.user, null);
      assert.equal(tokenStorage.get(), null);
    }
  });
}

test('an older successful login cannot revive after the latest login has failed', async () => {
  await mountProvider(null);
  const older = deferred();
  let calls = 0;
  respond = () => ++calls === 1 ? older.promise : Promise.resolve(json({ error: 'Latest failed' }, 401));
  let olderResult;
  await act(async () => {
    olderResult = state.login(credentials.email, credentials.password).then(() => null, error => error);
    await assert.rejects(state.login('latest@example.test', credentials.password), error => error.status === 401);
  });
  await act(async () => { older.resolve(json({ user, token: 'older-token' })); await olderResult; });
  assert.ok(await olderResult instanceof SessionChangedError);
  assert.equal(state.user, null);
  assert.equal(tokenStorage.get(), null);
});

for (const [firstMethod, latestMethod] of [['login', 'register'], ['register', 'login'], ['register', 'register']]) {
  test(`the latest ${latestMethod} supersedes a pending ${firstMethod}`, async () => {
    await mountProvider(null);
    const older = deferred();
    const latest = deferred();
    let calls = 0;
    respond = () => ++calls === 1 ? older.promise : latest.promise;
    const invoke = method => method === 'login'
      ? state.login(credentials.email, credentials.password) : state.register(credentials);
    let olderResult;
    let latestResult;
    await act(async () => {
      olderResult = invoke(firstMethod).then(() => null, error => error);
      latestResult = invoke(latestMethod).then(() => null, error => error);
    });
    // Identical token strings must not make an older attempt eligible again.
    await act(async () => { older.resolve(json({ user, token: 'same-token' })); await olderResult; });
    const storedBeforeLatest = tokenStorage.get();
    await act(async () => { latest.resolve(json({ user, token: 'same-token' })); await latestResult; });
    assert.ok(await olderResult instanceof SessionChangedError);
    assert.equal(storedBeforeLatest, null);
    assert.equal(await latestResult, null);
    assert.equal(tokenStorage.get(), 'same-token');
    assert.equal(state.user.userId, user.userId);
  });
}

for (const outcome of ['success', 'unauthorized', 'network']) {
  test(`an older login's ${outcome} cannot affect the latest successful login`, async () => {
    await mountProvider(null);
    const older = deferred();
    const latestUser = { ...user, userId: '2' };
    let calls = 0;
    respond = () => ++calls === 1 ? older.promise : Promise.resolve(json({ user: latestUser, token: 'latest-token' }));
    let olderResult;
    await act(async () => {
      olderResult = state.login(credentials.email, credentials.password).then(() => null, error => error);
      await state.login('latest@example.test', credentials.password);
    });
    await act(async () => {
      if (outcome === 'network') older.reject(new TypeError('Old network failure'));
      else older.resolve(outcome === 'success' ? json({ user, token: 'older-token' }) : rejected());
      await olderResult;
    });
    assert.ok(await olderResult instanceof SessionChangedError);
    assert.equal(tokenStorage.get(), 'latest-token');
    assert.equal(state.user.userId, latestUser.userId);
    assert.equal(state.authError, '');
    assert.equal(state.toast, '');
  });
}

for (const method of ['login', 'register']) {
  for (const outcome of ['success', 'failure']) {
    test(`logout invalidates a pending ${method} ${outcome} at the session commit boundary`, async () => {
      await mountProvider(null);
      const pending = deferred();
      // Model an API result already past its transport-level session checks.
      mock.method(api, method, () => pending.promise);
      let ignored;
      await act(async () => {
        ignored = assert.rejects(method === 'login'
          ? state.login(credentials.email, credentials.password) : state.register(credentials), SessionChangedError);
        state.logout();
      });
      await act(async () => {
        if (outcome === 'success') pending.resolve({ user, token: 'late-token' });
        else pending.reject(new ApiError('Old failure', 401));
        await ignored;
      });
      assert.equal(state.user, null);
      assert.equal(tokenStorage.get(), null);
      assert.equal(state.authLoading, false);
      assert.equal(state.authError, '');
    });
  }
}

test('a successful account refresh does not supersede the latest pending login', async () => {
  await mountProvider();
  const pending = deferred();
  const nextUser = { ...user, userId: '2' };
  respond = path => path === '/api/auth/login' ? pending.promise : Promise.resolve(json({ user }));
  let login;
  await act(async () => { login = state.login('next@example.test', credentials.password); });
  await act(async () => state.retryAuth());
  await act(async () => { pending.resolve(json({ user: nextUser, token: 'latest-token' })); await login; });
  assert.equal(state.user.userId, nextUser.userId);
  assert.equal(tokenStorage.get(), 'latest-token');
  assert.equal(state.authLoading, false);
});

test('provider unmount invalidates a login that has not committed its session', async () => {
  await mountProvider(null);
  const pending = deferred();
  mock.method(api, 'login', () => pending.promise);
  let ignored;
  await act(async () => { ignored = assert.rejects(state.login(credentials.email, credentials.password), SessionChangedError); });
  await act(async () => root.unmount());
  pending.resolve({ user, token: 'late-token' });
  await ignored;
  assert.equal(tokenStorage.get(), null);
  root = createRoot(document.getElementById('root'));
});

test('an obsolete form submission cannot end loading while the latest login is pending', async () => {
  await act(async () => root.render(createElement(StrictMode, null,
    createElement(MemoryRouter, { initialEntries: ['/login'] }, createElement(App), createElement(LocationProbe)))));
  const older = deferred();
  const latest = deferred();
  let calls = 0;
  respond = () => ++calls === 1 ? older.promise : latest.promise;
  document.querySelector('[name="email"]').value = credentials.email;
  document.querySelector('[name="password"]').value = credentials.password;
  const form = document.querySelector('form');
  await act(async () => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  document.querySelector('[name="email"]').value = 'latest@example.test';
  await act(async () => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  await act(async () => older.resolve(json({ error: 'Old failure' }, 401)));
  const stillLoading = document.querySelector('button.w-full').disabled;
  const obsoleteError = document.querySelector('[role="alert"]')?.textContent ?? '';
  await act(async () => latest.resolve(json({ error: 'เข้าสู่ระบบล่าสุดไม่สำเร็จ' }, 401)));
  assert.equal(stillLoading, true);
  assert.equal(obsoleteError, '');
  assert.equal(document.querySelector('button.w-full').disabled, false);
  assert.equal(document.querySelector('[role="alert"]').textContent, 'เข้าสู่ระบบล่าสุดไม่สำเร็จ');
  assert.equal(location.pathname, '/login');
  assert.equal(tokenStorage.get(), null);
});

for (const method of ['login', 'register']) {
  test(`${method} rejects an incomplete HTTP 200 response before storing a session`, async () => {
    await mountProvider(null);
    respond = async () => json({});
    let failure;
    await act(async () => {
      try {
        if (method === 'login') await state.login(credentials.email, credentials.password);
        else await state.register(credentials);
      } catch (error) { failure = error; }
    });
    assert.ok(failure instanceof InvalidAuthResponseError, 'incomplete success must fail instead of establishing a session');
    assert.equal(tokenStorage.get(), null);
    assert.equal(state.user, null);
    assert.equal(state.authLoading, false);
    assert.equal(state.toast, '');
  });
}

const invalidAuthMessage = 'The server sent incomplete or incorrect account information. Please try again.';
const invalidSessionResponses = [
  ['null response', null],
  ['array response', []],
  ['primitive response', 'ok'],
  ['missing token', { user }],
  ['numeric token', { token: 123, user }],
  ['empty token', { token: '', user }],
  ['whitespace token', { token: ' \t', user }],
  ['token with spaces', { token: 'bad token', user }],
  ['token with a control character', { token: 'bad\0token', user }],
  ['missing user', { token: 'candidate-token' }],
  ['null user', { token: 'candidate-token', user: null }],
  ['array user', { token: 'candidate-token', user: [] }],
  ...[
    ['missing ID', { userId: undefined }],
    ['zero ID', { userId: 0 }],
    ['negative ID', { userId: -1 }],
    ['fractional ID', { userId: 1.5 }],
    ['unsafe ID', { userId: Number.MAX_SAFE_INTEGER + 1 }],
    ['non-numeric ID', { userId: 'not-an-id' }],
    ['object ID', { userId: { id: 1 } }],
    ['missing first name', { firstName: undefined }],
    ['blank first name', { firstName: '  ' }],
    ['wrong last-name type', { lastName: 123 }],
    ['missing email', { email: undefined }],
    ['malformed email', { email: 'invalid-email' }],
    ['wrong email type', { email: { address: user.email } }],
    ['inactive user', { isActive: false }],
    ['malformed active flag', { isActive: 'false' }],
    ['null active flag', { isActive: null }],
    ['malformed optional profile field', { phone: { number: '0890000000' } }],
  ].map(([label, changes]) => [label, { token: 'candidate-token', user: { ...user, ...changes } }]),
];

for (const method of ['login', 'register']) {
  test(`${method} validates response fields before permissive normalization`, async () => {
    await mountProvider(null);
    for (const [label, payload] of invalidSessionResponses) {
      respond = async () => json(payload);
      await act(async () => {
        await assert.rejects(method === 'login'
          ? state.login(credentials.email, credentials.password) : state.register(credentials),
        error => error instanceof InvalidAuthResponseError && error.message === invalidAuthMessage, label);
      });
      assert.equal(state.user, null, label);
      assert.equal(tokenStorage.get(), null, label);
      assert.equal(state.toast, '', label);
    }
  });

  test(`${method} handles non-JSON and empty successful responses as invalid account data`, async () => {
    await mountProvider(null);
    for (const makeResponse of [
      () => new Response('<html>Unexpected proxy page</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      () => new Response('{broken', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      () => new Response('', { status: 200 }),
      () => new Response(null, { status: 204 }),
    ]) {
      respond = async () => makeResponse();
      await act(async () => {
        await assert.rejects(method === 'login'
          ? state.login(credentials.email, credentials.password) : state.register(credentials), InvalidAuthResponseError);
      });
      assert.equal(state.user, null);
      assert.equal(tokenStorage.get(), null);
    }
  });

  test(`${method} keeps an existing session unchanged when a success payload is invalid`, async () => {
    await mountProvider();
    const originalUser = state.user;
    respond = async () => json({ token: 'invalid-session-token', user: {} });
    await act(async () => {
      await assert.rejects(method === 'login'
        ? state.login(credentials.email, credentials.password) : state.register(credentials), InvalidAuthResponseError);
    });
    assert.equal(state.user, originalUser);
    assert.equal(tokenStorage.get(), 'old-token');
    assert.equal(state.authError, '');
    assert.equal(state.authLoading, false);
  });

  test(`${method} stays on the form after an invalid success and can retry successfully`, async () => {
    const route = method === 'login' ? '/login' : '/register';
    await act(async () => root.render(createElement(StrictMode, null,
      createElement(MemoryRouter, { initialEntries: [route] }, createElement(App), createElement(LocationProbe)))));
    if (method === 'register') {
      document.querySelector('[name="firstName"]').value = user.firstName;
      document.querySelector('[name="lastName"]').value = user.lastName;
      document.querySelector('[name="phone"]').value = '0890000000';
      document.querySelector('[name="dateOfBirth"]').value = '29/02/2000';
    }
    document.querySelector('[name="email"]').value = credentials.email;
    document.querySelector('[name="password"]').value = credentials.password;
    respond = async () => json({});
    await act(async () => document.querySelector('form').requestSubmit());
    assert.equal(location.pathname, route);
    assert.equal(tokenStorage.get(), null);
    assert.equal(document.querySelector('[role="alert"]').textContent, invalidAuthMessage);
    assert.equal(document.querySelector('button.w-full').disabled, false);
    assert.equal(Boolean(document.querySelector('.app-shell')), false);
    assert.equal(Boolean(document.querySelector('[role="status"]')), false);
    assert.equal(document.querySelector('[name="email"]').value, credentials.email);
    respond = async path => path === `/api/auth/${method}`
      ? json({ user, token: 'valid-token' }, method === 'register' ? 201 : 200) : json({ rooms: [] });
    await act(async () => document.querySelector('form').requestSubmit());
    assert.equal(location.pathname, '/rooms');
    assert.equal(tokenStorage.get(), 'valid-token');
    assert.ok(document.querySelector('.app-shell'));
  });
}

test('authentication response validation preserves supported IDs, field aliases, and nullable profile fields', async () => {
  await mountProvider(null);
  const validUsers = [
    { ...user, userId: 1, isActive: true, phone: null, bio: null, profileImage: null },
    { user_id: '2', first_name: 'Alias', last_name: 'Account', email: 'alias@example.test', is_active: 1, date_of_birth: null, line_id: null },
    { id: '3', firstName: 'Minimal', lastName: 'Account', email: 'minimal@example.test' },
  ];
  for (const [index, wireUser] of validUsers.entries()) {
    respond = async () => json({ token: `valid-token-${index}`, user: wireUser });
    await act(async () => state.login(wireUser.email, credentials.password));
    assert.equal(state.user.userId, String(index + 1));
    assert.equal(state.user.email, wireUser.email);
    assert.equal(state.user.phone, '');
    assert.equal(state.user.profileImage, '');
    assert.equal(state.user.isActive, true);
  }
});

test('malformed account checks cannot authenticate on startup and can be retried', async () => {
  respond = async () => json({ user: {} });
  await mountProvider();
  assert.equal(state.user, null);
  assert.equal(state.authLoading, false);
  assert.equal(state.authError, invalidAuthMessage);
  assert.equal(tokenStorage.get(), 'old-token');
  respond = async () => json({ user });
  await act(async () => state.retryAuth());
  assert.equal(state.user.userId, user.userId);
  assert.equal(state.authError, '');
});

test('invalid account data from another tab cannot replace the previous identity', async () => {
  await mountProvider();
  respond = async () => json({ user: { ...user, userId: '' } });
  await act(async () => changeTokenInAnotherTab('external-token'));
  assert.equal(state.user, null);
  assert.equal(state.authLoading, false);
  assert.equal(state.authError, invalidAuthMessage);
  assert.equal(tokenStorage.get(), 'external-token');
});

test('an invalid latest login response does not make an older pending login eligible again', async () => {
  await mountProvider(null);
  const older = deferred();
  let calls = 0;
  respond = () => ++calls === 1 ? older.promise : Promise.resolve(json({}));
  let ignored;
  await act(async () => {
    ignored = assert.rejects(state.login(credentials.email, credentials.password), SessionChangedError);
    await assert.rejects(state.login('latest@example.test', credentials.password), InvalidAuthResponseError);
  });
  await act(async () => { older.resolve(json({ user, token: 'older-token' })); await ignored; });
  assert.equal(state.user, null);
  assert.equal(tokenStorage.get(), null);
});

test('API validation retains field errors and readable messages after merging main', async () => {
  await mountProvider();
  respond = async () => json({ error: 'title is required', fieldErrors: { title: 'กรุณากรอกหัวข้อประกาศ', price: 123 } }, 400);
  await assert.rejects(api.createRoom({}), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 400);
    assert.equal(error.message, 'กรุณากรอกหัวข้อประกาศ');
    assert.deepEqual(error.fieldErrors, { title: 'กรุณากรอกหัวข้อประกาศ' });
    return true;
  });
  assert.equal(state.user.userId, user.userId);
  assert.equal(tokenStorage.get(), 'old-token');
});

test('friend cancellation retains the endpoint from main and current authorization', async () => {
  await mountProvider();
  respond = async (path, options) => {
    assert.equal(path, '/api/friends/connections/invitation%2F1/cancel');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.get('Authorization'), 'Bearer old-token');
    return json({ connection: { connectionId: 1, status: 'cancelled', person: user } });
  };
  const connection = await api.cancelFriendInvitation('invitation/1');
  assert.equal(connection.connectionId, '1');
  assert.equal(connection.status, 'cancelled');
});

test('network errors retain their connection message instead of becoming validation errors', async () => {
  await mountProvider();
  respond = async () => { throw new TypeError('Offline'); };
  await assert.rejects(api.profile(), error => error instanceof ApiError
    && error.status === 0 && error.networkError === true
    && error.message === 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง'
    && Object.keys(error.fieldErrors).length === 0);
  assert.equal(state.user.userId, user.userId);
  assert.equal(tokenStorage.get(), 'old-token');
});

for (const priorSession of [null, 'old-token', 'expired-token']) {
  test(`Google completion exchanges once in StrictMode with prior session ${priorSession}`, async () => {
    if (priorSession) tokenStorage.set(priorSession);
    let exchanges = 0;
    const defaultRespond = respond;
    respond = async (path, options) => {
      if (path === '/api/auth/me' && priorSession === 'expired-token') return rejected();
      if (path === '/api/auth/oauth/session') {
        exchanges += 1;
        assert.equal(options.method, 'POST');
        assert.equal(options.headers.has('Authorization'), false);
        return json({ user, token: 'google-token' });
      }
      return defaultRespond(path, options);
    };
    await act(async () => root.render(createElement(StrictMode, null,
      createElement(MemoryRouter, { initialEntries: ['/auth/google/complete?returnTo=%2Fprofile%3Ftab%3Daccount%23details'] }, createElement(App), createElement(LocationProbe)))));
    assert.equal(exchanges, 1);
    assert.equal(tokenStorage.get(), 'google-token');
    assert.equal(location.pathname + location.search + location.hash, '/profile?tab=account#details');
    assert.ok(document.querySelector('.profile-summary'));
  });
}

test('invalid OAuth session payload does not overwrite an existing session', async () => {
  await mountProvider();
  respond = async () => json({ token: 'invalid', user: {} });
  await act(async () => { await assert.rejects(state.completeOAuth(), InvalidAuthResponseError); });
  assert.equal(tokenStorage.get(), 'old-token');
  assert.equal(state.user.userId, user.userId);
});

test('failed OAuth ticket exchange retains an existing session and gives a route to retry', async () => {
  tokenStorage.set('old-token');
  const defaultRespond = respond;
  respond = async (path, options) => path === '/api/auth/oauth/session' ? rejected() : defaultRespond(path, options);
  await act(async () => root.render(createElement(StrictMode, null,
    createElement(MemoryRouter, { initialEntries: ['/auth/google/complete'] }, createElement(App), createElement(LocationProbe)))));
  assert.equal(location.pathname, '/auth/google/complete');
  assert.equal(tokenStorage.get(), 'old-token');
  assert.match(document.querySelector('[role="alert"]').textContent, /กรุณาลองอีกครั้ง/);
  assert.equal(document.querySelector('a').getAttribute('href'), '/login');
});

test('a pending Google sign-in cannot replace an account selected in another tab', async () => {
  await mountProvider(null);
  const pending = deferred();
  respond = async path => path === '/api/auth/oauth/session' ? pending.promise : json({ user: { ...user, userId: '2' } });
  let ignored;
  await act(async () => { ignored = assert.rejects(state.completeOAuth(), SessionChangedError); });
  await act(async () => changeTokenInAnotherTab('other-tab-token'));
  await act(async () => { pending.resolve(json({ user, token: 'google-token' })); await ignored; });
  assert.equal(tokenStorage.get(), 'other-tab-token');
  assert.equal(state.user.userId, '2');
});

test('Google provider discovery has a working retry and preserves the requested destination', async () => {
  respond = async () => { throw new TypeError('Offline'); };
  await act(async () => root.render(createElement(StrictMode, null,
    createElement(MemoryRouter, { initialEntries: [{ pathname: '/login', state: { from: '/rooms/2?view=photos' } }] }, createElement(App)))));
  const retry = document.querySelector('.auth-oauth button');
  assert.equal(retry.disabled, false);
  assert.match(retry.textContent, /ลองเชื่อมต่อ Google/);
  respond = async () => json({ google: true });
  await act(async () => retry.click());
  const link = document.querySelector('.auth-oauth a');
  assert.equal(link.getAttribute('href'), '/api/auth/oauth/google?returnTo=%2Frooms%2F2%3Fview%3Dphotos');
});

test('unknown OAuth query errors cannot render inherited object properties', async () => {
  await act(async () => root.render(createElement(StrictMode, null,
    createElement(MemoryRouter, { initialEntries: ['/login?oauth_error=__proto__'] }, createElement(App)))));
  assert.ok(document.querySelector('form'));
  assert.equal(document.querySelector('[role="alert"]'), null);
});
