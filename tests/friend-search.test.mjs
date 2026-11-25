import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesFriendSearch } from '../shared/friendSearch.js';

const person = {
  firstName: 'สมชาย', lastName: 'ใจดี', university: 'KMUTT', bio: null,
  lifestyle: 'นอนเร็ว ตื่นเช้า ไม่สูบบุหรี่ สะอาด ทำอาหาร ชอบฟังเพลง',
};

test('pending-invitation search finds separated lifestyle terms in either order', () => {
  for (const query of ['ตื่นเช้า สะอาด', 'สะอาด ตื่นเช้า', 'ตื่นเช้า\tสะอาด\nตื่นเช้า', 'ใจดี สมชาย', 'สะอาด kmutt', '']) {
    assert.equal(matchesFriendSearch(person, query), true, query);
  }
  for (const query of ['ตื่นเช้า เลี้ยงแมว', 'สะอาด Carol']) {
    assert.equal(matchesFriendSearch(person, query), false, query);
  }
});

test('search treats punctuation as literal text and tolerates missing profile fields', () => {
  assert.equal(matchesFriendSearch({ lifestyle: '100% _quiet \\ room' }, '% _quiet'), true);
  assert.equal(matchesFriendSearch({ lifestyle: 'quiet room' }, '% _'), false);
  assert.equal(matchesFriendSearch({}, 'สะอาด'), false);
  assert.equal(matchesFriendSearch({}, '   '), true);
});
