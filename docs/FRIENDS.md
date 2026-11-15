# Find a friend before choosing a room

## เชื่อมงานกับทีม — RM-24

การเป็นเพื่อนใช้ `FRIEND_CONNECTION` และแยกจาก [คำขอเข้าพัก](REQUESTS.md)
กับ [สมาชิก/room match](MATCHES.md) ไม่ต้องมี roomId ตอนส่งคำชวน และการตอบรับไม่จองห้อง
แต่ละคนยังต้องส่งคำขอเข้าพักเองและได้รับอนุมัติจากเจ้าของห้อง

ใช้ adapter เดิม `api.friends(query)`, `friendConnections()`, `inviteFriend(userId)`,
`decideFriend(connectionId, status)`, `cancelFriendInvitation(connectionId)`
โดย API รับ recipientId เป็น number; adapter แปลง string ID ของ frontend ให้แล้ว
ชื่อ route ของ UI คือ `/friends` ไม่ใช่ `/matches`

| สถานะ | ผู้ทำรายการต่อได้ | การเปิดข้อมูลติดต่อ |
| --- | --- | --- |
| `pending` | ผู้รับ accepted/declined; ผู้ส่ง cancelled | ไม่มีข้อมูลติดต่อใน person ของทั้งสองฝ่าย |
| `accepted` | ค้นหาห้องด้วยกัน; ยังไม่มี unfriend | ทั้งสองฝ่ายเห็น LINE, Instagram, email, phone ที่กรอกไว้ |
| `declined` | ดูประวัติ ไม่ส่งซ้ำ/เปลี่ยนผล | ไม่มีข้อมูลติดต่อ |
| `cancelled` | ผู้ส่งถอนซ้ำแบบ idempotent ได้ แต่ไม่ส่งคำชวนใหม่ | ไม่มีข้อมูลติดต่อ |

คนนอกไม่เห็น connection ของคู่อื่น แม้แนบ userId ใน query และโปรไฟล์สาธารณะไม่มี contact
เมื่อคู่ inactive API จะไม่คืนคู่นั้นใน connections; หลังโหลดใหม่ UI ต้องไม่ใช้ contact ที่ cache ไว้
ข้อจำกัดปัจจุบันไม่มี Like/Pass, mutual-like อัตโนมัติ, unfriend, ส่งซ้ำหลัง declined/cancelled
หรือการสมัครห้องแบบกลุ่ม (อย่าใช้ POST สวนทางแทนการตอบรับ ต้อง PATCH โดยผู้รับ)

### ตัวอย่างเรียก API

ใช้ [Curl setup](REQUESTS.md#curl-setup) และเพิ่ม RM_SENDER_TOKEN, RM_RECIPIENT_TOKEN
จาก login ของผู้ส่ง/ผู้รับ, RM_RECIPIENT_ID เป็น userId **ตัวเลข** ของผู้รับ และ
RM_CONNECTION_ID จากผลส่งคำชวน ไม่ใช้ requestId ของคำขอห้อง

```bash
curl -sS -X POST "$RM_API/friends/connections" \
  -H "Authorization: Bearer $RM_SENDER_TOKEN" -H 'Content-Type: application/json' \
  --data "{\"recipientId\":$RM_RECIPIENT_ID}"
```

ตัวอย่าง `201` ก่อนตอบรับ (ไม่มี contact keys ใน person):

```json
{
  "connection": {
    "connectionId": 5, "direction": "outgoing", "status": "pending",
    "createdAt": "2026-11-15T10:00:00.000Z", "respondedAt": null,
    "person": {
      "userId": 2, "firstName": "บี", "lastName": "ทดสอบ", "university": null,
      "bio": null, "profileImage": null, "lifestyle": null, "budgetMin": null, "budgetMax": null
    }
  }
}
```

ผู้รับอ่านรายการและตอบรับด้วย token ของตน:

```bash
curl -sS "$RM_API/friends/connections" -H "Authorization: Bearer $RM_RECIPIENT_TOKEN"
```

```bash
curl -sS -X PATCH "$RM_API/friends/connections/$RM_CONNECTION_ID" \
  -H "Authorization: Bearer $RM_RECIPIENT_TOKEN" -H 'Content-Type: application/json' \
  --data '{"status":"accepted"}'
```

ผล `200 { connection }` เป็น incoming, accepted พร้อม respondedAt
และ `person` เป็นโปรไฟล์ผู้ส่งพร้อม contact keys ของผู้ส่ง ไม่ใช่ข้อมูลของผู้รับเอง
หากปฏิเสธใช้ `declined` และไม่มี contact keys ส่วนผู้ส่งถอน pending ด้วยคำสั่งนี้แทน:

```bash
curl -sS -X POST "$RM_API/friends/connections/$RM_CONNECTION_ID/cancel" \
  -H "Authorization: Bearer $RM_SENDER_TOKEN"
```

คำสั่งถอนเป็นอีกทางเลือกก่อนผู้รับตัดสินใจ ไม่ใช้หลัง accepted/declined เพราะจะได้ 409
หลังตอบรับจึงใช้ `/rooms?withFriend=<userId อีกฝ่าย>`; server ตรวจความเป็นเพื่อนและที่ว่าง
หากบุคคลนั้นอยู่ห้องแล้วจะไม่คิดที่ว่างซ้ำ ดูกฎห้องใน [UX_FIXES.md](UX_FIXES.md)

## Preservation decision

The user requested an additional people-first page without altering good existing
data. Instead of relaxing/rebuilding `MATCHES` or rewriting its membership triggers,
migration `003_friend_connections.sql` adds `FRIEND_CONNECTION` only. The original
eight ER tables, room-based matches, capacity rules, and owner approval flow remain
unchanged by that migration. It adds the ninth business entity; the separately
merged Favorites migration adds `ROOM_FAVORITE`, so the current database has ten
business tables. The internal migration ledger is not another business entity.

`USER 1:N FRIEND_CONNECTION` has two roles: sender and recipient. No room is required.
An unordered user pair has one invitation; self-invitations and duplicate reversed
invitations are forbidden. Status starts `pending`; only the recipient can move it
to `accepted` or `declined`. Migration `006` also permits the sender to withdraw a
pending invitation as `cancelled`. All three final states remain in history and
cannot be reversed or re-sent in this version. Several accepted connections are
allowed; acceptance is not exclusive.

## API

- `GET /api/friends?q=...`: authenticated discovery by name, university, bio, or
  lifestyle. Excludes self, inactive users, and users already connected by an invitation.
  Full first-and-last-name searches are supported, including Thai names.
- `GET /api/friends/connections`: only the viewer's connections, with incoming/outgoing direction.
- `POST /api/friends/connections` with numeric `recipientId`: sends a pending invitation.
- `PATCH /api/friends/connections/:id` with `status: accepted | declined`: recipient-only decision.
- `POST /api/friends/connections/:id/cancel`: sender-only withdrawal of a pending
  invitation, with no request body required. Returns `{ connection }` with status
  `cancelled` and its withdrawal time in `respondedAt`. Retrying an already
  cancelled invitation returns the same result/time. An accepted or declined
  invitation returns `409`; withdrawal never ends an accepted friendship.

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

Pending outgoing cards and their profile dialogs offer **ถอนคำชวน**. Confirmation
explains that history is retained and this pair cannot be invited again under the
existing uniqueness rule. Closing confirmation from a profile returns to that
profile. Success opens invitation history with focus on its selected filter;
sender/recipient history labels distinguish who withdrew and show the withdrawal
time. Cancelled invitations do not show contact controls or recipient decisions.
Failed requests keep confirmation open for retry. A `409` reloads connection state
and disables withdrawal if the recipient has already decided, preserving consent.

This handoff is not a group reservation or a new room membership. Both people still
discuss budget and available places, then follow the existing individual join-request
and owner-approval workflow. No invitation inserts into `ROOM_MEMBER` or `MATCHES`.

## Verification

`tests/friends.test.mjs` snapshots every original table's schema and rows before/after
the additive migration. It also tests invitation → acceptance, contact privacy,
self/duplicate prevention, recipient authorization, final status transitions, declined
invitations, and unchanged room/membership/match rows.

## งานคนที่ 3 — ฟีเจอร์หาเพื่อนก่อนหาห้อง

รอบนี้ต่อยอด `server/friends.js` เดิม ไม่เขียนระบบใหม่ ไม่เปลี่ยน schema,
URL/ชื่อฟิลด์ API หรือ frontend ของเพื่อน และไม่เพิ่ม Like/Pass หรือการจองแบบกลุ่ม

### สิ่งที่ปรับ

- ค้นชื่อเต็ม เช่น `สมชาย ใจดี` ได้ นอกเหนือจากชื่อ นามสกุล มหาวิทยาลัย bio และไลฟ์สไตล์
- คำค้นว่างแสดงคนที่ยังทำความรู้จักได้ ไม่แสดงตัวเองหรือบัญชี inactive
- อักขระ `%`, `_`, `\` เป็นข้อความค้นหาจริง ไม่ใช่ wildcard ที่ขยายผลเอง
- ตรวจ `connectionId` ให้เป็นจำนวนเต็มบวกในช่วงที่ JavaScript เก็บได้อย่างถูกต้อง
- การส่งคำชวนและการตอบรับ/ปฏิเสธใช้ transaction เดียวกัน ตั้งแต่ตรวจบัญชี/คู่ซ้ำ
  จนถึงอ่านโปรไฟล์สำหรับ response แล้วจึง commit
- ถ้าเขียนฐานข้อมูลหรืออ่านโปรไฟล์หลังเขียนไม่สำเร็จ จะ rollback ทั้งแถวคำชวน
  สถานะ และเวลาตอบ ไม่เกิดกรณี API ตอบ error แต่ข้อมูลตอบรับถูกบันทึกไปแล้ว
- ป้องกันคำชวนซ้ำ/ส่งสวนทาง และการตอบพร้อมกัน โดยมี constraints เดิมช่วยบังคับ

### ข้อมูลและสิทธิ์

- `GET /api/friends` คืน `{ people: [...] }` พร้อมข้อมูลสาธารณะและงบประมาณ
  ไม่คืน email, phone, LINE, Instagram, วันเกิด หรือ password hash
- `GET /api/friends/connections` คืนเฉพาะคู่ของบัญชีที่ล็อกอิน พร้อม direction
  `incoming`/`outgoing` การระบุ `userId` ใน query ไม่ทำให้ดูคู่ของคนอื่นได้
- `POST /api/friends/connections` ใช้ body `{ "recipientId": 2 }` โดยต้องเป็น number
  ผู้ส่งยึดจาก token ไม่ใช่ค่าจาก client สถานะเริ่มต้น `pending`
- `PATCH /api/friends/connections/:id` ใช้ body `{ "status": "accepted" }`
  หรือ `{ "status": "declined" }` มีเฉพาะผู้รับที่ตอบได้
- ข้อมูลติดต่อเพิ่มใน `connection.person` เฉพาะสถานะ `accepted` ของสองคนในคู่นั้น
  คนที่สามค้นโปรไฟล์เดียวกันก็ยังไม่เห็นข้อมูลติดต่อ
- คู่ที่มีบัญชี inactive จะไม่แสดงในรายการ connections รวมถึงคู่ที่เคยตอบรับ
  ข้อมูลประวัติยังคงเก็บไว้ และบัญชี inactive ใช้ API เหล่านี้ไม่ได้
- ถอนคำชวนได้ผ่าน `POST /api/friends/connections/:id/cancel` เฉพาะผู้ส่งและสถานะ
  `pending` ประวัติและเวลาถอนเก็บในแถวเดิม ไม่มีการแชร์ช่องทางติดต่อจากคำชวนที่ถอน
- ยังไม่รองรับส่งคำชวนซ้ำหลังปฏิเสธ/ถอน เปลี่ยนคำตอบ หรือเลิกเป็นเพื่อน
- เป็นเพื่อนกับหลายคนได้ การตอบรับไม่เพิ่มข้อมูลใน ROOM/ROOM_MEMBER/MATCHES

### Error contract

ทุก error เป็น `{ "error": "ข้อความ" }`:

- `400`: คำค้นเกิน 100 ตัวอักษร, recipientId/connectionId ไม่ถูกต้อง, ส่งหาตัวเอง,
  JSON ไม่ถูกต้อง หรือ status ไม่ใช่ accepted/declined
- `401`: token/บัญชีใช้เข้าสู่ระบบไม่ได้
- `403`: ผู้ตอบไม่ใช่ผู้รับคำชวน หรือผู้ถอนคำชวนไม่ใช่ผู้ส่ง
- `404`: ไม่พบผู้รับที่ยังใช้งาน หรือไม่พบคำชวน
- `409`: คู่ซ้ำ/กลับด้าน คู่ถูกตอบไปแล้ว หรือผู้ส่งคำชวน inactive
- `500`: ข้อผิดพลาดฐานข้อมูลที่ไม่คาดคิด ไม่ส่ง stack trace/SQL กลับ client

## Withdrawal verification

`tests/friend-cancellation-api.test.mjs` exercises the running HTTP server for
sender authorization, invalid IDs, missing/empty records, privacy, idempotent
retries, accepted/declined conflicts, competing decisions, database/read failures
with rollback, and persistence after restarting with the same SQLite database.
Existing room records and Favorites are not changed by withdrawal.

UI verification used an isolated QA database at desktop 1440×900, tablet
820×1000 and mobile 320×740 / 390×844. Tested profile → confirmation → keep
invitation, successful withdrawal and history after nested-route refresh, sender
and recipient history labels, hidden contacts, keyboard Tab/Escape and restored
focus, database failure with retry, disabled buttons during a delayed request,
and acceptance from a second account while confirmation was open. The accepted
friendship remained intact. Final checks: `npm test` (106 passed),
`npm run build`, and `git diff --check`.

### วิธีตรวจงาน

ผลตรวจรับ 3 บัญชีครบ pending/accepted/declined/cancelled, สิทธิ์ผู้ส่ง/ผู้รับ/คนนอก,
ความเป็นส่วนตัว, failure/rollback และ restart พร้อมขั้นตอนทดสอบซ้ำ:
[RM-17 acceptance](RM17_ACCEPTANCE.md)

```bash
node --test tests/friends.test.mjs tests/friend-discovery.test.mjs tests/friend-cancellation-api.test.mjs
npm test
npm run build
```

Tests ใหม่อยู่ใน `tests/friend-discovery.test.mjs` เปิด HTTP server จริงบนพอร์ตสุ่ม
ใช้ SQLite แยกจากข้อมูลส่วนตัว ครอบคลุม normal/invalid/empty/failure/persistence,
ความเป็นส่วนตัวก่อน/หลังตอบรับและคนนอก, คำชวนซ้ำ, คำขอพร้อมกัน,
บัญชี inactive, read/write failure, rollback และเปิด API ใหม่กับฐานข้อมูลเดิม
การทดสอบ concurrency เป็นคำขอพร้อมกันใน Node process เดียว ไม่ใช่ load test หลายเครื่อง

ก่อน commit ให้ลอง UI บน desktop/mobile:

1. A ค้นชื่อเต็มของ B และดูโปรไฟล์ ต้องไม่เห็นช่องทางติดต่อ
2. A ส่งคำชวน แล้ว refresh ต้องมีคำชวน outgoing ของ A และ incoming ของ B
3. B ตอบรับ ทั้ง A/B ต้องเห็นเพื่อนและช่องทางติดต่อ แต่บัญชี C ต้องไม่เห็นข้อมูลติดต่อ
4. ทดลองปฏิเสธกับอีกคู่ ต้องไม่เปิดข้อมูลติดต่อหรือเปลี่ยนสมาชิกห้อง
5. กดค้นหาห้องด้วยกัน ต้องเปิดบริบทเพื่อนที่ตอบรับ ไม่ใช่เพิ่มสมาชิก/จองห้องอัตโนมัติ

Checklist ข้างต้นตรวจผ่าน browser ด้วย 3 บัญชีแล้วใน [RM-17 acceptance](RM17_ACCEPTANCE.md)
รายงานแยกเคสที่กดผ่าน UI ออกจากสิทธิ์/input/failure ที่ตรวจด้วย HTTP tests ไว้ชัดเจน


### RM-18: สถานะคำชวนเปลี่ยนระหว่างใช้งาน

เมื่อส่ง/ตอบคำชวนแล้ว API ตอบ 409 หน้าหาเพื่อนจะอ่านรายการความสัมพันธ์ล่าสุด
เปลี่ยนปุ่มในโปรไฟล์ให้ตรงสถานะ และเอาคนที่มีคำชวนแล้วออกจากรายการคนใหม่
โดยไม่แจ้งว่าส่ง/ตอบรับสำเร็จหากคำสั่งนั้นล้มเหลว ช่องทางติดต่อยังใช้ข้อมูลที่ API
อนุญาตหลังตอบรับเท่านั้น คำชวนถูกถอน/ปฏิเสธไม่เปิดช่องทางติดต่อ

หากโหลดสถานะล่าสุดไม่ได้ ปิดปุ่มส่ง/ตอบคำชวนและแสดงปุ่มอัปเดตในหน้าต่างโปรไฟล์
เมื่อโหลดใหม่สำเร็จจึงเปิดปุ่มตามสถานะจริงและล้างข้อความผิดพลาดเดิม
ข้อผิดพลาดรับ keyboard focus เพื่อให้ผู้ใช้ทราบผลโดยไม่ต้องค้นหาข้อความเอง

ตรวจ UI ด้วยบัญชี QA แยก: คำชวนสวนทางซ้ำ, ถอนก่อนผู้รับตอบ,
ตอบรับจากอีกหน้าแล้วกดซ้ำ, GET สถานะ 503 และลองใหม่ พร้อมตรวจข้อมูลติดต่อ
ก่อน/หลังตอบรับและการจัดวางบน desktop/mobile ไม่มีการเพิ่มตารางหรือแก้ข้อมูลเดิม
