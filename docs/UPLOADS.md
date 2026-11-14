# อัปโหลดรูปจากเครื่อง

เพิ่มเมื่อ 2026-11-13 บน branch `Poom` ไม่มี schema migration และไม่แทนที่รูปเก่าอัตโนมัติ

## ใช้งาน

- โปรไฟล์ → แก้ไขโปรไฟล์ → เลือกรูปจากเครื่อง → บันทึกการเปลี่ยนแปลง
- ลงประกาศ/แก้ไขประกาศ → เลือกรูปห้อง → สลับลำดับด้วยลูกศรหรือลบรูป → บันทึก
- รูปห้องสูงสุด 12 รูป รูปแรกเป็นรูปปก รูปโปรไฟล์ 1 รูป
- ยกเลิกหรือออกจากฟอร์มก่อนบันทึกจะไม่อัปโหลดไฟล์ที่เพิ่งเลือก
- หากอัปโหลดบางรูปสำเร็จแล้วรูปถัดไปหรือการบันทึกไม่สำเร็จ ฟอร์มเก็บผลอัปโหลดที่สำเร็จไว้
  เพื่อให้ลองใหม่โดยไม่ส่งรูปเหล่านั้นซ้ำ การ refresh ก่อนบันทึกสำเร็จยังทำให้ draft หายได้

## รูปที่รองรับและการเก็บ

- ภาพนิ่ง JPG/JPEG, PNG, WebP ขนาดมากกว่า 0 และไม่เกิน 5 MiB (แสดงใน UI ว่า 5 MB)
- ไม่เกิน 25 ล้านพิกเซลต่อรูป ไม่รับ SVG, GIF, HEIC, AVIF หรือภาพหลายเฟรม
- HEIC จากบางอุปกรณ์ต้อง export เป็น JPG/PNG ก่อน การแปลง HEIC และเครื่องมือ crop ยังไม่มี
- ใช้ `sharp` อ่านข้อมูลจริง ตรวจชนิดและ decode ใหม่ ไม่เชื่อนามสกุลหรือ MIME อย่างเดียว
- หมุนตาม EXIF orientation, ย่อให้ด้านยาวไม่เกิน 1600px และบันทึก WebP quality 82
- ไม่เก็บ EXIF/GPS หรือ metadata ต้นฉบับ ชื่อไฟล์สุ่ม UUID ไม่ใช้ชื่อที่ผู้ใช้อัปโหลด
- ต้องเข้าสู่ระบบและบัญชียัง active จึงอัปโหลดได้ ไม่เกิน 20 ครั้ง/นาที/บัญชี
- รับอัปโหลดพร้อมกันสูงสุด 4 งานต่อ API process รวมช่วงอ่าน body และแปลงรูป
- แต่ละบัญชีจำกัด 200 ไฟล์/250 MiB ในโฟลเดอร์ของตน รวมไฟล์ที่ยังไม่ได้แนบ
- รูปใหม่อยู่ใน `storage/uploads/<userId>/<uuid>.webp` โดยกำหนดรากด้วย `ROOMMATCH_UPLOAD_DIR` ได้
- ภาพถูกใช้เป็นรูปโปรไฟล์/ประกาศ และ **URL รูปเปิดอ่านได้สาธารณะ** ไม่ใช่ที่เก็บเอกสารส่วนตัว
- รูปที่ลบออกจากฟอร์มยังไม่เปลี่ยนข้อมูลจนกดบันทึก รูปที่ไม่มี DB อ้างอิงเกิน 24 ชั่วโมง
  จะถูกล้างเมื่อบัญชีเดียวกันอัปโหลดครั้งถัดไป ไม่ใช่ cron ล้างไฟล์ทั้งระบบ
- ลบรูปจาก UI ไม่ได้เรียกคืนสำเนาที่ผู้ชมดาวน์โหลดหรือ cache ไว้แล้ว

## API

### `POST /api/uploads/images`

ส่งหนึ่งไฟล์ต่อ request เป็น raw binary body (ไม่ใช่ multipart และไม่ใช่ base64 JSON):

```http
Authorization: Bearer <token>
Content-Type: image/jpeg
```

เมื่อสำเร็จตอบ `201`:

```json
{ "imageUrl": "/uploads/1/<uuid>.webp" }
```

นำ `imageUrl` ไปใช้กับ `PATCH /api/profile` (`profileImage`) หรือ room create/edit (`images`)
ระบบตรวจว่ารูป local มีอยู่และอัปโหลดโดยบัญชีที่ส่งข้อมูล ไม่อนุญาตนำ path ของอีกบัญชีมาแนบ
รูป HTTP(S) เดิมยังรองรับเพื่อไม่ทำข้อมูล/สัญญา API เดิมเสียหาย
ตอนสมัครบัญชียังไม่มี file picker ให้เพิ่มรูปที่หน้าโปรไฟล์หลังเข้าสู่ระบบ

ข้อผิดพลาด: `400` รูปเสีย/ชนิดจริงไม่ตรง/พิกเซลเกิน, `401` ต้องเข้าสู่ระบบ,
`409` พื้นที่บัญชีเต็ม, `413` ไฟล์เกินขนาด, `415` ชนิดไม่รองรับ,
`429` ส่งถี่เกิน, `503` มีงานอัปโหลดพร้อมกันเต็ม, `500` จัดเก็บไม่สำเร็จ
ข้อผิดพลาดภายในไม่ส่ง path ระบบหรือ stack trace ให้ client

### `GET/HEAD /uploads/<userId>/<uuid>.webp`

อ่านได้สาธารณะ ให้ `Content-Type: image/webp`, `nosniff`, CSP สำหรับรูป และ cache 1 ชั่วโมง
รับเฉพาะ path ตามรูปแบบที่ระบบสร้าง ไม่ทำ directory listing และไม่ใช้ SPA fallback กับรูปที่หาย

## ฐานข้อมูลและ deploy

ใช้ `USER.profile_image` และ `ROOM_IMAGE.image_url` เดิมเก็บ path ที่ API สร้าง
ไม่เก็บไฟล์หรือ base64 ใน SQLite ไม่มีการเปลี่ยน ER และไม่มี migration ใหม่

1. หลัง pull ให้รัน `npm ci` เพื่อเพิ่ม native dependency `sharp` ตาม lockfile
2. เริ่ม `npm run dev` ใหม่ เพราะมีทั้ง API module และ Vite proxy `/uploads` เพิ่มขึ้น
3. Production ใช้ `npm run build` และ `npm start`; API เสิร์ฟทั้ง `dist` และรูปจาก storage
4. ต้อง mount persistent disk สำหรับ SQLite และ uploads แยกจาก build/release directory
5. สำรอง DB และรูปให้สอดคล้องกัน และทดสอบ restore อย่าใช้ ephemeral disk โดยไม่มีแผนเก็บข้อมูล
6. หากแยก frontend/API คนละโดเมน ให้ proxy `/api` และ `/uploads` ไป API origin เดียวกัน
7. การ push GitHub ไม่ได้ส่งไฟล์ที่ผู้ใช้อัปโหลดขึ้นไปด้วย (`storage/uploads` ถูก ignore)

การเก็บไฟล์นี้เหมาะกับ API instance เดียวที่มี persistent disk หากจะใช้หลาย instance
ต้องออกแบบ shared/object storage และ distributed rate limit ก่อน โควตา/จำนวนงานปัจจุบันไม่ได้แชร์ข้าม process
ยังไม่มี CDN, signed private URLs, scheduled global cleanup, antivirus service หรือระบบ moderation รูป
ควร monitor disk usage และ error ของ image processor พร้อมอัปเดต dependency สม่ำเสมอ

## ตรวจสอบแล้ว

`npm test`: ผ่าน 68 ข้อ รวมชุดใหม่ 8 ข้อใน `tests/uploads.test.mjs`:

- upload, resize, strip EXIF, serve, บันทึกโปรไฟล์ และ restart แล้วข้อมูล/ไฟล์อยู่
- ไม่มี token, ไฟล์ว่าง/ใหญ่/เสีย, MIME ปลอม, SVG, รูปพิกเซลเกิน
- PNG/WebP, path traversal, รูปหาย, ห้ามแนบ local path ของบัญชีอื่น
- create/edit room, ลำดับรูป, legacy URLs และลบรูปจาก DB
- storage failure ไม่แก้ profile/room และไม่เปิดเผยรายละเอียดระบบ
- database write failure ยังนำรูปที่อัปโหลดแล้วมาลองบันทึกซ้ำได้
- rate limit และเก็บกวาดรูปเก่าที่ไม่มี reference โดยรักษารูปที่ยังใช้อยู่

Manual browser บนฐานข้อมูลชั่วคราว (ไม่แก้ข้อมูลผู้ใช้จริง):

- อัปโหลดโปรไฟล์จาก desktop/mobile, บันทึก, refresh, ตรวจว่ารูปโหลดจริง
- ลบรูปแล้ว cancel ยังคงรูปเก่า; ลบแล้ว save/refresh กลับเป็น initials
- เลือกรูปห้องหลายรูป สลับรูปปก สร้าง/แก้ไข/ลบรูป และ refresh nested edit route
- แทรกรูปเสียหลังรูปดี: แสดง error, ข้อมูลฟอร์มไม่หาย, ลบรูปเสียแล้วลองใหม่ได้
- เลือกไฟล์เกิน 5 MB บน mobile: แสดงข้อความและคงรูปที่เลือกไว้เดิม
- ตรวจ desktop 1366px, tablet 1024px, mobile 390px และ 320px ไม่มี horizontal overflow

นี่ไม่ใช่การทดสอบบนอุปกรณ์ iOS/Android จริงหรือการรับรองความปลอดภัย production
แนวทางตรวจไฟล์อ้างอิง [OWASP File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
และ [sharp output metadata](https://sharp.pixelplumbing.com/api-output/)
