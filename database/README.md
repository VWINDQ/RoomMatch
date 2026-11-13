# RoomMatch database

This directory contains the eight original ER entities, the separately requested
`FRIEND_CONNECTION` extension, and realistic local-development seed data.

## Files and order

1. Use the application's `runMigrations` runner (called automatically by `npm run dev` / `npm start`), which applies files in numeric order and records filenames. Do not repeatedly execute raw migration SQL: `ALTER TABLE` migrations are intentionally one-time changes. Migration `001` creates the
   schema; migration `002` repairs literal `\\n` title separators created by an
   early development seed without changing descriptions that already contain
   real line feeds.
   Migration `003` only adds friend invitations and their constraints/indexes;
   it does not update or rebuild any existing table.
   Migration `005` adds nullable listing metadata and the cancelled-request state while preserving rows. The internal `_roommatch_migrations` ledger also applies an earlier-numbered file arriving later, such as Favorites `004`, instead of skipping it because `user_version` is already 5. See [UX changes](../docs/UX_FIXES.md).
2. Run `seed.sql` when demo data is wanted. The seed uses stable IDs,
   conflict-safe inserts, and existence guards, so it can be applied repeatedly
   without duplicating rows or overwriting data changed during a local session.

Every SQLite connection must execute `PRAGMA foreign_keys = ON`; the migration
and seed do this for their own connection, but the pragma is connection-local.
The schema uses SQLite `STRICT` tables and therefore requires a modern SQLite
runtime. The project targets Node.js 26 and its built-in `node:sqlite` module.

## Tables and relationships

- `USER` owns rooms and is the parent of profile-related data.
- `LIFESTYLE.user_id` is a non-null, unique foreign key to `USER`.
- `PREFERENCE.user_id` is a non-null, unique foreign key to `USER`.
- `ROOM.owner_id` identifies its one owner. The owner is not duplicated in
  `ROOM_MEMBER`.
- `ROOM_IMAGE.room_id` owns ordered images; `(room_id, image_order)` is unique.
- `ROOM_MEMBER` is the user-room junction and has the composite primary key
  `(user_id, room_id)`.
- `ROOM_REQUEST` stores pending and final join decisions.
- `MATCHES` records the owner as `initiator_user_id`, the approved member as
  `completer_user_id`, and the room that brought them together.
- `FRIEND_CONNECTION.sender_id` and `recipient_id` reference `USER`. An unordered
  pair is unique; self-invitations are forbidden. Only a pending invitation can
  transition to accepted/declined, with a response timestamp.

Deleting a user or room cascades to dependent rows. Frequently queried foreign
keys, statuses, price, image order, and match roles are indexed. A partial unique
index allows historical rejected/approved requests while permitting only one
pending request for a user-room pair.

`ROOM.price_basis` is `per_room`, `per_person`, or NULL for unknown legacy data;
`locality` and `cost_notes` hold owner-provided location/cost information.
`ROOM_REQUEST.cancelled` records withdrawal with `responded_at`, preserving history.
`ROOM_MEMBER.left` releases capacity and revokes member/match visibility; reapproval
reactivates the existing member/match rows with fresh joining timestamps.

## ER conflict and consequence

The source diagram shows `SHARES` between `USER` and `LIFESTYLE` as 1:1. This
implementation follows it exactly: `LIFESTYLE.user_id` is unique, so each
lifestyle row belongs to one user and a row such as “ไม่สูบบุหรี่” cannot be
shared by multiple users. `lifestyle_name` therefore stores that user's combined
lifestyle description rather than a reusable catalogue item.

If product requirements later need reusable lifestyle categories, the ER model
must change to a category-style `LIFESTYLE` table plus a `USER_LIFESTYLE`
junction table. That category entity is deliberately not added here. Amenities and
favorites are likewise absent because they are not present in the current ER.

## Data invariants

- Room capacity includes the owner. Available member places are
  `capacity - 1 - approved member count`.
- Owners are represented by `ROOM.owner_id`, never by a `ROOM_MEMBER` row.
- Approved membership requires an approved request, and the capacity triggers
  prevent an insert, reactivation, or capacity reduction from overfilling a
  room.
- A request cannot target the requester's own room, an already joined room, or
  a non-available room. Only `pending` requests can transition to `approved` or
  `rejected`; final decisions cannot be changed.
- `responded_at` is null only for pending requests and required for final ones.
- A match cannot be a self-match. Its initiator must own the room and its
  completer must be an approved member of that room.
- Member changes and capacity changes keep an active room's status synchronized
  between `available` and `full`; `inactive` is never reactivated by a trigger.
- `USER.updated_at` is refreshed automatically when a user row changes.
- The first line of `ROOM.description` is the display title, matching the API
  presentation convention without adding an ER attribute.

Approval remains an application transaction: update `ROOM_REQUEST`, insert
`ROOM_MEMBER`, and insert `MATCHES` atomically. Database constraints and triggers
serve as a final integrity boundary for that workflow.

## Seed accounts

The primary login mirrors the current UI: `phoom.s@mail.kmutt.ac.th` with the
password `roommatch`. The other four accounts use `roommatch123`. Every seed
password uses the backend contract format
`scrypt$16384$8$1$<saltHex>$<64-byte-hashHex>`:

- `phoom.s@mail.kmutt.ac.th`
- `beam@roommatch.test`
- `chompoo@roommatch.test`
- `dao@roommatch.test`
- `earth@roommatch.test`

The seed covers one-to-one lifestyle and preference rows, available/full/inactive
rooms, ordered room images, approved members, pending/approved/rejected requests,
and completed matches.
