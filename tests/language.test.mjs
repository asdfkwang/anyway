import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseLanguage } from '../src/lib/language.mjs';

test('an explicit choice takes priority over browser language', () => {
  assert.equal(chooseLanguage('en', ['ko-KR']), 'en');
  assert.equal(chooseLanguage('ko', ['en-US']), 'ko');
});
test('browser preferences use the first supported language', () => {
  assert.equal(chooseLanguage(null, ['ko-KR', 'en-US']), 'ko');
  assert.equal(chooseLanguage(null, ['en-GB', 'ko-KR']), 'en');
  assert.equal(chooseLanguage(null, ['fr-FR', 'ko-KR']), 'ko');
  assert.equal(chooseLanguage(null, ['KO-kr']), 'ko');
});
test('invalid storage and unsupported or empty language lists are safe', () => {
  assert.equal(chooseLanguage('invalid', ['ko-KR']), 'ko');
  assert.equal(chooseLanguage(null, ['ja-JP']), 'en');
  assert.equal(chooseLanguage(null, []), 'en');
});
