# ROOMMATCH: สิ่งที่ยังขาดก่อน production

ตรวจจาก branch `Poom` เมื่อ 2026-11-13 รวมงานอัปโหลดรูปใน working tree รอบนี้
รายงานนี้แยกข้อเท็จจริงจากโค้ดกับสิ่งที่ต้องตรวจในระบบ deploy ไม่ใช่ penetration test
หรือการรับรองว่าระบบไม่มีช่องโหว่ รายการเสนอแนะด้านล่างยังไม่ได้ถูก implement ยกเว้น upload ที่ระบุชัด

## ข้อสรุป

ระบบหลักพร้อมใช้เป็นโปรเจกต์และทดลองกับกลุ่มจำกัด มี API/SQLite จริงและทดสอบ business rules
แต่ยังมีช่องว่างด้านบัญชี การรับมือผู้ใช้ไม่ประสงค์ดี ข้อมูลสำรอง และการดูแลระบบ
ก่อนเปิดให้คนทั่วไปสมัครใช้งาน ควรปิดรายการ P0 และตรวจ hosting จริงก่อน
ไม่จำเป็นต้องเขียนใหม่ทั้งหมดหรือเปลี่ยน SQLite ทันที

## มีแล้ว — ไม่ต้องกลับไปทำซ้ำ

- สมัคร/เข้าสู่ระบบ, hash password ด้วย scrypt, token มีลายเซ็นและวันหมดอายุ
- ป้องกันใช้ signing secret ตัวอย่างใน production และไม่ seed demo อัตโนมัติเมื่อ `NODE_ENV=production`
- โปรไฟล์/ไลฟ์สไตล์/preferences, บันทึก bundle ใน transaction
- ห้อง create/edit/pause/delete, ค้นหา/กรองราคา/เรียง, public browse UI ซ่อนห้องเต็ม
- คำขอเข้าพัก, เจ้าของตัดสินใจ, ตรวจที่ว่าง, ยืนยันก่อนอนุมัติ/ปฏิเสธ และดูโปรไฟล์ผู้ขอ
- การอนุมัติสร้าง membership/match ใน transaction พร้อม constraint/trigger และ concurrency tests
- จำกัดสิทธิ์อ่านสมาชิกและข้อมูลติดต่อ, หาเพื่อน/ส่งคำชวน/รับ/ปฏิเสธ/ดูรายชื่อเพื่อน
- จุดคำขอ pending ตรวจทุก 30 วินาที; loading/empty/error/retry หลายหน้ามีแล้ว
- อัปโหลดรูปจากเครื่อง, ตรวจ/แปลงไฟล์, local storage, โควตาและ rate limit เฉพาะ upload
- parameterized SQL, foreign keys/indexes/migrations, generic server errors, JSON body limit 1 MiB
- tests 68 ข้อผ่าน และ build ผ่านในรอบงานนี้; browser QA upload ที่ 1366/1024/390/320px

## P0 — ก่อนเปิดสมัครใช้งานสาธารณะ

### 1. บัญชีและ session

- [ ] เพิ่ม rate limit ที่ login/register และ abuse limit ของ write APIs ไม่ใช่เฉพาะ upload
- [ ] เพิ่ม server-side logout/revocation: ปัจจุบัน logout แค่ลบ token จาก localStorage
      token ที่ถูกคัดลอกยังใช้ได้จนหมดอายุ 7 วันหรือบัญชีถูกปิด
- [ ] ออกแบบ session expiration/rotation และ revoke หลังเปลี่ยนรหัสผ่านหรือเหตุผิดปกติ
- [ ] เพิ่มเปลี่ยนรหัสผ่านและลืมรหัสผ่าน พร้อม token แบบใช้ครั้งเดียว/หมดอายุ/ไม่เก็บ plaintext
- [ ] ยืนยันอีเมลและกำหนดเงื่อนไขบัญชีนักศึกษา หากจะอ้างว่าสมาชิกเป็นนักศึกษาที่ตรวจสอบแล้ว
- [ ] ตรวจ password policy, common/breached-password screening และ sign-in timing/account enumeration
- [ ] ทบทวนที่เก็บ token: localStorage ถูกอ่านได้โดย JavaScript พิจารณา session cookie แบบ
      HttpOnly/Secure/SameSite พร้อม CSRF protection เมื่อเปลี่ยนไปใช้ cookie authentication
- [ ] benchmark และเพิ่ม password hashing cost/rehash ตอน login: ปัจจุบัน scrypt `N=16384,r=8,p=1`
      ต่ำกว่าค่าชุด `N=2^17,r=8,p=1` ที่ OWASP แนะนำ ควรปรับ memory limit และ load test ร่วมด้วย

อ้างอิง: [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html),
[Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
การย้ายไป cookie ต้องเป็นงานที่ตกลง API ร่วมกับคนที่ 1 ไม่ใช่เปลี่ยนเฉพาะ frontend

### 2. ข้อมูลไม่หายและกู้คืนได้

- [ ] เลือก hosting ที่มี persistent disk หรือ managed data services สำหรับ DB และ uploads
- [ ] แยก dev/staging/production, secret/DB/storage คนละชุด ไม่ใช้ DB demo เดิมเป็น DB จริง
- [ ] ตั้ง backup อัตโนมัติแบบรองรับ SQLite WAL ให้ข้อมูลและรูปสอดคล้องกัน
- [ ] เก็บ backup อีกระบบ/อีกพื้นที่พร้อม access control, encryption และ retention
- [ ] ทดลอง restore จน login/รูป/ห้อง/คำขอ/แมตช์ใช้งานได้ ไม่ใช่ตรวจเพียงว่าไฟล์ backup มีอยู่
- [ ] ตกลง RPO/RTO: ยอมเสียข้อมูลย้อนหลังเท่าไรและระบบล่มได้นานเท่าไร
- [ ] สำรองก่อน migration, ทดลองกับสำเนา DB, มีวิธี rollback release และรับมือ migration ล้มเหลว
- [ ] monitor พื้นที่ disk/backup failure และทดสอบกรณีเต็มหรือ filesystem เขียนไม่ได้

SQLite ใช้กับเว็บ production บางขนาดได้ เลือกเปลี่ยนเป็น PostgreSQL เมื่อมีความต้องการหลาย instance,
write concurrency หรือ operational requirements ที่ชัดเจน ต้องวัดก่อนตัดสินใจ
อ้างอิง [SQLite appropriate uses](https://www.sqlite.org/whentouse.html)
และ [Online Backup API](https://sqlite.org/backup.html)

### 3. การดูแลผู้ใช้และความเป็นส่วนตัว

- [ ] มีช่องทางรายงานบัญชี/ประกาศ/รูปไม่เหมาะสม และเจ้าหน้าที่ที่ตอบสนองได้จริง
- [ ] มี block/unfriend และเพิกถอนการแสดงข้อมูลติดต่อหลังความสัมพันธ์ยุติ
- [ ] มีเครื่องมือผู้ดูแลปิดบัญชี/ซ่อนประกาศ/จัดการรูป พร้อมสิทธิ์แยกจากบัญชีทั่วไปและ audit trail
- [ ] ทำ privacy notice/ขอบเขตใช้ข้อมูล/ระยะเก็บข้อมูล/ช่องทางติดต่อผู้ดูแล ให้ทีมตรวจข้อกฎหมายที่ใช้จริง
- [ ] ให้ผู้ใช้เข้าใจก่อนตอบรับว่าใครเห็นเบอร์/อีเมล/LINE/Instagram และเห็นข้อมูลใดบ้าง
- [ ] กำหนดวิธีแก้ไข ส่งออก ปิดบัญชี หรือลบข้อมูล และผลต่อ request/membership/match/history
- [ ] ตรวจข้อมูลที่ส่งให้ third-party analytics, image hosts, font providers และ logs; ไม่บันทึก token/password
- [ ] วางแผนจัดการบัญชี/ประกาศปลอมและการคุกคาม อย่าให้ UI อ้างว่า verify แล้วทั้งที่ยังไม่ได้ตรวจ

### 4. Deploy และ dependency

- [ ] ตั้งโดเมน/HTTPS/reverse proxy, จำกัดการเข้าถึง API host/DB/storage จากภายนอกตามที่จำเป็น
- [ ] ตรวจ CORS production allowlist: โค้ดยังยอม localhost/127.0.0.1 origin โดยอัตโนมัติ
- [ ] ตั้ง CSP/frame-ancestors, HSTS และ security headers สำหรับเว็บ/API ที่ layer ที่เหมาะสม
      มี `nosniff` สำหรับ static/upload แล้ว แต่ยังไม่ได้ยืนยัน headers จาก hosting จริง
- [ ] ตั้ง request/body/header timeout, edge upload limits และ abuse protection ให้ตรงกับ API
- [ ] จัดการ secrets ใน hosting พร้อม rotation, จำกัดสิทธิ์ไฟล์/บัญชีระบบ, ไม่ใส่ `.env` ใน Git
- [ ] แก้และประเมิน dependency advisories จาก `npm audit` วันที่ตรวจ: 3 dependency entries
      (moderate 1, high 2) ได้แก่ `postcss-selector-parser`, `source-map-js`, `vite`
      หลายรายการเกี่ยวกับ dev/build tooling ต้องแยก exposure จาก production runtime
- [ ] ทดลอง clean `npm ci` และ build บนระบบ deploy จริง รวม native dependency `sharp`
- [ ] ใช้ built app ใน production ไม่เปิด Vite dev server ให้สาธารณะ

รายละเอียด advisory จาก audit:
[selector parser](https://github.com/advisories/GHSA-rj75-hqrm-r3gf),
[source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q),
[ตัวอย่าง Vite advisory](https://github.com/advisories/GHSA-587h-7wmj-h5pm)
ไม่ได้รัน `npm audit fix` หรืออัปเกรดแพ็กเกจเดิมอัตโนมัติในงาน upload นี้

## P1 — ก่อนขยายจำนวนผู้ใช้/ทำให้ใช้งานต่อเนื่องได้ดี

### 5. กติกาห้องและคำขอ (ต้องตกลงกับทีม)

- [ ] ผู้ส่งยกเลิกคำขอ pending ได้ และกำหนดว่าเมื่อใดคำขอหมดอายุ
- [ ] กำหนดการจัดการคำขอที่เหลือเมื่อห้องเต็ม/พักประกาศ: คงค้าง, waitlist, หรือปิดคำขอพร้อมเหตุผล
- [ ] เพิ่มออกจากห้อง/นำสมาชิกออก พร้อมคืนที่ว่าง ปรับ match visibility และเก็บประวัติ
- [ ] ตกลงว่าผู้ใช้เป็น active member หลายห้องพร้อมกันได้หรือไม่; schema/API ปัจจุบันยังไม่จำกัดข้ามห้อง
- [ ] ตกลงการออกของเจ้าของห้อง/โอนเจ้าของ และการพัก/ปิดห้องที่มีสมาชิกอยู่
- [ ] ทบทวน hard delete ห้อง: FK cascade ลบ requests/members/matches ตามไปด้วย
      ถ้าต้องรักษาประวัติให้ใช้ archive หรือข้อจำกัดการลบตาม business rule
- [ ] ทำให้การลองซ้ำหลัง response หายมีผลที่เข้าใจได้ (idempotency/reconciliation) ทั้ง request/decision/create room

### 6. หาเพื่อนและการแจ้งเตือน

- [ ] ยกเลิกคำชวน pending, unfriend/block และกำหนดการชวนใหม่หลังปฏิเสธ
      ปัจจุบัน unique unordered pair และ exclusion ทำให้คู่ที่ปฏิเสธแล้วไม่ถูกเสนอ/ชวนซ้ำ
- [ ] เพิ่ม pagination และขอบเขตจำนวนผลลัพธ์ discovery/connections
- [ ] ถ้าต้องการค้นตาม preferences จริง ให้กำหนดและทดสอบกติกางบ/เพศ/อายุ/มหาวิทยาลัย
      ตอนนี้ search เน้นข้อความ ไม่ใช่ compatibility engine
- [ ] แจ้งผลอนุมัติ/ปฏิเสธ/คำชวนให้ผู้ส่งเห็นชัด โดยแยก pending count กับ unread notifications
- [ ] ถ้าเพิ่มอีเมล/push ให้มี queue/outbox, retry, deduplication และตัวเลือกการรับแจ้งเตือน
- [ ] เพิ่ม persisted notification/read state เฉพาะเมื่อต้องการประวัติหรืออ่านข้ามอุปกรณ์
      polling 30 วินาทีปัจจุบันใช้เริ่มต้นได้ ไม่จำเป็นต้องเปลี่ยนเป็น WebSocket ทันที

### 7. รูปภาพ (อัปโหลดจากเครื่องทำแล้ว)

- [ ] จัด persistent disk/backup และ monitor disk usage ของ uploads ในระบบจริง
- [ ] ทำ scheduled cleanup ทั้งระบบและกระบวนการลบรูปตามคำขอลบข้อมูล/การ moderation
      ปัจจุบันล้างเฉพาะรูปไม่มี reference เกิน 24 ชั่วโมงเมื่อเจ้าของอัปโหลดครั้งถัดไป
- [ ] วาง global storage budget และ shared rate limit ถ้าเพิ่ม API process/instance
- [ ] ใช้ object storage/CDN เมื่อจำเป็นตามขนาดหรือสถาปัตยกรรม ไม่ได้เป็นเงื่อนไขบังคับสำหรับ pilot instance เดียว
- [ ] ทดสอบรูปจาก iOS/Android จริง, EXIF orientation, low-memory/slow network และ update image processor
- [ ] พิจารณา crop/compress ก่อนส่งและ HEIC conversion; ปัจจุบันรองรับ JPG/PNG/WebP เท่านั้น
- [ ] รูปปัจจุบันอ่านสาธารณะได้จาก URL ถ้าอนาคตเก็บเอกสารส่วนตัวต้องมี private storage/authorization แยก

รายละเอียดที่ implement และข้อจำกัด: [UPLOADS.md](UPLOADS.md)

### 8. ประสิทธิภาพและ API

- [ ] มี pagination UI และ metadata ของ rooms; API มี `limit/offset` สูงสุด 100 แล้ว แต่ UI ยังไม่เปิดหน้าถัดไป
- [ ] จำกัด/แบ่งหน้าข้อมูล owner requests, my listings, matches และรายชื่อเพื่อนตามปริมาณใช้งาน
- [ ] ลด N+1 queries (ดึงรูปต่อห้องและ lifestyle/preference ต่อคน) และวัด query plans/indexes
- [ ] load/soak test ตามจำนวนผู้ใช้เป้าหมาย วัด p95 latency, error rate, CPU/RAM, SQLite busy และ image processing
- [ ] ทดสอบ concurrency กับ deployment จริง/หลาย connection ไม่ใช่อาศัย single-process tests อย่างเดียว
- [ ] เพิ่ม timeout/abort requests และป้องกัน stale responses ในหน้าที่ยังไม่ได้ทำ
- [ ] ทำ API error codes/field errors ที่เสถียรและข้อความไทยที่บอกวิธีแก้ได้
- [ ] ทำ API contract/OpenAPI และ compatibility policy ระหว่าง frontend/backend
- [ ] ทบทวน `ROOM.title` ที่ตอนนี้เข้ารหัสในบรรทัดแรกของ description
      ถ้าจะเปลี่ยนเป็น column ให้ทำ migration และปรับ ER ร่วมกับทีม ไม่ใช่ blocker ถ้าทีมยอมรับ convention เดิม

### 9. การดูแลระบบและส่งงาน

- [ ] CI รัน tests, typecheck/build, dependency scan และ lint/format (ปัจจุบันไม่มี lint script/config)
- [ ] เก็บ lockfile และอัปเดต dependency แบบควบคุม; `latest` ใน manifest ยังเสี่ยงเปลี่ยนมากเมื่อสร้าง lock ใหม่
- [ ] เพิ่ม structured logs/request ID โดย redact ข้อมูลลับ และ audit events ของการตัดสินใจ/ผู้ดูแล
- [ ] error tracking, metrics/alerts สำหรับ error spike, latency, disk, DB, backup และ SMTP/queue ถ้ามี
- [ ] แยก liveness กับ readiness: `/api/health` ปัจจุบันตอบ `{ok:true}` ไม่ได้ตรวจ DB/storage
- [ ] graceful shutdown/drain เมื่อ deploy; entrypoint ยังไม่มี SIGTERM shutdown workflow
- [ ] มี staging, smoke test หลัง deploy, rollback และ release checklist ที่ทีมใช้ร่วมกัน
- [ ] มี incident runbook, ช่องทาง support, ผู้รับผิดชอบเวร และ budget/usage alerts ของบริการที่ใช้

### 10. UX/accessibility และ QA

- [ ] browser E2E อัตโนมัติสำหรับสมัคร/login/logout, profile/image, room CRUD, request/approval/matches และ friends
- [ ] ตรวจทุกหน้าบน iOS Safari/Android Chrome จริง รวม keyboard, screen reader, zoom และ orientation
- [ ] audit labels, focus order/trap/return, contrast, reduced motion และขนาดปุ่มสัมผัส
- [ ] ทดสอบข้อมูลว่าง/ยาว/ชื่อไทย/รูปหาย/ข้อมูลจำนวนมากในทุก major page
- [ ] offline/slow network, server restart ระหว่างบันทึก, 401 expired token, 429/5xx และ recover โดยไม่ทำข้อมูลซ้ำ
- [ ] แจ้ง unsaved changes/draft สำหรับแบบฟอร์มยาว และพิจารณา upload progress รายรูป
- [ ] ตรวจความหมายราคา/คนหรือห้อง, ความจุนับเจ้าของ, การอนุมัติไม่ใช่การจองหรือสัญญาเช่า
- [ ] ทดลอง usability กับนักศึกษาจริงและแก้จุดที่ทำให้สับสนก่อนเพิ่ม decoration/features ใหม่

## ไม่ใช่เงื่อนไขบังคับของ production

Chat, AI matching, swipe Like/Pass, favorites, map search, WebSocket, Kubernetes, microservices
และการย้าย DB ไม่ได้ทำให้ระบบพร้อม production โดยตัวมันเอง ให้เพิ่มตาม product scope ที่ทีมตกลง
Favorites/amenities/tag catalog หากเพิ่มแบบ persisted ต้องออกแบบ schema/API เพิ่ม ไม่ได้มีใน ER ปัจจุบัน
การหาเพื่อนปัจจุบันเป็น invitation/acceptance ไม่ใช่ mutual-like engine และไม่มีการขอห้องแทนกันเป็นกลุ่ม

## แบ่งงานให้ทีม 3 คน

| เจ้าของงาน | สิ่งที่ควรเริ่ม | งานที่ต้องคุยร่วมกัน |
| --- | --- | --- |
| คนที่ 1 บัญชี/โปรไฟล์ | session/revocation, reset/change password, email verification, privacy | cookie/API contract, upload component ที่เพิ่มรอบนี้ |
| คนที่ 2 ห้องพัก | archive/delete policy, pagination, รูปห้อง, performance list/detail | capacity/owner transfer/member lifecycle |
| คนที่ 3 คำขอ/หาเพื่อน | cancel/expire request, leave/remove member, cancel/unfriend/block, notification | ข้อมูลติดต่อหลังยุติความสัมพันธ์ และ moderation |
| ร่วมกัน | hosting/secrets, backup/restore, CI, load/security/E2E tests, logs/alerts | ER/migration, definition of done, incident owner |

ลำดับแนะนำ: ตกลง lifecycle/ข้อมูลส่วนตัว → session/rate limit/recovery → deploy+backup/restore
→ report/block/moderation → pagination/monitoring/E2E → ทดลองกลุ่มจำกัดแล้ววัดผล

## สิ่งที่ยังยืนยันไม่ได้จาก repository

สถานะ TLS/DNS/firewall/WAF จริง, สิทธิ์และการเข้ารหัสของ hosting/storage, backup นอกเครื่อง,
การตั้ง GitHub branch protection/collaborator permissions, uptime, load capacity และ compliance
ต้องตรวจ environment และทีมปฏิบัติงานจริงก่อนลงนามว่าเปิด production ได้
ไม่พบ CI/deployment/lint configuration ที่ track ใน repository ตอนตรวจ
