# ลดขั้นตอนจากโปรไฟล์และรายละเอียดห้อง

## โปรไฟล์ → ทำรายการต่อได้เลย

- เจ้าของเปิดโปรไฟล์ผู้ขอแล้วกดอนุมัติหรือปฏิเสธได้ โดยยังใช้หน้าต่างยืนยันและตรวจที่ว่างเดิม
- ยกเลิกหน้าต่างยืนยันจะกลับมาโปรไฟล์เดิม; คำขอที่จัดการแล้วหรือโปรไฟล์โหลดไม่สำเร็จไม่มีปุ่มตัดสินใจ
- โปรไฟล์เพื่อนมีปุ่มชวน/ตอบรับ/ปฏิเสธ/ค้นหาห้องด้วยกันตามสถานะจริง ใช้ API เดิม
- ส่งคำชวนสำเร็จแล้วเปลี่ยนเป็นสถานะรอตอบรับในหน้าต่างเดิม ป้องกันการกดส่งซ้ำ
- ติดต่อเพื่อนได้หลังตอบรับเท่านั้น; ข้อผิดพลาดแสดงติดกับปุ่มใน footer ของหน้าต่าง และลองใหม่ได้

## รายละเอียดห้อง → ถอนคำขอ

- ผู้ส่ง pending กดถอนจากรายละเอียดห้องได้โดยไม่ต้องย้ายไปหน้าคำขอ มีขั้นยืนยันก่อนถอน
- ถอนสำเร็จแล้วแสดงสถานะเดิมเก็บประวัติ และส่งคำขอใหม่ได้เมื่อห้องเปิดรับ/มีที่ว่าง
- ห้องเต็มหรือพักประกาศยังถอน pending ได้ ไม่ลดจำนวนสมาชิกหรือแก้สถานะห้อง
- `GET /api/rooms/:id` เพิ่ม `pendingRequestId` เฉพาะคำขอ pending ของผู้ล็อกอินเอง ผู้ใช้อื่นไม่เห็น ID ของผู้ขอ; ผู้ไม่ล็อกอินไม่มีฟิลด์นี้
- หลังส่งคำขอใหม่ UI ใช้ ID จาก response โดยตรง หลังถอน/อนุมัติ ID เป็น null
- API ถอนใช้ `POST /api/requests/:id/cancel` เดิม; ไม่เพิ่มตาราง/migration
- หากเจ้าของตัดสินใจพร้อมกับถอน ระบบแจ้ง 409 และอ่านสถานะล่าสุดมาแสดงในหน้าต่างเดิม โดยไม่แจ้งว่าถอนสำเร็จ

## ตรวจสอบ

- `npm test`: 82 tests ผ่าน รวมเคส own pending ID/privacy, ถอน/refresh/ส่งใหม่/อนุมัติ และห้องเต็ม/พักประกาศ
- `npm run build` และ `git diff --check`
- Browser กับฐานข้อมูล/รูปชั่วคราวแยกจากข้อมูลผู้ใช้: desktop 1440×900, mobile 320×740 และ 390×844
- ลองอนุมัติจากโปรไฟล์/ยกเลิกกลับโปรไฟล์/ประวัติไม่มีปุ่มซ้ำ, profile load503/retry, ชวนและตอบรับในโปรไฟล์/contacts ตาม consent, action503/retry, ถอนยกเลิก/สำเร็จ/refresh/ขอใหม่ และกรณีอนุมัติแข่งกับถอน
- หลักฐานอยู่ `deliverables/quick-actions-2026-11-14/` ซึ่งถูก ignore; ไม่ใช่ผลทดสอบ branch ที่รวม Favorites/Profile แล้ว

## แยก commit ด้วยตัวเองได้ 2 ชุด

ชุดแรก: โปรไฟล์มีปุ่มดำเนินการ

```bash
git add src/components/RequesterProfileModal.tsx src/components/RequesterProfileModal.css src/pages/RequestsPage.tsx src/pages/FriendsPage.tsx src/pages/FriendsPage.css
git commit -m "feat: add request and friend actions to profile dialogs"
```

ชุดที่สอง: ถอนคำขอจากรายละเอียดห้อง

```bash
git add server/app.js src/lib/api.ts src/types.ts src/pages/RoomDetailPage.tsx tests/room-detail-request.test.mjs docs/QUICK_ACTIONS.md
git commit -m "feat: withdraw pending requests from room details"
```

มี 11 ไฟล์ในสองชุดนี้ ไม่รวมไฟล์ untracked เดิมที่ไม่เกี่ยวข้อง ไม่มีการ stage/commit/push หรือเปลี่ยน branch ให้อัตโนมัติ
