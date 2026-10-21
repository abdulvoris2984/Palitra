'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Frecency } = require('../src/core/frecency');
const { rankItems } = require('../src/core/ranker');

const DAY = 24 * 60 * 60 * 1000;

function clock(start = Date.UTC(2026, 0, 1)) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

test('recent uses outweigh old ones', () => {
  const c = clock();
  const f = new Frecency({}, { now: c.now, halfLifeDays: 5 });
  for (let i = 0; i < 10; i++) f.record('old');
  c.advance(60 * DAY);
  f.record('new');
  f.record('new');
  assert.ok(f.value('new') > f.value('old'));
  assert.deepEqual(f.top(2), ['new', 'old']);
});

test('bonus is bounded and grows with use', () => {
  const f = new Frecency();
  assert.equal(f.bonus('x'), 0);
  f.record('x');
  const one = f.bonus('x');
  for (let i = 0; i < 50; i++) f.record('x');
  assert.ok(f.bonus('x') > one);
  assert.ok(f.bonus('x') <= 22);
});

test('learns which item is picked for a query (and its prefixes)', () => {
  const f = new Frecency();
  f.record('cmd:translate', 'tr');
  f.record('cmd:translate', 'tra');
  assert.ok(f.queryBonus('cmd:translate', 'tr') > 0);
  assert.ok(f.queryBonus('cmd:translate', 't') > 0, 'prefix of a learned query');
  assert.equal(f.queryBonus('cmd:other', 'tr'), 0);
  assert.equal(f.queryBonus('cmd:translate', 'xyz'), 0);
});

test('serialises and restores', () => {
  const f = new Frecency();
  f.record('a', 'q');
  const g = new Frecency(JSON.parse(JSON.stringify(f.toJSON())));
  assert.equal(g.items.get('a').count, 1);
  assert.ok(g.queryBonus('a', 'q') > 0);
});

test('query memory is capped', () => {
  const f = new Frecency({}, { maxQueries: 3 });
  for (const q of ['a', 'b', 'c', 'd']) f.record('x', q);
  assert.equal(f.queries.size, 3);
  assert.ok(!f.queries.has('a'));
});

test('ranking: frecency lifts a frequently used item above a slightly better match', () => {
  const items = [
    { id: 'a', title: 'Calendar' },
    { id: 'b', title: 'Calculator' },
  ];
  const f = new Frecency();
  let ranked = rankItems('cal', items, f);
  assert.equal(ranked[0].item.id, 'a', 'shorter title wins a tie');
  for (let i = 0; i < 5; i++) f.record('b', 'cal');
  ranked = rankItems('cal', items, f);
  assert.equal(ranked[0].item.id, 'b');
});

test('forget and clear', () => {
  const f = new Frecency();
  f.record('a', 'q');
  f.forget('a');
  assert.equal(f.value('a'), 0);
  assert.equal(f.queryBonus('a', 'q'), 0);
  f.record('b');
  f.clear();
  assert.deepEqual(f.top(), []);
});
