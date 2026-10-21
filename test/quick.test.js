'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, tryCalculate, formatNumber } = require('../src/core/calculator');
const { parseConversion, convert } = require('../src/core/units');
const { parseCurrencyQuery, convertCurrency } = require('../src/core/currency');
const { parseBaseQuery, parseColor, parseTimestamp } = require('../src/core/numbers');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('calculator: precedence, functions, constants', () => {
  assert.equal(evaluate('2+2*2'), 6);
  assert.equal(evaluate('(2+2)*2'), 8);
  assert.equal(evaluate('2^3^2'), 512); // right-associative
  assert.equal(evaluate('-2^2'), -4);
  assert.equal(evaluate('sqrt(16) + abs(-3)'), 7);
  assert.equal(evaluate('max(2, 5, 3)'), 5);
  assert.equal(evaluate('5!'), 120);
  assert.equal(evaluate('100 mod 7'), 2);
  near(evaluate('2pi'), 2 * Math.PI);
  near(evaluate('sin(30deg)'), 0.5);
  assert.equal(evaluate('(1+2)(3+4)'), 21);
});

test('calculator: percentages and locale formats', () => {
  assert.equal(evaluate('200 + 15%'), 230);
  assert.equal(evaluate('200 - 50%'), 100);
  assert.equal(evaluate('200 * 15%'), 30);
  assert.equal(evaluate('2,5 * 2'), 5);
  assert.equal(evaluate('1 000 000 * 3'), 3000000);
  assert.equal(evaluate('10 × 3 ÷ 2'), 15);
});

test('tryCalculate only fires for real expressions', () => {
  assert.equal(tryCalculate('42'), null);
  assert.equal(tryCalculate('hello'), null);
  assert.equal(tryCalculate('2-factor auth'), null);
  assert.equal(tryCalculate('mp3 to wav'), null);
  assert.equal(tryCalculate('1/0'), null); // Infinity is not a useful answer
  assert.equal(tryCalculate('3*7'), 21);
});

test('formatNumber groups digits and trims float noise', () => {
  assert.equal(formatNumber(0.1 + 0.2), '0.3');
  assert.equal(formatNumber(1234567.5), '1 234 567.5');
  assert.equal(formatNumber(1234567.5, { group: false }), '1234567.5');
  assert.equal(formatNumber(6.2137119223733395, { digits: 8 }), '6.2137119');
});

test('units: explicit and default targets, RU and EN names', () => {
  near(parseConversion('10 km to mi').results[0].value, 6.2137119223733395);
  near(parseConversion('100f in c').results[0].value, 37.77777777777778);
  assert.equal(parseConversion('5 гб в мб').results[0].value, 5000);
  assert.equal(parseConversion('3,5 часа в минуты').results[0].value, 210);
  assert.equal(parseConversion('1 000 m in km').results[0].value, 1);
  const multi = parseConversion('20 c to f, k').results.map((r) => r.value);
  near(multi[0], 68);
  near(multi[1], 293.15);
  assert.equal(parseConversion('72 kg').results[0].unit, 'lb');
  assert.equal(parseConversion('10 in to cm').results[0].value, 25.4);
  assert.equal(parseConversion('5 s'), null, 'single letters need a target');
  assert.equal(parseConversion('10 km to kg'), null, 'different categories');
  assert.equal(convert(1, 'mi', 'ft').toFixed(0), '5280');
});

test('currency queries', () => {
  assert.deepEqual(parseCurrencyQuery('100 usd to eur'), { amount: 100, from: 'USD', to: ['EUR'] });
  assert.deepEqual(parseCurrencyQuery('$100'), { amount: 100, from: 'USD', to: null });
  assert.deepEqual(parseCurrencyQuery('100 евро в рублях'), { amount: 100, from: 'EUR', to: ['RUB'] });
  assert.deepEqual(parseCurrencyQuery('5k uzs'), { amount: 5000, from: 'UZS', to: null });
  assert.deepEqual(parseCurrencyQuery('20 eur to usd, rub'), { amount: 20, from: 'EUR', to: ['USD', 'RUB'] });
  assert.equal(parseCurrencyQuery('10 km'), null);
  assert.equal(parseCurrencyQuery('100 try'), null, '"try" is too ambiguous in lower case');
  assert.equal(parseCurrencyQuery('100 CAD', new Set(['CAD'])).from, 'CAD');
  const rates = { USD: 1, EUR: 0.9, RUB: 90 };
  near(convertCurrency(9, 'EUR', 'RUB', rates), 900);
  assert.equal(convertCurrency(1, 'USD', 'XXX', rates), null);
});

test('number bases', () => {
  const all = parseBaseQuery('0xff').results.map((r) => r.text);
  assert.deepEqual(all, ['255', '0b11111111', '0o377']);
  assert.equal(parseBaseQuery('255 to bin').results[0].text, '0b11111111');
  assert.equal(parseBaseQuery('0b1010 в dec').results[0].text, '10');
  assert.equal(parseBaseQuery('12345678901234567890 to hex').results[0].text, '0xAB54A98CEB1F0AD2');
  assert.equal(parseBaseQuery('0b12'), null);
  assert.equal(parseBaseQuery('hello'), null);
});

test('colours', () => {
  assert.deepEqual(parseColor('#ff8800'), { hex: '#FF8800', rgb: 'rgb(255 136 0)', hsl: 'hsl(32 100% 50%)', css: 'rgba(255, 136, 0, 1)' });
  assert.equal(parseColor('#f80').hex, '#FF8800');
  assert.equal(parseColor('rgb(10, 20, 30)').hex, '#0A141E');
  assert.equal(parseColor('hsl(210 50% 40%)').hex, '#336699');
  assert.equal(parseColor('facade'), null, 'words made of hex letters are not colours');
});

test('timestamps', () => {
  assert.equal(parseTimestamp('1700000000').toISOString(), '2023-11-14T22:13:20.000Z');
  assert.equal(parseTimestamp('1700000000000').toISOString(), '2023-11-14T22:13:20.000Z');
  assert.equal(parseTimestamp('9999999999'), null);
  assert.equal(parseTimestamp('12345'), null);
});
