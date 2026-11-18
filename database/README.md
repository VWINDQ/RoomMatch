# RoomMatch database

This directory contains the eight original ER entities, the separately requested
`FRIEND_CONNECTION` and `ROOM_FAVORITE` extensions, and realistic local-development seed data.

## Current engine: PostgreSQL

Setup, safe SQLite import, environment variables, tests and deployment:
[PostgreSQL guide](POSTGRESQL.md).

- `postgresql/migrations/` is the active schema. The asynchronous application
  runner applies migrations atomically and verifies applied checksums.
- `postgresql/seed.sql` contains development demo data. The runner seeds only an
  empty USER table, so restarting preserves existing records.
- `migrations/` and `seed.sql` retain historical SQLite files unchanged. They are
  used by legacy tests/import fixtures, not the current server.
- PostgreSQL uses `"USER"` for the reserved entity name; other table names fold
  to lowercase. BIGINT identities replace SQLite row IDs. Event times use
  TIMESTAMPTZ, dates use DATE, and foreign keys are always enforced.

## Tables and relationships

- `USER` owns rooms and is the parent of profile-related data.
- `LIFESTYLE.user_id` is a non-null, unique foreign key to `USER`.
- `PREFERENCE.user_id` is a non-null, unique foreign key to `USER`.
- `ROOM.owner_id` identifies its one owner. The owner is not duplicated in
  `ROOM_MEMBER`.
- `ROOM_IMAGE.room_id` owns ordered images; `(room_id, image_order)` is unique.
- `ROOM_MEMBER` is the user-room junction and has the composite primary key
  `(user_id, room_id)`.
- `ROOM_FAVORITE` stores saved rooms with the composite primary key
  `(user_id, room_id)` and cascades when either parent is deleted.
- `ROOM_REQUEST` stores pending and final join decisions.
- `MATCHES` records the owner as `initiator_user_id`, the approved member as
  `completer_user_id`, and the room that brought them together.
- `FRIEND_CONNECTION.sender_id` and `recipient_id` reference `USER`. An unordered
  pair is unique; self-invitations are forbidden. Only a pending invitation can
  transition to accepted/declined/cancelled, with a response timestamp. Cancelled
  invitations remain in history and do not grant contact access. The existing
  one-invitation-per-pair rule is unchanged; this migration does not enable re-sending.

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
junction table. That category entity is deliberately not added here. Amenities
are not implemented in this schema. Favorites use the separately added
`ROOM_FAVORITE` junction table (migration 004).

## Data invariants

- Room capacity includes the owner. Available member places are
  `capacity - 1 - approved member count`.
- Owners are represented by `ROOM.owner_id`, never by a `ROOM_MEMBER` row.
- Approved membership requires an approved request, and the capacity triggers
  prevent an insert, reactivation, or capacity reduction from overfilling a
  room.
- A request cannot target the requester's own room, an already joined room, or
  a non-available room. Only `pending` requests can transition to `approved` or
  `rejected` or `cancelled`; final decisions cannot be changed.
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
