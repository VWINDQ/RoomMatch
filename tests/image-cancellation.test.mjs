import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cancelledImageSelectionErrors } from '../src/lib/listingImageFeedback.ts';

test('cancelling empty selection shows the image requirement, while an existing image does not', () => {
  assert.deepEqual(cancelledImageSelectionErrors({}, []), { images: 'กรุณาเพิ่มรูปห้องอย่างน้อย 1 รูป' });
  assert.deepEqual(cancelledImageSelectionErrors({}, [{ url: 'https://example.test/saved.jpg' }]), {});
  assert.deepEqual(cancelledImageSelectionErrors({}, [{ url: '/uploads/1/saved.webp' }]), {});
  assert.deepEqual(cancelledImageSelectionErrors({}, [{ url: '', file: {} }]), { images: 'กรุณาเพิ่มรูปห้องอย่างน้อย 1 รูป' });
});

test('cancel never replaces file-type or upload failures and leaves unrelated errors intact', () => {
  for (const images of ['lease.pdf: รองรับเฉพาะไฟล์ภาพ JPG, PNG และ WebP', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', 'อัปโหลดรูปไม่สำเร็จ กรุณาลองอีกครั้ง']) {
    const current = { images, title: 'กรุณากรอกหัวข้อประกาศ' };
    assert.equal(cancelledImageSelectionErrors(current, []), current);
  }
  assert.deepEqual(cancelledImageSelectionErrors({ title: 'กรุณากรอกหัวข้อประกาศ' }, []), {
    title: 'กรุณากรอกหัวข้อประกาศ', images: 'กรุณาเพิ่มรูปห้องอย่างน้อย 1 รูป',
  });
});

test('cancel during checking/uploading does not introduce a missing-image error', () => {
  assert.deepEqual(cancelledImageSelectionErrors({}, [], true), {});
  assert.deepEqual(cancelledImageSelectionErrors({}, [{ url: '', file: {} }], true), {});
});
