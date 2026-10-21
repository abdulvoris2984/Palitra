'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fuzzyScore, osaDistance, prepareQuery, matchItem } = require('../src/core/fuzzy');

const score = (q, t) => {
  const r = fuzzyScore(q, t);
  return r ? r.score : 0;
};

test('exact beats prefix beats substring', () => {
  assert.ok(score('code', 'Code') > score('code', 'Code Insiders'));
  assert.ok(score('code', 'Code Insiders') > score('ode', 'Code Insiders'));
  assert.equal(score('settings', 'Settings'), 1);
});

test('word prefixes in any word', () => {
  assert.ok(score('chrome', 'Google Chrome') > 0.9);
  assert.ok(score('report pdf', 'annual_report_2025.pdf') > 0.9);
});

test('acronyms and word-prefix chains', () => {
  assert.ok(score('vsc', 'Visual Studio Code') > 0.8);
  assert.ok(score('vscode', 'Visual Studio Code') > 0.8);
  assert.ok(score('gchrome', 'Google Chrome') > 0.8);
});

test('typos are forgiven', () => {
  assert.ok(score('tarnslate', 'Translate text') > 0.6, 'transposition');
  assert.ok(score('transalte', 'Translate text') > 0.6, 'transposition');
  assert.ok(score('chrme', 'Google Chrome') > 0.6, 'missing letter');
  assert.ok(score('setings', 'Settings') > 0.6, 'missing letter');
  assert.ok(score('calculater', 'Calculator') > 0.6, 'wrong letter');
  assert.ok(score('пеервести', 'Перевести текст') > 0.6, 'cyrillic transposition');
});

test('typo tolerance does not produce nonsense matches', () => {
  assert.equal(score('report', 'reboot'), 0);
  assert.equal(score('vscode', 'url encode'), 0);
  assert.equal(score('xyz', 'Google Chrome'), 0);
  assert.equal(score('раскл', 'Справка: префиксы и сочетания клавиш'), 0);
});

test('wrong keyboard layout is understood', () => {
  // "ghbdtn" typed on the EN layout = "привет"
  assert.ok(score('ghbdtn', 'Привет') > 0.9);
  // "кузщке" typed on the RU layout = "report"
  assert.ok(score('кузщке', 'Report') > 0.9);
  assert.ok(score('rjydthn', 'Конвертировать в PNG') > 0.85);
});

test('highlight ranges point at matched characters', () => {
  const r = fuzzyScore('trans', 'Translate text');
  assert.deepEqual(r.ranges, [[0, 5]]);
  const chain = fuzzyScore('vsc', 'Visual Studio Code');
  assert.deepEqual(chain.ranges, [[0, 1], [7, 8], [14, 15]]);
});

test('keywords match with slightly lower weight and no highlight', () => {
  const PQ = prepareQuery('translate');
  const item = { title: 'Перевести текст', keywords: ['translate'] };
  const m = matchItem(PQ, item);
  assert.ok(m.score > 0.9 && m.score < 1);
  assert.deepEqual(m.ranges, []);
});

test('osaDistance counts transpositions as one edit', () => {
  assert.equal(osaDistance('abcd', 'abdc', 3), 1);
  assert.equal(osaDistance('kitten', 'sitting', 5), 3);
  assert.equal(osaDistance('a', 'abcdef', 2), 3); // early exit: > max
});
