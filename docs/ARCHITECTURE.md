# RoomMatch implementation contract

## Continuation decision

The existing Vite, React, TypeScript, and React Router application is structurally sound and its Claymorphism design is reusable. The implementation extends it with a small Node.js API and PostgreSQL database instead of rebuilding the UI.

The runtime target is Node.js 26. The server uses `node:http`, `node:crypto`, and the `pg` PostgreSQL driver. One pooled connection is retained per request; database operations are asynchronous. Room writes acquire a room-row lock before checking capacity and changing requests/members. See [PostgreSQL setup and transaction contract](../database/POSTGRESQL.md).

Listing saves distinguish image upload failures (under the image picker) from
room save failures (above the save buttons). API field errors stay with their
fields. Connection advice is shown only for a rejected fetch, while generic
server failures use a safe message for the failed step. Completed uploads stay
in form state and are reused when retrying.

The listing form locks submission synchronously with a ref while uploading or
saving, and retains the lock after success until navigation. Failed operations
unlock for retry without clearing the form or completed uploads. This does not
change the database schema. If the server creates a room but its response is
lost, retrying can create another room: the browser cannot determine whether
the first save committed. Independent submissions, including submissions from
other tabs or forms, may create identical rooms; names and prices are not used
to reject duplicates.

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

The later UX migration `005` extends `ROOM` with nullable `price_basis`, `locality`,
and `cost_notes`, and adds `cancelled` to `ROOM_REQUEST` without losing existing rows.
The filename ledger `_roommatch_migrations` is internal migration bookkeeping,
not another business entity. Lifecycle/API details are in [UX_FIXES.md](UX_FIXES.md).

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
- reject an active duplicate membership; allow a former member to apply again;
- reject duplicate pending requests;
- reject approval when no place remains;
- update the request and insert/reactivate `ROOM_MEMBER` and `MATCHES` atomically;
- mark the room full when the capacity is reached.

The owner is represented by `ROOM.owner_id`; the owner is not duplicated in `ROOM_MEMBER`.

### Feature extensions

Favorites are persisted through `ROOM_FAVORITE` (migration 004), with composite primary key `(user_id, room_id)`, creation time, and cascading user/room foreign keys. Both authenticated participants and public listing reads retain the existing privacy rules; favorite status is scoped to the viewer. Amenities and tags have no persisted implementation.

### Presentation convention

The ER has no room-title attribute. To preserve the useful existing title field without silently changing the schema, the first line of `ROOM.description` is treated as the display title; the remaining lines are the detailed description. The API exposes both `title` and `description` while persisting a single ER-compliant `description` value.

## Authentication contract

- Passwords use `scrypt` with a per-password random salt and constant-time verification.
- Authentication uses a short stateless HMAC-signed bearer token. No session table is introduced.
- The signing secret comes from `ROOMMATCH_TOKEN_SECRET`; a random process-local secret is used only for local development when the variable is absent.
- Protected routes return `401`; owner-only routes return `403`; validation and conflicts use `400`/`409` with `{ "error": "..." }`.
- The client ends the current session when an authenticated API request returns `401`, clears account errors, and redirects to login while preserving the full destination URL. Sign-in errors, network failures, and `403`/`5xx` responses retain their normal error handling. Responses from an earlier session cannot clear or overwrite a newer login.
- Successful login and registration clear previous account-check errors. Client auth regression tests mount the React app in jsdom and run with `npm test`.
- Before establishing a session, the client validates the raw login/register response: a non-empty ASCII token without whitespace, a positive safe integer user ID (number or digit string), non-empty first/last names, and a valid email. Optional profile text may be missing or null, and an explicitly inactive or malformed active flag is rejected. `/auth/me` uses the same user validation. Malformed successful responses raise `InvalidAuthResponseError` without storing a new token or user; token signatures are verified by the server.
- Only the most recently started login or registration attempt may establish a session, even if that latest attempt fails. Earlier attempts reject with `SessionChangedError`; logout, external token changes, and provider unmount invalidate pending attempts. Account refreshes do not supersede a sign-in attempt.
- Tabs synchronize account changes through localStorage `storage` events, including logout and storage clearing. The previous account is hidden while `/api/auth/me` verifies the current token; a failed verification can be retried without showing the previous account. Requests from an earlier session reject with `SessionChangedError`, and protected page state is recreated when the user changes. Requests already processed by the server are not rolled back.

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

### Uploaded images

`POST /api/uploads/images` requires an active bearer token and receives one raw image file
with `Content-Type: image/jpeg`, `image/png`, or `image/webp` (not multipart/JSON).
It returns `{ imageUrl: "/uploads/<userId>/<uuid>.webp" }` for the existing profile/room
write APIs. These relative paths may only be attached by their uploader; legacy HTTP(S)
image URLs remain supported. `GET/HEAD /uploads/...` serves the normalized image publicly.
Files are outside the build output, under `ROOMMATCH_UPLOAD_DIR` (default `storage/uploads`).
The database keeps the generated path in `USER.profile_image` or `ROOM_IMAGE.image_url`;
there is no schema migration. See [UPLOADS.md](UPLOADS.md) for limits and deployment storage.

### Rooms and images

- `GET /api/rooms` — browse/search/sort/filter by price and status.
  RM-12: `page` (positive safe integer, default 1) / `pageSize` (1–100,
  default 12) opt into server pagination. Response: `{ rooms, total, page,
  pageSize, totalPages }`. Filtering precedes counting and sorting; every sort
  uses descending room ID to break ties. Count and page share one SQL snapshot.
  Oversized pages return the last real page; empty results return page 1 and
  totalPages 0. Legacy `limit`/`offset` callers retain `{ rooms }` with additive
  `total`; mixing the two pagination styles returns 400.
  `/rooms` displays 12 rooms per page and keeps page/search/filter/sort in the
  URL. Condition changes reset page; canonical page corrections replace history
  without another API call. Room detail return state preserves the list URL.
- `GET /api/rooms/:roomId` — room, owner, ordered images, occupancy, members, and current-user request state.
- `POST /api/rooms` — create an owned room with image URLs.
- `PATCH /api/rooms/:roomId` — owner-only update.
- `DELETE /api/rooms/:roomId` — owner-only delete.
- `POST /api/rooms/:roomId/images` — owner-only add an image URL.
- `DELETE /api/rooms/:roomId/images/:imageId` — owner-only remove an image.
- `GET /api/my/rooms` — authenticated user's listings.

Room write payload fields are `title`, `description`, `googleMapsUrl`, `price`, `capacity`, `status`, and `images`. `title` is encoded into the first description line per the presentation convention.

Listing validation is shared by the form and room create/update APIs in
`shared/listingValidation.js`. Price is a positive safe integer in whole baht; capacity is
1–100 including the owner and cannot be reduced below current occupancy.
Text limits after trimming are title 200, description 5000, map URL 2048,
locality 200, and cost notes 1000. Map URLs must be complete HTTP(S) URLs;
no Google-only host restriction is imposed. Price basis, locality, and at least
one image are required on creation and on non-status-only edits (merged with
existing metadata for partial edits). Description and cost notes stay optional.
Legacy listings remain readable, and a PATCH containing only `status` bypasses
these three new required fields. No legacy metadata is filled automatically.
Images count only after upload succeeds; existing URLs also count. Uploads still
run on save through the existing storage API. Deleting the last image is rejected.
Room validation errors retain the existing `{ error: string }` response and add
`fieldErrors: { [fieldName]: string }` with Thai messages for inline form feedback.
Occupancy conflicts use status 409 and `fieldErrors.capacity`; general failures
remain form-level errors. Uploaded image ownership is still checked by the API.
The listing form validates an individual field on blur without moving focus;
fields that have shown an error are revalidated on change, clearing their error
as soon as valid. Untouched fields stay quiet until submission. Required empty
values receive a required-field message; optional fields may remain empty.
Submission still validates all fields and focuses the first error. Zero and
fractional rent values are rejected with inline feedback. Storage remains whole
baht in the existing INTEGER column; no migration or legacy data rewrite is performed.

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
