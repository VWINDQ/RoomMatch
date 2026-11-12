# RoomMatch implementation contract

## Continuation decision

The existing Vite, React, TypeScript, and React Router application is structurally sound and its Claymorphism design is reusable. The implementation extends it with a small Node.js API and SQLite database instead of rebuilding the UI.

The runtime target is Node.js 26. The server uses the built-in `node:http`, `node:crypto`, and `node:sqlite` modules, so no backend framework or database package is required.

## Database contract

The original room workflow preserves the eight entities required by the ER diagram:

1. `USER`
2. `LIFESTYLE`
3. `PREFERENCE`
4. `ROOM`
5. `ROOM_IMAGE`
6. `ROOM_MEMBER`
7. `ROOM_REQUEST`
8. `MATCHES`

The later user-requested people-first workflow adds `FRIEND_CONNECTION` as a
separate ninth entity, without changing the original eight schemas or rows.
Its contract and rationale are documented in [FRIENDS.md](FRIENDS.md).

Relationship foreign keys are added to those entities:

- `LIFESTYLE.user_id -> USER.user_id`, unique and not null.
- `PREFERENCE.user_id -> USER.user_id`, unique and not null.
- `ROOM.owner_id -> USER.user_id`, not null.
- `ROOM_IMAGE.room_id -> ROOM.room_id`, not null.
- `ROOM_MEMBER.user_id -> USER.user_id` and `ROOM_MEMBER.room_id -> ROOM.room_id`, with composite primary key `(user_id, room_id)`.
- `ROOM_REQUEST.user_id -> USER.user_id` and `ROOM_REQUEST.room_id -> ROOM.room_id`.
- `MATCHES.initiator_user_id -> USER.user_id`, `MATCHES.completer_user_id -> USER.user_id`, and `MATCHES.room_id -> ROOM.room_id`.

### Lifestyle cardinality

The implementation follows the diagram's 1:1 `SHARES` relationship. A lifestyle belongs to exactly one user because `LIFESTYLE.user_id` is unique. Consequently, rows such as "ไม่สูบบุหรี่" cannot be reused as a shared category by several users. The current product has no persisted reusable lifestyle catalogue, so no ER change is needed. If reusable categories are later required, the ER must change to a lifestyle catalogue plus a `USER_LIFESTYLE` junction table.

### Capacity rule

`ROOM.capacity` includes the owner. A room with capacity 2 has one place for its owner and one place for an approved member. Available places are `capacity - 1 - approved member count`.

The approval transaction must:

- verify the authenticated user owns the room;
- reject self-requests and self-matches;
- reject a duplicate membership or match;
- reject duplicate pending requests;
- reject approval when no place remains;
- update the request, insert `ROOM_MEMBER`, and insert `MATCHES` atomically;
- mark the room full when the capacity is reached.

The owner is represented by `ROOM.owner_id`; the owner is not duplicated in `ROOM_MEMBER`.

### ER-only feature policy

Favorites, amenities, and tags are not database-backed features because they are absent from the source ER diagram. The old mock Favorites and Amenities controls must not be presented as working persisted features. No tables for them are added.

### Presentation convention

The ER has no room-title attribute. To preserve the useful existing title field without silently changing the schema, the first line of `ROOM.description` is treated as the display title; the remaining lines are the detailed description. The API exposes both `title` and `description` while persisting a single ER-compliant `description` value.

## Authentication contract

- Passwords use `scrypt` with a per-password random salt and constant-time verification.
- Authentication uses a short stateless HMAC-signed bearer token. No session table is introduced.
- The signing secret comes from `ROOMMATCH_TOKEN_SECRET`; a random process-local secret is used only for local development when the variable is absent.
- Protected routes return `401`; owner-only routes return `403`; validation and conflicts use `400`/`409` with `{ "error": "..." }`.

## API contract

All JSON endpoints live under `/api`.

### Authentication and account

- `POST /api/auth/register` — create a user and return `{ token, user }`.
- `POST /api/auth/login` — return `{ token, user }`.
- `GET /api/auth/me` — return the authenticated user.
- `GET /api/profile` — profile plus lifestyle and preference.
- `PATCH /api/profile` — edit allowed profile fields.
- `PUT /api/lifestyle` — create or replace the authenticated user's 1:1 lifestyle.
- `PUT /api/preference` — create or replace the authenticated user's 1:1 preference.

### Rooms and images

- `GET /api/rooms` — browse/search/sort/filter by price and status.
- `GET /api/rooms/:roomId` — room, owner, ordered images, occupancy, members, and current-user request state.
- `POST /api/rooms` — create an owned room with image URLs.
- `PATCH /api/rooms/:roomId` — owner-only update.
- `DELETE /api/rooms/:roomId` — owner-only delete.
- `POST /api/rooms/:roomId/images` — owner-only add an image URL.
- `DELETE /api/rooms/:roomId/images/:imageId` — owner-only remove an image.
- `GET /api/my/rooms` — authenticated user's listings.

Room write payload fields are `title`, `description`, `googleMapsUrl`, `price`, `capacity`, `status`, and `images`. `title` is encoded into the first description line per the presentation convention.

### Requests, membership, and matches

The room-request endpoints are implemented in `server/requests.js`, composed
by `server/app.js` with the existing authentication and response helpers.
See [room-request contract and verification](REQUESTS.md) for ownership rules,
transaction behavior, error codes, and the first-feature testing checklist.
New decision timestamps use ISO 8601 UTC (`respondedAt` ending in `Z`).

Member/match read endpoints live in `server/matches.js`. Member lists are limited
to the room owner or approved members, including the list embedded in public
room details. Match lists expose only the authenticated participant's matches
with current approved membership; historical database rows are retained.
See [member/match contract and verification](MATCHES.md).

- `POST /api/rooms/:roomId/requests` — send a join request.
- `GET /api/requests/mine` — request status for the authenticated requester.
- `GET /api/owner/requests` — requests for rooms owned by the authenticated user.
- `PATCH /api/requests/:requestId` with `{ status: "approved" | "rejected" }` — owner-only decision; approval performs the atomic membership/match workflow.
- `GET /api/rooms/:roomId/members` — room owner or member can view members.
- `GET /api/matches` — matches involving the authenticated user.

### Friend discovery and invitations

`server/friends.js` handles authenticated profile search and invitations without
changing room requests or matches. Full-name search is supported. Invitation
writes and response-profile reads commit atomically; only the recipient may
decide and only accepted participants receive contact details. See
[friend API rules and verification](FRIENDS.md) for endpoints, errors and tests.

## Frontend routes

- `/login`, `/register`
- `/rooms`, `/rooms/:roomId`
- `/my-listings`, `/my-listings/new`, `/my-listings/:roomId/edit`
- `/requests` for sent and owner-side requests
- `/matches` for approved matches and room membership
- `/profile` for profile, lifestyle, and preference
- `/friends` for people-first discovery, invitations, and accepted friends

Protected routes redirect unauthenticated users to `/login`.
