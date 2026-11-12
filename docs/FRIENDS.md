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
  Full first-and-last-name searches are supported, including Thai names.
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
- ยังไม่รองรับส่งคำชวนซ้ำหลังปฏิเสธ เปลี่ยนคำตอบ ถอนคำชวน หรือเลิกเป็นเพื่อน
  ซึ่งต้องตกลง flow/constraints ก่อนเพิ่มในอนาคต
- เป็นเพื่อนกับหลายคนได้ การตอบรับไม่เพิ่มข้อมูลใน ROOM/ROOM_MEMBER/MATCHES

### Error contract

ทุก error เป็น `{ "error": "ข้อความ" }`:

- `400`: คำค้นเกิน 100 ตัวอักษร, recipientId/connectionId ไม่ถูกต้อง, ส่งหาตัวเอง,
  JSON ไม่ถูกต้อง หรือ status ไม่ใช่ accepted/declined
- `401`: token/บัญชีใช้เข้าสู่ระบบไม่ได้
- `403`: ผู้ตอบไม่ใช่ผู้รับคำชวน
- `404`: ไม่พบผู้รับที่ยังใช้งาน หรือไม่พบคำชวน
- `409`: คู่ซ้ำ/กลับด้าน คู่ถูกตอบไปแล้ว หรือผู้ส่งคำชวน inactive
- `500`: ข้อผิดพลาดฐานข้อมูลที่ไม่คาดคิด ไม่ส่ง stack trace/SQL กลับ client

### วิธีตรวจงาน

```bash
node --test tests/friends.test.mjs tests/friend-discovery.test.mjs
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

รอบนี้ตรวจ HTTP API/tests/build ยังไม่ได้กด UI ตาม checklist ข้างต้น
และไม่มีการ stage, commit หรือ push ให้
