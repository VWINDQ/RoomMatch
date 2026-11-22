import type { FriendConnection, FriendProfile, JoinRequest, Lifestyle, Match, Preference, ProfileBundle, Room, RoomMember, RoommateProfile, User } from '../types';
import { friendlyApiError } from './apiErrors';
import type { RegistrationProfile } from './registration';

export type RoomPage = { rooms: Room[]; total: number; page: number; pageSize: number; totalPages: number };
export class InvalidRoomPageResponseError extends Error {
  constructor() { super('เซิร์ฟเวอร์ส่งข้อมูลแบ่งหน้าไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง'); this.name = 'InvalidRoomPageResponseError'; }
}
async function requestRoomPage(path: string, params: URLSearchParams): Promise<RoomPage> {
  const query = new URLSearchParams(params);
  if (!query.has('page')) query.set('page', '1');
  if (!query.has('pageSize')) query.set('pageSize', path === '/my/rooms' ? '10' : '12');
  const result = object(await request<unknown>(`${path}?${query}`));
  const { rooms, total, page, pageSize, totalPages } = result;
  const integer = (value: unknown, min: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
  const requestedSize = Number(query.get('pageSize'));
  const requestedPage = Number(query.get('page'));
  if (!Array.isArray(rooms) || !integer(total, 0) || !integer(page, 1) || !integer(pageSize, 1) || !integer(totalPages, 0)
    || pageSize !== requestedSize || totalPages !== Math.ceil(total / pageSize)
    || page !== Math.min(requestedPage, Math.max(1, totalPages))
    || rooms.length !== Math.min(pageSize, Math.max(0, total - (page - 1) * pageSize))) {
    // A hot-updated client can encounter an older API process. Never mistake its
    // unbounded legacy rooms array for a page or write undefined metadata to URLs.
    throw new InvalidRoomPageResponseError();
  }
  return { rooms: rooms.map(normalizeRoom), total, page, pageSize, totalPages };
}

// Each tab owns its login. Never fall back to the former shared localStorage token.
const TOKEN_KEY = 'roommatch:token';
let tokenRevision = 0;
let observedToken: string | null | undefined;
const tokenChangeListeners = new Set<() => void>();
type JsonObject = Record<string, unknown>;

export class ApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public fieldErrors: Record<string, string> = {},
      public networkError = false
    ) {
      super(status === 0 ? message : friendlyApiError(message, status));
      this.name = 'ApiError';
    }
  }

  export class SessionChangedError extends Error {
    constructor() {
      super('The active account has been changed; please try again.');
      this.name = 'SessionChangedError';
    }
  }

  export class InvalidAuthResponseError extends Error {
    constructor() {
      super('The server sent incomplete or incorrect account information. Please try again.');
      this.name = 'InvalidAuthResponseError';
    }
  }

  function synchronizeToken() {
    observedToken = sessionStorage.getItem(TOKEN_KEY);
    tokenRevision += 1;
    for (const listener of tokenChangeListeners) listener();
  }

  function handleTokenStorage(event: StorageEvent) {
    // sessionStorage events can come from same-origin frames in this tab only.
    if (event.storageArea !== sessionStorage || (event.key !== TOKEN_KEY && event.key !== null)) return;
    synchronizeToken();
}

const object = (value: unknown): JsonObject => value && typeof value === 'object' ? value as JsonObject : {};
const pick = (source: JsonObject, ...keys: string[]) => keys.map(key => source[key]).find(value => value !== undefined && value !== null);
const text = (source: JsonObject, ...keys: string[]) => String(pick(source, ...keys) ?? '');
const numeric = (source: JsonObject, ...keys: string[]) => { const value = Number(pick(source, ...keys)); return Number.isFinite(value) ? value : 0; };
const list = (value: unknown, ...keys: string[]) => {
  if (Array.isArray(value)) return value;
  const source = object(value);
  for (const key of keys) if (Array.isArray(source[key])) return source[key] as unknown[];
  return [];
};

export function normalizeUser(value: unknown): User {
  const source = object(value);
  return {
    userId: text(source, 'userId', 'user_id', 'id'), firstName: text(source, 'firstName', 'first_name'), lastName: text(source, 'lastName', 'last_name'),
    phone: text(source, 'phone'), gender: text(source, 'gender'), dateOfBirth: text(source, 'dateOfBirth', 'date_of_birth'), university: text(source, 'university'),
    accountType: text(source, 'accountType'), profileSetupPending: source.profileSetupPending === true,
    profileReminderSeen: typeof source.profileReminderSeen === 'boolean' ? source.profileReminderSeen : undefined,
    profileImage: text(source, 'profileImage', 'profile_image'), bio: text(source, 'bio'), email: text(source, 'email'), instagram: text(source, 'instagram'),
    lineId: text(source, 'lineId', 'line_id'), isActive: Boolean(pick(source, 'isActive', 'is_active') ?? true),
  };
}

const isJsonObject = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function parseAuthenticatedUser(value: unknown): User {
  if (!isJsonObject(value)) throw new InvalidAuthResponseError();
  const userId = pick(value, 'userId', 'user_id', 'id');
  const validId = typeof userId === 'number'
    ? Number.isSafeInteger(userId) && userId > 0
    : typeof userId === 'string' && /^[1-9]\d*$/.test(userId) && Number.isSafeInteger(Number(userId));
  const firstName = pick(value, 'firstName', 'first_name');
  const lastName = pick(value, 'lastName', 'last_name');
  const email = value.email;
  const active = value.isActive !== undefined ? value.isActive : value.is_active;
  if (!validId || !isNonEmptyString(firstName) || !isNonEmptyString(lastName)
    || !isNonEmptyString(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || (active !== undefined && active !== true && active !== 1)) {
    throw new InvalidAuthResponseError();
  }
  const optionalTextFields = [
    ['phone'], ['gender'], ['dateOfBirth', 'date_of_birth'], ['university'],
    ['profileImage', 'profile_image'], ['bio'], ['instagram'], ['lineId', 'line_id'],
  ];
  if (optionalTextFields.some(keys => {
    const field = pick(value, ...keys);
    return field !== undefined && typeof field !== 'string';
  })) throw new InvalidAuthResponseError();
  // Validate before normalization can turn missing fields or wrong types into strings.
  return normalizeUser(value);
}

function parseAuthSession(value: unknown) {
  if (!isJsonObject(value) || typeof value.token !== 'string' || !/^[\x21-\x7e]+$/.test(value.token)) {
    throw new InvalidAuthResponseError();
  }
  return { token: value.token, user: parseAuthenticatedUser(value.user) };
}

function normalizeRoom(value: unknown): Room {
  const source = object(value);
  const images = list(pick(source, 'images', 'roomImages', 'room_images')).map((item, index) => {
    const image = object(item);
    return { imageId: text(image, 'imageId', 'image_id', 'id') || String(index), imageUrl: text(image, 'imageUrl', 'image_url', 'url'), imageOrder: numeric(image, 'imageOrder', 'image_order', 'order') || index };
  }).sort((a, b) => a.imageOrder - b.imageOrder);
  const rawMembers = pick(source, 'members');
  return {
    roomId: text(source, 'roomId', 'room_id', 'id'), ownerId: text(source, 'ownerId', 'owner_id'), title: text(source, 'title'), description: text(source, 'description'),
    googleMapsUrl: text(source, 'googleMapsUrl', 'google_maps_url', 'mapUrl'), price: numeric(source, 'price', 'monthlyPrice'), capacity: numeric(source, 'capacity') || 1,
    priceBasis: (pick(source, 'priceBasis', 'price_basis') ?? null) as Room['priceBasis'], locality: text(source, 'locality'), costNotes: text(source, 'costNotes', 'cost_notes'), isMember: Boolean(source.isMember),
    status: (text(source, 'status') || 'available') as Room['status'], createdAt: text(source, 'createdAt', 'created_at'), owner: source.owner ? normalizeUser(source.owner) : undefined,
    images, members: Array.isArray(rawMembers) ? rawMembers.map(normalizeMember) : undefined, memberCount: numeric(source, 'memberCount', 'member_count'),
    ownerResidentProfile: source.ownerResidentProfile ? normalizeRoommateProfile(source.ownerResidentProfile) : undefined,
    ownerIsResident: Boolean(pick(source, 'ownerIsResident', 'owner_is_resident') ?? true),
    occupantCount: pick(source, 'occupantCount', 'occupant_count') == null ? numeric(source, 'memberCount', 'member_count') + Number(pick(source, 'ownerIsResident', 'owner_is_resident') ?? true) : numeric(source, 'occupantCount', 'occupant_count'),
    availableSlots: numeric(source, 'availableSlots', 'available_slots'), isOwner: Boolean(source.isOwner ?? source.is_owner), isFavorite: Boolean(source.isFavorite ?? source.is_favorite),
    requestStatus: (pick(source, 'requestStatus', 'request_status') ?? null) as Room['requestStatus'],
    pendingRequestId: text(source, 'pendingRequestId', 'pending_request_id') || null,
  };
}

function normalizeMember(value: unknown): RoomMember {
  const source = object(value);
  return { userId: text(source, 'userId', 'user_id'), roomId: text(source, 'roomId', 'room_id'), status: text(source, 'status'), joinedAt: text(source, 'joinedAt', 'joined_at'), user: source.user ? normalizeUser(source.user) : normalizeUser(source),
    profile: source.profile ? normalizeRoommateProfile(source.profile) : undefined };
}

function normalizeRequest(value: unknown): JoinRequest {
  const source = object(value); const room = source.room ? normalizeRoom(source.room) : undefined;
  return { requestId: text(source, 'requestId', 'request_id', 'id'), roomId: text(source, 'roomId', 'room_id') || room?.roomId, userId: text(source, 'userId', 'user_id'),
    status: (text(source, 'status') || 'pending') as JoinRequest['status'], membershipActive: typeof source.membershipActive === 'boolean' ? source.membershipActive : undefined, requestedAt: text(source, 'requestedAt', 'requested_at'), respondedAt: text(source, 'respondedAt', 'responded_at'),
    room, requester: source.requester ? normalizeUser(source.requester) : undefined };
}

const normalizePreference = (value: unknown): Preference => {
  const source = object(value);
  const optional = (...keys: string[]) => { const raw = pick(source, ...keys); return raw === undefined || raw === null || raw === '' ? null : Number(raw); };
  return { preferenceId: text(source, 'preferenceId', 'preference_id'), preferredGender: text(source, 'preferredGender', 'preferred_gender'), preferredAgeMin: optional('preferredAgeMin', 'preferred_age_min'), preferredAgeMax: optional('preferredAgeMax', 'preferred_age_max'), budgetMin: optional('budgetMin', 'budget_min'), budgetMax: optional('budgetMax', 'budget_max') };
};

function normalizeProfile(value: unknown): ProfileBundle {
  const source = object(value); const lifestyle = object(source.lifestyle);
  return { user: normalizeUser(source.user), lifestyle: source.lifestyle ? { lifestyleId: text(lifestyle, 'lifestyleId', 'lifestyle_id'), lifestyleName: text(lifestyle, 'lifestyleName', 'lifestyle_name') } : null, preference: source.preference ? normalizePreference(source.preference) : null };
}

const unauthorizedListeners = new Set<(token: string) => void>();

export function subscribeUnauthorized(listener: (token: string) => void) {
  unauthorizedListeners.add(listener);
  return () => { unauthorizedListeners.delete(listener); };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const sessionToken = tokenStorage.get();
  if (tokenChangeListeners.size && sessionToken !== observedToken) {
    // Do not send an old screen's action under a new account before its storage event arrives.
    synchronizeToken();
    throw new SessionChangedError();
  }
  const headers = new Headers(options.headers);
  const isSignInRequest = path === '/auth/login' || path === '/auth/register' || path.startsWith('/auth/oauth/');
  const token = isSignInRequest ? null : sessionToken;
  const revision = tokenRevision;
  const assertCurrentSession = () => {
    if (revision !== tokenRevision || sessionToken !== tokenStorage.get()) throw new SessionChangedError();
  };
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response: Response;
  try { response = await fetch(`/api${path}`, { ...options, headers }); }
  catch {
    assertCurrentSession();
    throw new ApiError(
      'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง',
      0,
      {},
      true
    );
  }
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  assertCurrentSession();
  if (!response.ok) {
    // A late failure must not invalidate a newer login, even if its token is identical.
    if (response.status === 401 && token && token === tokenStorage.get() && revision === tokenRevision) {
      for (const listener of unauthorizedListeners) listener(token);
    }
    const fieldErrors = Object.fromEntries(Object.entries(object(object(payload).fieldErrors)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    throw new ApiError(text(object(payload), 'error', 'message') || 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง', response.status, fieldErrors);
  }

  return payload as T;
}

export const tokenStorage = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (token: string) => {
    sessionStorage.setItem(TOKEN_KEY, token);
    observedToken = token;
    tokenRevision += 1;
  },
  clear: () => {
    sessionStorage.removeItem(TOKEN_KEY);
    observedToken = null;
    tokenRevision += 1;
  },
  subscribe: (listener: () => void) => {
    if (!tokenChangeListeners.size) {
      const token = tokenStorage.get();
      if (observedToken !== token) tokenRevision += 1;
      observedToken = token;
      window.addEventListener('storage', handleTokenStorage);
    }
    tokenChangeListeners.add(listener);
    return () => {
      tokenChangeListeners.delete(listener);
      if (!tokenChangeListeners.size) window.removeEventListener('storage', handleTokenStorage);
    };
  },
};

function normalizeRoommateProfile(value: unknown): RoommateProfile {
  const source = object(value);
  const amount = (key: string) => source[key] == null ? null : Number(source[key]);
  return { userId: text(source, 'userId'), firstName: text(source, 'firstName'), lastName: text(source, 'lastName'),
    university: text(source, 'university'), bio: text(source, 'bio'), profileImage: text(source, 'profileImage'),
    lifestyle: text(source, 'lifestyle'), budgetMin: amount('budgetMin'), budgetMax: amount('budgetMax'),
    gender: text(source, 'gender'), preferredGender: text(source, 'preferredGender'),
    preferredAgeMin: amount('preferredAgeMin'), preferredAgeMax: amount('preferredAgeMax'),
    age: typeof source.age === 'number' ? source.age : null };
}
function normalizeFriend(value: unknown): FriendProfile {
  const source = object(value);
  return { ...normalizeRoommateProfile(source),
    lineId: text(source, 'lineId'), instagram: text(source, 'instagram'), email: text(source, 'email'), phone: text(source, 'phone') };
}
function normalizeConnection(value: unknown): FriendConnection {
  const source = object(value);
  return { connectionId: text(source, 'connectionId'), direction: text(source, 'direction') as FriendConnection['direction'],
    status: text(source, 'status') as FriendConnection['status'], createdAt: text(source, 'createdAt'),
    respondedAt: text(source, 'respondedAt'), person: normalizeFriend(source.person) };
}

export const api = {
  async uploadImage(file: File) {
    try {
      const result = await request<JsonObject>('/uploads/images', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      return text(result, 'imageUrl');
    } catch (error) {
      if (error instanceof ApiError && error.status === 500) throw new ApiError('อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', error.status);
      throw error;
    }
  },
  async friends(query = '') { return list(await request(`/friends?q=${encodeURIComponent(query)}`), 'people').map(normalizeFriend); },
  async friendConnections() { return list(await request('/friends/connections'), 'connections').map(normalizeConnection); },
  async inviteFriend(recipientId: string) { const result = await request<JsonObject>('/friends/connections', { method: 'POST', body: JSON.stringify({ recipientId: Number(recipientId) }) }); return normalizeConnection(result.connection); },
  async decideFriend(connectionId: string, status: 'accepted' | 'declined') { const result = await request<JsonObject>(`/friends/connections/${connectionId}`, { method: 'PATCH', body: JSON.stringify({ status }) }); return normalizeConnection(result.connection); },
  async cancelFriendInvitation(connectionId: string) { const result = await request<JsonObject>(`/friends/connections/${encodeURIComponent(connectionId)}/cancel`, { method: 'POST' }); return normalizeConnection(result.connection); },
  async login(payload: { email: string; password: string }) { return parseAuthSession(await request<unknown>('/auth/login', { method: 'POST', body: JSON.stringify(payload) })); },
  async register(payload: JsonObject) { return parseAuthSession(await request<unknown>('/auth/register', { method: 'POST', body: JSON.stringify(payload) })); },
  async oauthProviders() { const result = await request<JsonObject>('/auth/oauth/providers'); return { google: result.google === true }; },
  async completeOAuth(flow: string) { return parseAuthSession(await request<unknown>(`/auth/oauth/session?flow=${encodeURIComponent(flow)}`, { method: 'POST', body: '{}' })); },
  async googleRegistrationPreview(flow: string) {
    const result = object(await request<unknown>(`/auth/oauth/registration/preview?flow=${encodeURIComponent(flow)}`, { method: 'POST', body: '{}' }));
    if (typeof result.email !== 'string' || !result.email || typeof result.firstName !== 'string' || typeof result.lastName !== 'string') throw new InvalidAuthResponseError();
    return { email: result.email, firstName: result.firstName, lastName: result.lastName };
  },
  async confirmGoogleRegistration(flow: string, profile: RegistrationProfile) {
    return parseAuthSession(await request<unknown>(`/auth/oauth/registration/confirm?flow=${encodeURIComponent(flow)}`, { method: 'POST', body: JSON.stringify(profile) }));
  },
  async cancelGoogleRegistration(flow: string) {
    await request(`/auth/oauth/registration/cancel?flow=${encodeURIComponent(flow)}`, { method: 'POST', body: '{}' });
  },
  async me() { const result = await request<unknown>('/auth/me'); return parseAuthenticatedUser(object(result).user); },
  roomsPage: (params: URLSearchParams) => requestRoomPage('/rooms', params),
  favoritesPage: (params: URLSearchParams) => requestRoomPage('/favorites', params),
  myRoomsPage: (params: URLSearchParams) => requestRoomPage('/my/rooms', params),
  async rooms(params: URLSearchParams) { return list(await request(`/rooms${params.size ? `?${params}` : ''}`), 'rooms').map(normalizeRoom); },
  async room(roomId: string) { const result = await request<JsonObject>(`/rooms/${roomId}`); return normalizeRoom(result.room); },
  async myRooms() { return list(await request('/my/rooms'), 'rooms').map(normalizeRoom); },
  async favorites() {
    return list(await request('/favorites'), 'rooms').map(normalizeRoom);
  },
  addFavorite: (roomId: string) =>
    request<void>(`/rooms/${roomId}/favorite`, { method: 'PUT' }),
  removeFavorite: (roomId: string) =>
    request<void>(`/rooms/${roomId}/favorite`, { method: 'DELETE' }),
  async createRoom(payload: JsonObject) { const result = await request<JsonObject>('/rooms', { method: 'POST', body: JSON.stringify(payload) }); return normalizeRoom(result.room); },
  async updateRoom(roomId: string, payload: JsonObject) { const result = await request<JsonObject>(`/rooms/${roomId}`, { method: 'PATCH', body: JSON.stringify(payload) }); return normalizeRoom(result.room); },
  deleteRoom: (roomId: string) => request<void>(`/rooms/${roomId}`, { method: 'DELETE' }),
  async createJoinRequest(roomId: string) { const result = await request<JsonObject>(`/rooms/${roomId}/requests`, { method: 'POST' }); return normalizeRequest(result.request); },
  async cancelRequest(requestId: string) { const result = await request<JsonObject>(`/requests/${requestId}/cancel`, { method: 'POST' }); return normalizeRequest(result.request); },
  leaveRoom: (roomId: string) => request<void>(`/rooms/${roomId}/members/me`, { method: 'DELETE' }),
  async mineRequests() { return list(await request('/requests/mine'), 'requests').map(normalizeRequest); },
  async ownerRequests() { return list(await request('/owner/requests'), 'requests').map(normalizeRequest); },
  async requesterProfile(requestId: string) { const result = await request<JsonObject>(`/requests/${encodeURIComponent(requestId)}/profile`); return normalizeFriend(result.profile); },
  async decideRequest(requestId: string, status: 'approved' | 'rejected') { const result = await request<JsonObject>(`/requests/${requestId}`, { method: 'PATCH', body: JSON.stringify({ status }) }); return normalizeRequest(result.request); },
  async roomMembers(roomId: string) { return list(await request(`/rooms/${roomId}/members`), 'members').map(normalizeMember); },
  async matches() { return list(await request('/matches'), 'matches').map(item => { const source = object(item); return { matchId: text(source, 'matchId', 'match_id'), matchedAt: text(source, 'matchedAt', 'matched_at'), otherRole: text(source, 'otherRole') as Match['otherRole'], room: source.room ? normalizeRoom(source.room) : undefined, otherUser: source.otherUser ? normalizeUser(source.otherUser) : undefined } satisfies Match; }); },
  async profile() { return normalizeProfile(await request('/profile')); },
  async updateProfile(payload: JsonObject) { return normalizeProfile(await request('/profile', { method: 'PATCH', body: JSON.stringify(payload) })); },
  updateLifestyle: (payload: Lifestyle) => request('/lifestyle', { method: 'PUT', body: JSON.stringify(payload) }),
  updatePreference: (payload: Preference) => request('/preference', { method: 'PUT', body: JSON.stringify(payload) }),
};
