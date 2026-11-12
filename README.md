# ROOMMATCH

เว็บแอปสำหรับนักศึกษาที่ต้องการ **หาห้องพักและหาเพื่อนร่วมห้อง** เลือกได้ทั้ง
“หาห้องก่อน” และ “หาเพื่อนก่อน แล้วค่อยเลือกห้องด้วยกัน” ข้อมูลหลักบันทึกจริงผ่าน
API และ SQLite ไม่ใช่เพียงหน้าเว็บจำลอง

Repository: <https://github.com/VWINDQ/RoomMatch>

## เว็บทำอะไรได้บ้าง

| ส่วนของระบบ | สิ่งที่ผู้ใช้ทำได้ |
| --- | --- |
| บัญชี | สมัครสมาชิก เข้าสู่ระบบ และออกจากระบบ |
| โปรไฟล์ | แก้ไขข้อมูลส่วนตัว รูปแบบ URL คำแนะนำตัว และช่องทางติดต่อ |
| ไลฟ์สไตล์/ความต้องการ | ระบุไลฟ์สไตล์ งบ เพศและช่วงอายุที่ต้องการแชร์ห้อง |
| ค้นหาห้อง | ค้นหาชื่อ/รายละเอียด กรองราคาและสถานะ เรียงราคาหรือล่าสุด |
| รายละเอียดห้อง | ดูรูปภาพ ราคา แผนที่ ความจุ และจำนวนที่ว่าง |
| ประกาศของฉัน | สร้าง แก้ไข พัก/เปิด และลบประกาศของตัวเอง |
| คำขอเข้าพัก | ส่งคำขอ ติดตามสถานะ และอนุมัติ/ปฏิเสธคำขอสำหรับห้องของตัวเอง |
| เพื่อนร่วมห้อง | ดูแมตช์และสมาชิกหลังคำขอเข้าพักได้รับอนุมัติ |
| หาเพื่อนก่อนหาห้อง | ดูโปรไฟล์ ส่งคำชวน ตอบรับ/ปฏิเสธ และเริ่มค้นหาห้องด้วยกัน |

หน้าจอเป็น Claymorphism โทน navy/pastel ใช้ Fredoka และ Prompt
รองรับ desktop, tablet และ mobile

### เส้นทางการใช้งาน

**หาห้องก่อน:** สมัคร/เข้าสู่ระบบ → เติมโปรไฟล์ → ค้นหาห้อง → ส่งคำขอเข้าพัก
→ เจ้าของห้องอนุมัติ → เป็นสมาชิกและมีรายการแมตช์

**หาเพื่อนก่อน:** ดูโปรไฟล์ → ส่งคำชวน → อีกฝ่ายตอบรับ → เห็นช่องทางติดต่อ
→ กดค้นหาห้องด้วยกัน แต่ละคนยังต้องส่งคำขอและได้รับอนุมัติจากเจ้าของห้องเอง
การตอบรับเป็นเพื่อนไม่ได้จองห้องหรือเพิ่มสมาชิกห้องให้อัตโนมัติ

ผู้ใช้คนเดียวเป็นได้ทั้งผู้หาห้องและเจ้าของประกาศ ไม่ต้องแยกบัญชี
ความจุห้อง **นับรวมเจ้าของ** เช่น ห้องจุ 3 คน รับเพื่อนเพิ่มได้ 2 คน

## ติดตั้งและเปิดเว็บสำหรับเพื่อนร่วมทีม

ต้องมี Git, **Node.js 26.x** และ npm เพราะ backend ใช้ `node:sqlite`
ไม่ต้องติดตั้ง MySQL หรือเซิร์ฟเวอร์ฐานข้อมูลแยก

```bash
git clone https://github.com/VWINDQ/RoomMatch.git
cd RoomMatch
node --version
npm ci
```

ใช้ `npm ci` เพื่อให้ทีมได้ dependencies ตาม `package-lock.json` รุ่นเดียวกัน
สร้างไฟล์ตั้งค่าส่วนตัวครั้งแรกบน macOS/Linux:

```bash
cp -n .env.example .env
```

บน Windows PowerShell ใช้แทนคำสั่ง `cp`:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

สร้างคีย์สุ่ม แล้วคัดลอกผลไปใส่ `ROOMMATCH_TOKEN_SECRET` ใน `.env` ของตัวเอง:

```bash
node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('hex'))"
```

อย่าแชร์หรือ commit `.env` หากยังใช้ค่าตัวอย่าง ใน development ระบบจะใช้คีย์สุ่ม
ชั่วคราวและต้องล็อกอินใหม่เมื่อ API restart; production จะไม่เริ่มด้วยคีย์ที่ไม่ถูกต้อง

```bash
npm run dev
```

เปิด URL ที่ Vite แสดงใน Terminal ปกติคือ **http://localhost:5173**
API อยู่ที่ **http://127.0.0.1:3001** และ Vite ส่งคำขอ `/api` ไปให้ API
กด `Ctrl+C` เพื่อหยุด อย่าเปิด API ซ้ำหลายชุดบนพอร์ตเดียวกัน

ทดสอบหลักบน macOS; Windows ยังไม่ได้ทดสอบครบ หากตัวเปิดสอง process มีปัญหา
ให้เปิดสอง Terminal ในโฟลเดอร์โปรเจกต์ แล้วใช้ `npm run dev:api` กับ
`npm run dev:client` แยกกัน

### บัญชีเดโม

ฐานข้อมูลใหม่ใน development จะมีข้อมูลตัวอย่างให้ลอง:

| อีเมล | รหัสผ่าน |
| --- | --- |
| `phoom.s@mail.kmutt.ac.th` | `roommatch` |
| `beam@roommatch.test` | `roommatch123` |
| `chompoo@roommatch.test` | `roommatch123` |
| `dao@roommatch.test` | `roommatch123` |
| `earth@roommatch.test` | `roommatch123` |

นี่เป็นข้อมูลเดโมที่เปิดเผยสำหรับพัฒนา ไม่ใช่บัญชี production
หากใช้ฐานข้อมูลที่ไม่มีเดโม ให้กด **สมัครสมาชิก** สร้างบัญชีเอง
ทดลองสองบัญชีพร้อมกันด้วย browser คนละ profile หรือหน้าต่าง private
แท็บปกติใน browser profile เดียวกันใช้ token ใน localStorage ร่วมกัน

### ลองใช้งานตั้งแต่ต้นจนจบ

รายละเอียด API และ checklist งานขอเข้าพักของคนที่ 3:
[คู่มือฟีเจอร์ขอเข้าพัก](docs/REQUESTS.md)

รายละเอียด API และ checklist งานสมาชิกห้อง/แมตช์ของคนที่ 3:
[คู่มือสมาชิกห้องและแมตช์](docs/MATCHES.md)

รายละเอียด API และ checklist งานหาเพื่อนก่อนหาห้องของคนที่ 3:
[คู่มือหาเพื่อนและคำชวน](docs/FRIENDS.md)

1. บัญชี A เติมโปรไฟล์และลงประกาศห้องที่มีที่ว่าง
2. บัญชี B เปิดประกาศของ A แล้วกดขอเข้าพัก
3. บัญชี A เปิดหน้าคำขอเข้าพักและอนุมัติ
4. ทั้งสองบัญชีเปิดหน้าเพื่อนร่วมห้องเพื่อตรวจแมตช์
5. ทดลองหาเพื่อน: ส่งคำชวนจากบัญชีหนึ่ง แล้วตอบรับจากอีกบัญชี

## ทำงานร่วมกันผ่าน GitHub

เจ้าของ repository ต้องเชิญ GitHub account ของเพื่อนเป็น collaborator ที่มีสิทธิ์เขียน
และเพื่อนต้องตอบรับคำเชิญก่อนจึง push branch ได้ การเป็น public ทำให้ clone/read ได้
แต่ไม่ได้ให้ทุกคนแก้ repository โดยอัตโนมัติ

### เริ่มงานแต่ละครั้ง

ตรวจ `git status` และเก็บงานค้างให้เรียบร้อยก่อนเปลี่ยน branch หรือ pull:

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/profile-update
```

เปลี่ยน `feature/profile-update` เป็นชื่องานของตัวเอง ให้แต่ละคนใช้ branch แยก
แล้วส่ง Pull Request เข้า `main` ตกลงเจ้าของไฟล์เพื่อลด conflict โดยเฉพาะ
`src/styles.css`, `server/app.js` และ migrations

### ส่งงานให้ทีมตรวจ

```bash
npm test
npm run build
git status
git diff
git add src/pages/ProfilePage.tsx
git commit -m "Improve profile form validation"
git push -u origin feature/profile-update
```

เปลี่ยนตัวอย่าง `git add` เป็นไฟล์ที่แก้จริง จากนั้นเปิด **Pull Request** บน GitHub
ให้เพื่อน review/test ก่อน merge หลังทีม merge งานใหม่ ให้กลับ `main`, pull
และรัน `npm ci` เมื่อ lockfile เปลี่ยน ถ้า Git แจ้ง conflict หรือประวัติ diverge
ให้ตรวจร่วมกับทีม ห้าม force push หรือล้างงานเพื่อข้ามปัญหา

### ข้อมูลที่แชร์และไม่แชร์

- แชร์ source code, `package-lock.json`, migrations, seed และเอกสารผ่าน Git
- **แต่ละเครื่องมี SQLite ของตัวเอง** ข้อมูลในเครื่อง A ไม่ปรากฏในเครื่อง B
  เพียงเพราะ clone หรือ pull repository เดียวกัน
- หากต้องการข้อมูลร่วมกัน ต้องมี backend/ฐานข้อมูลกลางที่ตั้งค่าอย่างปลอดภัย
  ซึ่งยังไม่ได้ deploy ให้โดยการอัปโค้ดนี้
- ห้าม commit `.env`, คีย์/token, `.sqlite`/WAL, `node_modules` และ `dist`
- ไม่ลบฐานข้อมูลเพื่อแก้ setup โดยไม่สำรองข้อมูลก่อน
- เปลี่ยน schema ด้วย migration ไฟล์ใหม่ ไม่แก้ migration เก่าที่ทีมใช้แล้ว
- หากเพิ่ม dependency ให้ commit ทั้ง `package.json` และ `package-lock.json`

## โครงสร้างที่ทีมควรรู้

```text
src/pages/             หน้าจอหลัก
src/components/        UI ที่ใช้ร่วมกัน
src/lib/api.ts         การเรียก API และแปลงข้อมูล
src/AppContext.tsx     สถานะบัญชีผู้ใช้
src/App.tsx            routes และการป้องกันหน้าที่ต้องล็อกอิน
src/styles.css         ดีไซน์และ responsive
server/app.js          HTTP API และ business logic ของห้อง
server/friends.js      คำชวนหาเพื่อน
server/auth.js         password hash และ token
server/database.js     เปิด SQLite, migrations และ seed
server/index.mjs       จุดเริ่มต้น API
database/migrations/   schema และข้อบังคับของข้อมูล
database/seed.sql      ข้อมูลเดโม
tests/                 regression/integration tests
scripts/dev.mjs        ตัวเปิด frontend และ API
docs/                  architecture, friend workflow และ audit
```

## แก้ปัญหาเบื้องต้น

| อาการ | สิ่งที่ควรตรวจ |
| --- | --- |
| `npm run dev` ไม่ทำงาน | อยู่ในโฟลเดอร์ที่มี `package.json`, ใช้ Node 26 และรัน `npm ci` แล้ว |
| ไม่พบ `node:sqlite` | ตรวจ `node --version` แล้วใช้ Node 26.x |
| เว็บเปิดได้แต่โหลดข้อมูล/ล็อกอินไม่ได้ | ต้องเปิด API ด้วย ไม่ใช่เปิดเฉพาะ Vite หรือไฟล์ HTML |
| `EADDRINUSE` | หยุด API ที่เปิดซ้ำ หรือเปลี่ยน `ROOMMATCH_PORT` ใน `.env` แล้ว restart dev ทั้งชุด |
| URL ไม่ใช่ 5173 | ใช้ URL ที่ Vite พิมพ์จริง พอร์ตเดิมอาจถูกใช้อยู่ |
| เดโมล็อกอินไม่ได้ | ตรวจว่าเป็น development DB ที่มี seed หรือสมัครบัญชีใหม่ |
| ต้องล็อกอินใหม่หลัง restart API | ตั้ง secret สุ่มแบบคงที่ใน `.env` ของเครื่องตัวเอง |
| เพื่อน pull แล้วไม่เห็นข้อมูลที่สร้าง | SQLite เป็นคนละไฟล์ในแต่ละเครื่อง ไม่ใช่ฐานข้อมูลร่วม |

## สิ่งที่ยังไม่มี / ก่อนเปิดใช้งานจริง

- ยังไม่มี Like/Pass หรือ mutual-like matching ปัจจุบันใช้คำชวนแล้วตอบรับ
- ยังไม่มีแชต การจองห้องเป็นกลุ่ม หรืออัปโหลดไฟล์รูปโดยตรง รูปใช้ URL
- Favorites, tags และ amenities ยังไม่ใช่ฟีเจอร์ที่บันทึกได้ใน ER ปัจจุบัน
- ยังไม่มี rate limiting, server-side token revocation และ pagination
- Logout ล้าง session ฝั่ง browser แต่ token ที่คัดลอกไปยังใช้ได้จนหมดอายุ
- ก่อน public deployment ต้องตั้ง `NODE_ENV=production`, secret ที่ปลอดภัย,
  HTTPS และฐานข้อมูลใหม่ที่ไม่มีเดโม พร้อมจัดการข้อจำกัดใน [Audit](docs/AUDIT.md)
- ยังไม่มี lint script; ใช้ `npm test`, `npm run build` และทดสอบจริงใน browser

**การ push ขึ้น GitHub คือการแชร์โค้ด ไม่ได้ทำให้เว็บ Node.js/SQLite ออนไลน์ทันที**
GitHub Pages อย่างเดียวไม่สามารถรัน backend ของโปรเจกต์นี้ได้

## Technical reference (English)

ROOMMATCH is a student roommate and room-listing application built with React,
TypeScript, Vite, Node.js, and SQLite. The existing Claymorphism interface is
backed by a real API for accounts, profiles, preferences, rooms, join requests,
memberships, and matches.

## Requirements

- macOS
- Node.js 26 (the backend uses the built-in `node:sqlite` module)
- npm

## Run locally on macOS

From Terminal:

```bash
cd RoomMatch
node --version
npm ci
cp -n .env.example .env
npm run dev
```

Use Node.js `v26.x`. Before using anything beyond local development, replace
`ROOMMATCH_TOKEN_SECRET` in `.env` with a random value of at least 32 characters.
The example value is never used for signing: local development falls back to an
ephemeral key (sessions expire on server restart), and `NODE_ENV=production`
refuses to start with a missing, short, or example key. `npm run dev`
starts the API on `http://127.0.0.1:3001` and Vite on the URL printed in the
terminal, normally `http://localhost:5173`. Vite proxies `/api` to the API.

The SQLite file is created at `database/roommatch.sqlite` by default. On the
first empty database start, migrations run in numeric order and realistic demo
data is loaded automatically in development only. Production does not seed demo
accounts; existing demo accounts are not automatically removed, so use a fresh
production database. To use a different location, change
`ROOMMATCH_DB_PATH` in `.env`.

Useful commands:

```bash
npm run dev          # frontend and API together
npm run dev:client   # Vite only
npm run dev:api      # API only
npm run build        # type-check and build the frontend into dist/
npm test             # database and end-to-end API tests
npm start            # API plus the built frontend from dist/
```

For a production-style local run, build first and then start the Node server:

```bash
npm run build
npm start
```

## Demo login

- Email: `phoom.s@mail.kmutt.ac.th`
- Password: `roommatch`

Four additional seeded accounts use the password `roommatch123`; their email
addresses are listed in [`database/README.md`](database/README.md).

## Main workflows

Profile saves include lifestyle and preferences in a single transaction through
`PATCH /api/profile` (optional `lifestyleName` and `preference` fields). Existing
standalone lifestyle/preference endpoints remain supported.

See [the post-implementation audit](docs/AUDIT.md) for tested flows and remaining
limitations. Friend invitations are not a Like/Pass or mutual-like system.

- Find friends before choosing a room at `/friends`: browse profiles, send an
  invitation, accept/decline incoming invitations, and share contact details
  only after acceptance. Accepted friends can continue to room search together.
- Register, sign in, and restore the authenticated user.
- View and edit profile, lifestyle, and roommate preference data.
- Browse, search, sort, and filter rooms; view room details and ordered images.
- Create, edit, and delete owned room listings.
- Request to join an available room and view sent-request status.
- Review requests as the owner and approve or reject them.
- On approval, create membership and match records atomically.
- View room members and matches involving the authenticated user.

## ER model

The original room workflow retains its eight ER tables unchanged:

1. `USER`
2. `LIFESTYLE`
3. `PREFERENCE`
4. `ROOM`
5. `ROOM_IMAGE`
6. `ROOM_MEMBER`
7. `ROOM_REQUEST`
8. `MATCHES`

The user-requested people-first feature adds a ninth, independent table,
`FRIEND_CONNECTION`, through migration `003`. It links a sender and recipient
to `USER` and stores `pending`, `accepted`, or `declined` invitations, with one
record per unordered user pair. It does not change existing rows, columns,
room memberships, or room-based `MATCHES`. See [friend extension](docs/FRIENDS.md).

The implemented relationships are:

- `USER 1:1 LIFESTYLE` through unique `LIFESTYLE.user_id`.
- `USER 1:1 PREFERENCE` through unique `PREFERENCE.user_id`.
- `USER 1:N ROOM` through `ROOM.owner_id`.
- `ROOM 1:N ROOM_IMAGE` through `ROOM_IMAGE.room_id` and per-room image order.
- `USER M:N ROOM` through `ROOM_MEMBER`, whose primary key is
  `(user_id, room_id)`.
- `USER M:N ROOM` request history through `ROOM_REQUEST`.
- `MATCHES` connects an owner (`initiator_user_id`), approved member
  (`completer_user_id`), and room.

The source ER diagram defines lifestyle as 1:1. Consequently, each lifestyle
row belongs to only one user; it is not a reusable category. A reusable
lifestyle catalogue would require an explicit ER change and a junction table.
Amenities and favorites are not persisted because they are absent from this ER.

The diagram has no room-title attribute. ROOMMATCH stores the display title as
the first line of `ROOM.description` and the description body on following
lines, preserving all eight ER entities without inventing another column.

## Capacity and approval rules

Room capacity includes the owner. The owner exists only in `ROOM.owner_id`, not
in `ROOM_MEMBER`, so available places are:

```text
capacity - 1 - approved member count
```

The approval API checks ownership, room activity, duplicates, self-matches, and
remaining capacity. It then updates the request, inserts `ROOM_MEMBER`, and
inserts `MATCHES` in one SQLite transaction. Database constraints and triggers
also reject self-requests, duplicate pending requests, membership without an
approved request, capacity overflow, invalid request transitions, and invalid
matches. Reaching capacity marks the room `full`.

## Database and tests

- Schema migrations: `database/migrations/001_initial_schema.sql` and the
  legacy seed repair in `database/migrations/002_repair_room_description_newlines.sql`
- Development seed: `database/seed.sql`
- Database invariants: [`database/README.md`](database/README.md)
- Architecture/API contract: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

Run all automated checks with:

```bash
npm test
npm run build
```

The tests use isolated in-memory and temporary on-disk databases. The end-to-end test starts the API
on an ephemeral localhost port and covers registration, room creation and
browsing, self-request rejection, join request approval, full-room protection,
membership, matching, and request rejection.
