import assert from 'node:assert/strict';
import { test } from 'node:test';
import { instagramProfileUrl } from '../src/lib/contactLinks.ts';

test('Instagram handles and profile URLs produce an HTTPS profile destination', () => {
  for (const input of ['student.room', '@student.room', ' student.room ', 'https://instagram.com/student.room', 'https://www.instagram.com/student.room/?igsh=example', 'http://instagram.com/student.room/']) {
    assert.equal(instagramProfileUrl(input), 'https://www.instagram.com/student.room/', input);
  }
});

test('arbitrary URLs, credentials and executable schemes never become contact links', () => {
  for (const input of ['', '.', '..', 'javascript:alert(1)', 'data:text/html,test', '//evil.example/student', 'https://evil.example/student', 'https://instagram.com.evil.example/student', 'https://instagram.com@evil.example/student', 'https://user:secret@instagram.com/student', 'https://instagram.com:8443/student', 'https://instagram.com/student/post', 'https://instagram.com/p/example/', 'https://instagram.com/student%2Fevil', 'name with spaces', '<script>alert(1)</script>']) {
    assert.equal(instagramProfileUrl(input), null, input);
  }
});
