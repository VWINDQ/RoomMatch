import type { FriendConnection, FriendProfile, JoinRequest, Lifestyle, Match, Preference, ProfileBundle, Room, RoomMember, User } from '../types';
import { friendlyApiError } from './apiErrors';

const TOKEN_KEY = 'roommatch:token';
type JsonObject = Record<string, unknown>;

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = 'ApiError'; }
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
    profileImage: text(source, 'profileImage', 'profile_image'), bio: text(source, 'bio'), email: text(source, 'email'), instagram: text(source, 'instagram'),
    lineId: text(source, 'lineId', 'line_id'), isActive: Boolean(pick(source, 'isActive', 'is_active') ?? true),
  };
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
    availableSlots: numeric(source, 'availableSlots', 'available_slots'), isOwner: Boolean(source.isOwner ?? source.is_owner),
    requestStatus: (pick(source, 'requestStatus', 'request_status') ?? null) as Room['requestStatus'],
    pendingRequestId: text(source, 'pendingRequestId', 'pending_request_id') || null,
  };
}

function normalizeMember(value: unknown): RoomMember {
  const source = object(value);
  return { userId: text(source, 'userId', 'user_id'), roomId: text(source, 'roomId', 'room_id'), status: text(source, 'status'), joinedAt: text(source, 'joinedAt', 'joined_at'), user: source.user ? normalizeUser(source.user) : normalizeUser(source) };
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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers); const token = tokenStorage.get();
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response: Response;
  try { response = await fetch(`/api${path}`, { ...options, headers }); }
  catch { throw new ApiError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง', 0); }
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(friendlyApiError(text(object(payload), 'error', 'message'), response.status), response.status);
  return payload as T;
}

export const tokenStorage = { get: () => localStorage.getItem(TOKEN_KEY), set: (token: string) => localStorage.setItem(TOKEN_KEY, token), clear: () => localStorage.removeItem(TOKEN_KEY) };

function normalizeFriend(value: unknown): FriendProfile {
  const source = object(value);
  const budget = (key: string) => source[key] == null ? null : Number(source[key]);
  return { userId: text(source, 'userId'), firstName: text(source, 'firstName'), lastName: text(source, 'lastName'),
    university: text(source, 'university'), bio: text(source, 'bio'), profileImage: text(source, 'profileImage'),
    lifestyle: text(source, 'lifestyle'), budgetMin: budget('budgetMin'), budgetMax: budget('budgetMax'),
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
  async login(payload: { email: string; password: string }) { const result = await request<JsonObject>('/auth/login', { method: 'POST', body: JSON.stringify(payload) }); return { token: text(result, 'token'), user: normalizeUser(result.user) }; },
  async register(payload: JsonObject) { const result = await request<JsonObject>('/auth/register', { method: 'POST', body: JSON.stringify(payload) }); return { token: text(result, 'token'), user: normalizeUser(result.user) }; },
  async me() { const result = await request<JsonObject>('/auth/me'); return normalizeUser(result.user); },
  async rooms(params: URLSearchParams) { return list(await request(`/rooms${params.size ? `?${params}` : ''}`), 'rooms').map(normalizeRoom); },
  async room(roomId: string) { const result = await request<JsonObject>(`/rooms/${roomId}`); return normalizeRoom(result.room); },
  async myRooms() { return list(await request('/my/rooms'), 'rooms').map(normalizeRoom); },
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
