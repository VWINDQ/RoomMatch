# Find a friend before choosing a room

## Preservation decision

The user requested an additional people-first page without altering good existing
data. Instead of relaxing/rebuilding `MATCHES` or rewriting its membership triggers,
migration `003_friend_connections.sql` adds `FRIEND_CONNECTION` only. The original
eight ER tables, room-based matches, capacity rules, and owner approval flow remain
unchanged. The extended ER therefore has nine entities, not eight.

`USER 1:N FRIEND_CONNECTION` has two roles: sender and recipient. No room is required.
An unordered user pair has one invitation; self-invitations and duplicate reversed
invitations are forbidden. Status starts `pending`; only the recipient can move it
to `accepted` or `declined`. Final decisions cannot be reversed or re-sent in this
version. Several accepted connections are allowed; acceptance is not exclusive.

## API

- `GET /api/friends?q=...`: authenticated discovery by name, university, bio, or
  lifestyle. Excludes self, inactive users, and users already connected by an invitation.
- `GET /api/friends/connections`: only the viewer's connections, with incoming/outgoing direction.
- `POST /api/friends/connections` with numeric `recipientId`: sends a pending invitation.
- `PATCH /api/friends/connections/:id` with `status: accepted | declined`: recipient-only decision.

Discovery exposes name, university, bio, profile image, lifestyle, and stated budget.
It does not expose exact birth dates, passwords, email, phone, LINE, or Instagram.
Contact fields become available to the two participants only after acceptance.
There is no fabricated compatibility score or automatic acceptance.

## UI and room handoff

`/friends` has three sections: discovery, invitations, and accepted friends. It
includes full-profile viewing, search, loading/empty/error states, and responsive
navigation. A matched friend can open `/rooms?withFriend=<userId>`; room browsing
then shows the validated accepted partner as context. Normal room search remains
unchanged when this query parameter is absent.

This handoff is not a group reservation or a new room membership. Both people still
discuss budget and available places, then follow the existing individual join-request
and owner-approval workflow. No invitation inserts into `ROOM_MEMBER` or `MATCHES`.

## Verification

`tests/friends.test.mjs` snapshots every original table's schema and rows before/after
the additive migration. It also tests invitation → acceptance, contact privacy,
self/duplicate prevention, recipient authorization, final status transitions, declined
invitations, and unchanged room/membership/match rows.
