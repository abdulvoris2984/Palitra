'use strict';

// Parses currency queries: "100 usd to eur", "$100", "100 евро в рублях",
// "5000 сум". Rates are fetched elsewhere; this module is pure.

const ALIASES = {
  USD: ['usd', '$', 'dollar', 'dollars', 'доллар', 'доллара', 'долларов', 'доллары', 'долларах', 'бакс', 'баксов', 'бакса'],
  EUR: ['eur', '€', 'euro', 'euros', 'евро'],
  RUB: ['rub', '₽', 'руб', 'рубль', 'рубля', 'рублей', 'рубли', 'рублях', 'рублях', 'ruble', 'rubles', 'rouble'],
  UZS: ['uzs', 'сум', 'сума', 'сумов', 'сумах', 'so\'m', 'som'],
  GBP: ['gbp', '£', 'sterling', 'фунт стерлингов', 'фунтов стерлингов'],
  JPY: ['jpy', '¥', 'yen', 'иена', 'иен', 'иены', 'йена', 'йен'],
  CNY: ['cny', 'rmb', 'yuan', 'юань', 'юаня', 'юаней', 'юани'],
  KZT: ['kzt', '₸', 'tenge', 'тенге'],
  TRY: ['try', '₺', 'lira', 'лира', 'лиры', 'лир'],
  CHF: ['chf', 'franc', 'francs', 'франк', 'франка', 'франков'],
  UAH: ['uah', '₴', 'hryvnia', 'гривна', 'гривны', 'гривен', 'гривен'],
  KGS: ['kgs', 'сом', 'сома', 'сомов'],
  PLN: ['pln', 'zł', 'zloty', 'злотый', 'злотых'],
  INR: ['inr', '₹', 'rupee', 'rupees', 'рупия', 'рупии', 'рупий'],
  KRW: ['krw', '₩', 'won', 'вона', 'вон'],
  AED: ['aed', 'dirham', 'дирхам', 'дирхама', 'дирхамов'],
  CAD: ['cad', 'c$'],
  AUD: ['aud', 'a$'],
  BRL: ['brl', 'r$', 'real', 'reais', 'реал', 'реала', 'реалов'],
  GEL: ['gel', '₾', 'lari', 'лари'],
  AMD: ['amd', '֏', 'dram', 'драм', 'драма', 'драмов'],
  BYN: ['byn', 'белорусский рубль', 'белорусских рублей'],
  TJS: ['tjs', 'сомони'],
  AZN: ['azn', '₼', 'manat', 'манат', 'маната', 'манатов'],
};

// ISO codes that collide with ordinary words/units and therefore are only
// accepted in upper case or when a target currency is also given.
const AMBIGUOUS = new Set(['TRY', 'CUP', 'ALL', 'TOP', 'MOP', 'BOB']);

const LOOKUP = new Map();
for (const [code, names] of Object.entries(ALIASES)) {
  for (const n of [code.toLowerCase(), ...names]) LOOKUP.set(n.toLowerCase(), code);
}

function lookupCurrency(raw, knownCodes) {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  if (LOOKUP.has(s)) return LOOKUP.get(s);
  // "в рублях", "in dollars" are handled by the caller; also accept any ISO
  // code the rate table knows about.
  if (/^[a-z]{3}$/.test(s) && knownCodes && knownCodes.has(s.toUpperCase())) return s.toUpperCase();
  return null;
}

const NUM = String.raw`(\d[\d   ]*(?:[.,]\d+)?|[.,]\d+)\s*(k|к|тыс|m|млн)?`;
const CONNECTOR = String.raw`(?:to|in|into|в|во|на|->|→|=|>)`;

function parseAmount(num, suffix) {
  let v = parseFloat(num.replace(/[   ]/g, '').replace(',', '.'));
  const sfx = (suffix || '').toLowerCase();
  if (sfx === 'k' || sfx === 'к' || sfx === 'тыс') v *= 1e3;
  if (sfx === 'm' || sfx === 'млн') v *= 1e6;
  return v;
}

/**
 * Returns { amount, from, to: [codes] | null } or null.
 * `to` is null when the query names no target currency.
 */
function parseCurrencyQuery(query, knownCodes) {
  const q = String(query ?? '').trim();
  if (!q || q.length > 80) return null;

  // "$100", "€ 20", "£5 to usd"
  let m = new RegExp(String.raw`^([$€£¥₽₸₺₴₹₩])\s*${NUM}(?:\s+${CONNECTOR}\s+(.+))?$`, 'i').exec(q);
  if (m) {
    const from = lookupCurrency(m[1], knownCodes);
    const amount = parseAmount(m[2], m[3]);
    const to = m[4] ? parseTargets(m[4], knownCodes) : null;
    if (from && Number.isFinite(amount) && (to === null || to.length)) return { amount, from, to };
    return null;
  }

  m = new RegExp(String.raw`^${NUM}\s*(.+?)(?:\s+${CONNECTOR}\s+(.+))?$`, 'i').exec(q);
  if (!m) return null;
  const amount = parseAmount(m[1], m[2]);
  const fromRaw = m[3];
  const from = lookupCurrency(fromRaw, knownCodes);
  if (!from || !Number.isFinite(amount)) return null;
  const to = m[4] ? parseTargets(m[4], knownCodes) : null;
  if (to !== null && !to.length) return null;
  if (AMBIGUOUS.has(from) && to === null && fromRaw !== from) return null;
  return { amount, from, to };
}

function parseTargets(raw, knownCodes) {
  const parts = raw.split(/\s*(?:,|\band\b|\bи\b)\s*/).filter(Boolean);
  const codes = parts.map((p) => lookupCurrency(p, knownCodes));
  return codes.every(Boolean) ? codes : [];
}

/** Converts using a table of rates relative to a common base (e.g. USD = 1). */
function convertCurrency(amount, from, to, rates) {
  const a = rates[from];
  const b = rates[to];
  if (!a || !b) return null;
  return (amount / a) * b;
}

module.exports = { parseCurrencyQuery, convertCurrency, lookupCurrency };
