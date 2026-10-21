'use strict';

// Translation via the public Google Translate endpoint with MyMemory as a
// fallback. Only runs for queries with an explicit prefix ("tr ..."), so
// nothing you type is sent anywhere unless you ask for a translation.

const A = require('../actions');
const { parseTranslateQuery, chooseTargets, LANGUAGES } = require('../../core/translate-query');
const { hasCyrillic } = require('../../core/text');

const cache = new Map();

async function googleTranslate(fetch, text, target) {
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t' +
    `&tl=${encodeURIComponent(target)}&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, { timeoutMs: 6000 });
  if (!res.ok) throw new Error(`Google HTTP ${res.status}`);
  const json = await res.json();
  const translated = (json[0] || []).map((part) => part[0] || '').join('');
  return { text: translated, source: json[2] || null };
}

async function myMemoryTranslate(fetch, text, target) {
  const source = hasCyrillic(text) ? 'ru' : 'en';
  if (source === target) return { text, source };
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${source}|${target}`;
  const res = await fetch(url, { timeoutMs: 6000 });
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
  const json = await res.json();
  return { text: json.responseData?.translatedText || '', source };
}

async function translate(fetch, text, target) {
  const key = `${target}\u0000${text}`;
  if (cache.has(key)) return cache.get(key);
  let result;
  try {
    result = await googleTranslate(fetch, text, target);
  } catch (err) {
    console.warn('[palitra] google translate failed, trying MyMemory:', err.message);
    result = await myMemoryTranslate(fetch, text, target);
  }
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}

function langName(code) {
  return LANGUAGES[code] ? `${code.toUpperCase()}` : String(code || '?').toUpperCase();
}

function createTranslate(ctx) {
  return {
    name: 'translate',
    parse: parseTranslateQuery,
    /** Placeholder rows shown immediately while the request is running. */
    pending(parsed) {
      if (!parsed.text) {
        return [
          {
            id: 'translate:hint',
            title: 'Введите текст для перевода',
            subtitle: 'tr привет мир · tr it: good morning · tr>de,fr hello',
            icon: 'translate',
            category: 'Перевод',
            dynamic: true,
            score: 1000,
            actions: [],
          },
        ];
      }
      const targets = chooseTargets(parsed.text, parsed.targets, ctx.config.settings.translate.targets);
      return targets.map((t, i) => ({
        id: `translate:${t}`,
        title: 'Перевожу…',
        subtitle: `→ ${LANGUAGES[t] || t}`,
        icon: 'translate',
        category: 'Перевод',
        dynamic: true,
        loading: true,
        score: 1000 - i,
        actions: [],
      }));
    },
    async queryAsync(parsed) {
      if (!parsed.text) return null;
      const targets = chooseTargets(parsed.text, parsed.targets, ctx.config.settings.translate.targets);
      const results = await Promise.all(
        targets.map(async (t, i) => {
          try {
            const r = await translate(ctx.fetch, parsed.text, t);
            return { t, i, r };
          } catch (err) {
            return { t, i, err };
          }
        }),
      );
      const webUrl = (t) => `https://translate.google.com/?sl=auto&tl=${t}&text=${encodeURIComponent(parsed.text)}&op=translate`;
      return results
        // Skip "English -> English" unless that target was asked for explicitly.
        .filter(({ t, r }) => !r || !r.source || r.source !== t || (parsed.targets && parsed.targets.includes(t)))
        .map(({ t, i, r, err }) => {
          if (err) {
            return {
              id: `translate:${t}`,
              title: 'Не удалось перевести',
              subtitle: `${err.message} · проверьте подключение к интернету`,
              icon: 'translate',
              category: 'Перевод',
              dynamic: true,
              score: 1000 - i,
              actions: [A.openUrl(webUrl(t), 'Открыть Google Translate')],
            };
          }
          const long = r.text.length > 90 || r.text.includes('\n');
          return {
            id: `translate:${t}`,
            title: r.text,
            subtitle: `${langName(r.source)} → ${LANGUAGES[t] || t} · Enter — скопировать`,
            icon: 'translate',
            category: 'Перевод',
            dynamic: true,
            detail: long ? r.text : undefined,
            score: 1000 - i,
            actions: [A.copy(r.text, 'Скопировать перевод'), A.paste(r.text, 'Вставить перевод'), A.openUrl(webUrl(t), 'Открыть в Google Translate')],
          };
        });
    },
  };
}

module.exports = { createTranslate, translate };
