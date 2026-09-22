import test from 'node:test';
import assert from 'node:assert/strict';
import { rankEntries } from '../src/lib/search.mjs';
const entries = [
  { title: 'Serial devices', description: 'A guide', tags: ['linux', 'uart'], body: 'Registers and interrupts', id: 1 },
  { title: 'UART basics', description: 'A guide', tags: ['hardware'], body: 'Linux serial', id: 2 },
  { title: '커널 노트', description: '인터럽트', tags: ['커널'], body: '레지스터 UART', id: 3 },
];
test('tag matches rank above title and body; case is ignored', () => assert.deepEqual(rankEntries(entries, 'UART').map(x=>x.id), [1,2,3]));
test('multiple terms must all match', () => assert.deepEqual(rankEntries(entries, 'uart linux').map(x=>x.id), [1,2]));
test('hash requests exact tags and Korean is searchable', () => {
  assert.deepEqual(rankEntries(entries, '#uart').map(x=>x.id), [1]);
  assert.deepEqual(rankEntries(entries, '레지스터').map(x=>x.id), [3]);
});
test('empty and unmatched searches have no results', () => {
  assert.deepEqual(rankEntries(entries, ' '), []);
  assert.deepEqual(rankEntries(entries, 'nonexistent'), []);
  assert.deepEqual(rankEntries(entries, '#'), []);
});
