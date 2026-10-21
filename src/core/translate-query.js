'use strict';

const { hasCyrillic } = require('./text');

const LANGUAGES = {
  en: 'English',
  ru: 'Русский',
  it: 'Italiano',
  uz: "O'zbek",
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  pt: 'Português',
  uk: 'Українська',
  kk: 'Қазақ',
  tr: 'Türkçe',
  pl: 'Polski',
  zh: '中文',
  ja: '日本語',
  ko: '한국어',
  ar: 'العربية',
};

const PREFIXES = ['tr', 'пер'];

/**
 * Recognises translation queries:
 *   "tr hello world"        -> auto source, default targets
 *   "tr it: good morning"   -> into Italian
 *   "tr>it good morning"    -> into Italian
 *   "tr en,ru: ciao"        -> into English and Russian
 * Returns { text, targets: [codes] | null } or null.
 */
function parseTranslateQuery(query) {
  const q = String(query ?? '').replace(/^\s+/, '');
  const m = /^(\S+?)(?:\s*>\s*([a-z]{2}(?:\s*,\s*[a-z]{2})*)\s+|\s+)([\s\S]*)$/i.exec(q);
  if (!m || !PREFIXES.includes(m[1].toLowerCase())) return null;
  let targets = m[2] ? m[2].split(/\s*,\s*/).map((x) => x.toLowerCase()) : null;
  let text = m[3];
  if (!targets) {
    const lm = /^([a-z]{2}(?:\s*,\s*[a-z]{2})*)\s*:\s*([\s\S]*)$/i.exec(text);
    if (lm) {
      targets = lm[1].split(/\s*,\s*/).map((x) => x.toLowerCase());
      text = lm[2];
    }
  }
  if (targets && !targets.every((t) => LANGUAGES[t])) return null;
  return { text: text.trim(), targets };
}

/**
 * Picks target languages for a text: explicit ones, otherwise the configured
 * list without the (guessed) source language.
 */
function chooseTargets(text, explicit, configured) {
  if (explicit && explicit.length) return explicit;
  const source = hasCyrillic(text) ? 'ru' : null;
  const list = (configured && configured.length ? configured : ['ru', 'en']).filter((t) => t !== source);
  return list.length ? list : ['en'];
}

module.exports = { parseTranslateQuery, chooseTargets, LANGUAGES, PREFIXES };
