PRAGMA foreign_keys = ON;

-- Primary UI demo: phoom.s@mail.kmutt.ac.th / roommatch
-- Other demo accounts use the password: roommatch123
INSERT OR IGNORE INTO USER (
    user_id, first_name, last_name, phone, gender, date_of_birth,
    password_hash, university, profile_image, bio, email, instagram,
    line_id, is_active, created_at, updated_at
) VALUES
    (1, 'ภูมิ', 'วัฒนากุล', '0812345678', 'male', '2003-04-12',
     'scrypt$16384$8$1$726f6f6d6d617463682d736565642d70686f6f6d$7c6c70399dec5673f8120740b215c0a17f45500729059e952c3f8ae082d09abe124147882d165c7b20a18bc0dd4143dde58a567926181f0cfe82441bf1e28a3d',
     'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี', NULL, 'ชอบทำอาหาร วิ่ง และหาเพื่อนร่วมห้องที่เป็นระเบียบ',
     'phoom.s@mail.kmutt.ac.th', 'phoom.room', 'phoom_room', 1, '2026-01-05T09:00:00.000Z', '2026-01-05T09:00:00.000Z'),
    (2, 'บีม', 'สุวรรณ', '0823456789', 'female', '2004-08-23',
     'scrypt$16384$8$1$726f6f6d6d617463682d736565642d6265616d$97bbb7ba01866e05428f92d2891bd5c8bc08741798cb9af1091822fe99f38c4175e70fb6523f29b1181d1e7477ad897080aae3250d4767823f6bebd8dd67b338',
     'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี', NULL, 'ตื่นเช้า ไม่สูบบุหรี่ เลี้ยงแมวหนึ่งตัว',
     'beam@roommatch.test', 'beam.studies', 'beam_study', 1, '2026-01-06T10:30:00.000Z', '2026-01-06T10:30:00.000Z'),
    (3, 'ชมพู่', 'พันธุ์รุ่ง', '0834567890', 'female', '2002-12-07',
     'scrypt$16384$8$1$726f6f6d6d617463682d736565642d63686f6d706f6f$a2fdfd52e9761282e64aa5b0266765e07022c0b520f6152e8a9faa993c671460c06f96239f5c634e4f1d5d8e9fa02af9ae07e2082524b2d40962073c2c69d024',
     'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี', NULL, 'ชอบอ่านหนังสือ นอนดึกได้ รักความสงบ',
     'chompoo@roommatch.test', 'chompoo.reads', 'chompoo_read', 1, '2026-01-08T08:15:00.000Z', '2026-01-08T08:15:00.000Z'),
    (4, 'ดาว', 'อนันต์', '0845678901', 'non_binary', '2003-06-18',
     'scrypt$16384$8$1$726f6f6d6d617463682d736565642d64616f$784383d2ce000e6569945634756d62bd3e295f299f76353d99973e79d2712a021457cb3288ce75ef4f43def0402807bd4c05eb324b6be261a6375dd67684d2fe',
     'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี', NULL, 'เรียนสถาปัตย์ ชอบวาดรูปและดูหนัง',
     'dao@roommatch.test', 'dao.draws', 'dao_draws', 1, '2026-01-10T14:00:00.000Z', '2026-01-10T14:00:00.000Z'),
    (5, 'เอิร์ธ', 'กิตติ', '0856789012', 'male', '2004-02-29',
     'scrypt$16384$8$1$726f6f6d6d617463682d736565642d6561727468$2bd0404960232568134ed0a1e590d6b5ec935382329370d856cc76ad932979300c0f210a401574dab13dc72ce675e64cac0c0ac56017853def23fd1f82af1d14',
     'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี', NULL, 'เล่นดนตรี ออกกำลังกาย และไม่จัดปาร์ตี้ที่ห้อง',
     'earth@roommatch.test', 'earth.plays', 'earth_music', 1, '2026-01-11T11:45:00.000Z', '2026-01-11T11:45:00.000Z');

INSERT OR IGNORE INTO LIFESTYLE (lifestyle_id, user_id, lifestyle_name) VALUES
    (1, 1, 'รักความเป็นระเบียบ • ทำอาหาร'),
    (2, 2, 'ตื่นเช้า • ไม่สูบบุหรี่ • เลี้ยงสัตว์'),
    (3, 3, 'นอนดึก • รักความสงบ'),
    (4, 4, 'ชอบศิลปะ • ทำความสะอาดทุกสัปดาห์'),
    (5, 5, 'ชอบดนตรี • ออกกำลังกาย • ไม่จัดปาร์ตี้');

INSERT OR IGNORE INTO PREFERENCE (
    preference_id, user_id, preferred_gender, preferred_age_min,
    preferred_age_max, budget_min, budget_max
) VALUES
    (1, 1, 'any', 18, 26, 4500, 7500),
    (2, 2, 'female', 18, 25, 4000, 7000),
    (3, 3, 'any', 20, 28, 5000, 8500),
    (4, 4, 'any', 18, 27, 4500, 8000),
    (5, 5, 'male', 18, 25, 3500, 6500);

INSERT OR IGNORE INTO ROOM (
    room_id, owner_id, google_maps_url, price, capacity, description, status, created_at
) VALUES
    (1, 1, 'https://maps.google.com/?q=13.6518,100.4957', 6200, 3,
     'คอนโดใกล้ มจธ. บางมด' || char(10) || 'ห้องมุมชั้น 8 มีแสงธรรมชาติ เดินถึงมหาวิทยาลัยได้', 'available', '2026-02-01T08:00:00.000Z'),
    (2, 2, 'https://maps.google.com/?q=13.6616,100.4977', 5400, 2,
     'อพาร์ตเมนต์สงบใกล้ตลาดบางปะกอก' || char(10) || 'ห้องพร้อมอยู่ มีรถสองแถวผ่าน เหมาะกับคนที่ชอบความเงียบ', 'available', '2026-02-03T09:30:00.000Z'),
    (3, 1, 'https://maps.google.com/?q=13.6489,100.4936', 4800, 2,
     'ห้องสตูดิโอเฟอร์นิเจอร์ครบ' || char(10) || 'มีระเบียง เคาน์เตอร์ครัว และที่จอดรถมอเตอร์ไซค์', 'available', '2026-02-10T12:00:00.000Z'),
    (4, 4, 'https://maps.google.com/?q=13.6552,100.5013', 7100, 3,
     'ทาวน์โฮมสองชั้นใกล้ป้ายรถเมล์' || char(10) || 'พื้นที่ส่วนกลางกว้าง มีมุมทำงานและครัวแยก', 'inactive', '2026-02-14T16:20:00.000Z');

INSERT OR IGNORE INTO ROOM_IMAGE (image_id, room_id, image_url, image_order) VALUES
    (1, 1, 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267', 0),
    (2, 1, 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688', 1),
    (3, 1, 'https://images.unsplash.com/photo-1560185008-b033106af5c3', 2),
    (4, 2, 'https://images.unsplash.com/photo-1493809842364-78817add7ffb', 0),
    (5, 2, 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2', 1),
    (6, 3, 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85', 0),
    (7, 3, 'https://images.unsplash.com/photo-1560448075-bb485b067938', 1),
    (8, 4, 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c', 0);

INSERT INTO ROOM_REQUEST (request_id, user_id, room_id, status, requested_at, responded_at)
SELECT 1, 2, 1, 'approved', '2026-02-05T10:00:00.000Z', '2026-02-05T18:30:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM ROOM_REQUEST WHERE request_id = 1);

INSERT INTO ROOM_REQUEST (request_id, user_id, room_id, status, requested_at, responded_at)
SELECT 2, 3, 1, 'pending', '2026-02-12T07:45:00.000Z', NULL
WHERE NOT EXISTS (SELECT 1 FROM ROOM_REQUEST WHERE request_id = 2);

INSERT INTO ROOM_REQUEST (request_id, user_id, room_id, status, requested_at, responded_at)
SELECT 3, 4, 1, 'rejected', '2026-02-08T13:20:00.000Z', '2026-02-09T09:10:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM ROOM_REQUEST WHERE request_id = 3);

INSERT INTO ROOM_REQUEST (request_id, user_id, room_id, status, requested_at, responded_at)
SELECT 4, 5, 2, 'approved', '2026-02-06T15:00:00.000Z', '2026-02-06T20:00:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM ROOM_REQUEST WHERE request_id = 4);

INSERT INTO ROOM_REQUEST (request_id, user_id, room_id, status, requested_at, responded_at)
SELECT 5, 5, 3, 'pending', '2026-02-15T11:25:00.000Z', NULL
WHERE NOT EXISTS (SELECT 1 FROM ROOM_REQUEST WHERE request_id = 5);

INSERT INTO ROOM_MEMBER (user_id, room_id, status, joined_at)
SELECT 2, 1, 'approved', '2026-02-05T18:30:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM ROOM_MEMBER WHERE user_id = 2 AND room_id = 1);

INSERT INTO ROOM_MEMBER (user_id, room_id, status, joined_at)
SELECT 5, 2, 'approved', '2026-02-06T20:00:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM ROOM_MEMBER WHERE user_id = 5 AND room_id = 2);

INSERT INTO MATCHES (match_id, initiator_user_id, completer_user_id, room_id, matched_at)
SELECT 1, 1, 2, 1, '2026-02-05T18:30:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM MATCHES WHERE match_id = 1);

INSERT INTO MATCHES (match_id, initiator_user_id, completer_user_id, room_id, matched_at)
SELECT 2, 2, 5, 2, '2026-02-06T20:00:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM MATCHES WHERE match_id = 2);

-- ตัวอย่างห้องโปรดของผู้ใช้ตัวอย่างหลัก (user_id 1)
INSERT OR IGNORE INTO ROOM_FAVORITE (user_id, room_id) VALUES
    (1, 2),
    (1, 4);