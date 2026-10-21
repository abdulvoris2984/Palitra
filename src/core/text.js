'use strict';

// Text helpers shared by search and text transforms: normalisation that keeps
// string indices stable (so highlight positions survive), keyboard-layout
// switching (RU ЙЦУКЕН <-> EN QWERTY) and Russian transliteration.

const EN_KEYS = "`qwertyuiop[]asdfghjkl;'zxcvbnm,./~QWERTYUIOP{}ASDFGHJKL:\"ZXCVBNM<>?@#$^&";
const RU_KEYS = 'ёйцукенгшщзхъфывапролджэячсмитьбю.ЁЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮ,"№;:?';

const EN_TO_RU = new Map();
const RU_TO_EN = new Map();
for (let i = 0; i < EN_KEYS.length; i++) {
  EN_TO_RU.set(EN_KEYS[i], RU_KEYS[i]);
  RU_TO_EN.set(RU_KEYS[i], EN_KEYS[i]);
}

const CYRILLIC = /[Ѐ-ӿ]/;
const LATIN = /[a-zA-Z]/;

function hasCyrillic(s) {
  return CYRILLIC.test(s);
}

function hasLatin(s) {
  return LATIN.test(s);
}

function mapChars(s, table) {
  let out = '';
  for (const ch of s) out += table.get(ch) ?? ch;
  return out;
}

/** Text typed on the English layout while meaning Russian: "ghbdtn" -> "привет". */
function enToRu(s) {
  return mapChars(s, EN_TO_RU);
}

/** Text typed on the Russian layout while meaning English: "руддщ" -> "hello". */
function ruToEn(s) {
  return mapChars(s, RU_TO_EN);
}

/**
 * Fixes text typed in the wrong layout. The direction is guessed from which
 * script dominates: mostly-Cyrillic text is converted to Latin and vice versa.
 */
function fixLayout(s) {
  let cyr = 0;
  let lat = 0;
  for (const ch of s) {
    if (CYRILLIC.test(ch)) cyr++;
    else if (LATIN.test(ch)) lat++;
  }
  return cyr > lat ? ruToEn(s) : enToRu(s);
}

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

/** Russian -> Latin transliteration that keeps the capitalisation of each letter. */
function transliterate(s) {
  let out = '';
  for (const ch of s) {
    const lower = ch.toLowerCase();
    const t = TRANSLIT[lower];
    if (t === undefined) {
      out += ch;
    } else if (ch !== lower && t.length > 0) {
      out += t[0].toUpperCase() + t.slice(1);
    } else {
      out += t;
    }
  }
  return out;
}

const normCache = new Map();

function normChar(ch) {
  let n = normCache.get(ch);
  if (n !== undefined) return n;
  const lower = ch.toLowerCase();
  const stripped = lower.normalize('NFKD').replace(/\p{M}/gu, '');
  n = stripped.length === 1 ? stripped : lower.length === 1 ? lower : ch;
  // "й" decomposes to "и" + breve; keep it distinct because it is its own letter.
  if (lower === 'й') n = 'й';
  if (normCache.size < 4096) normCache.set(ch, n);
  return n;
}

/**
 * Lower-cases and strips diacritics character by character, guaranteeing that
 * the output has exactly the same length as the input (code units), so that
 * indices into the normalised string are valid indices into the original.
 */
function normalize(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) out += normChar(s[i]);
  return out;
}

module.exports = {
  enToRu,
  ruToEn,
  fixLayout,
  transliterate,
  normalize,
  hasCyrillic,
  hasLatin,
};
