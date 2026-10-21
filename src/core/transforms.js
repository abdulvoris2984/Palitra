'use strict';

// Text transformations applied to the clipboard ("ВЕРХНИЙ РЕГИСТР",
// "snake_case", "Исправить раскладку", "Base64", ...). Each entry is pure:
// fn(text) -> string. Main process wires them to clipboard commands.

const crypto = require('node:crypto');
const { fixLayout, transliterate } = require('./text');
const formats = require('./formats');

function words(s) {
  return (
    String(s)
      // split camelCase and digits boundaries, then on any non-alphanumerics
      .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
      .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
  );
}

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

function mapLines(s, fn) {
  return String(s).split(/\r?\n/).map(fn).join('\n');
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'и', 'в', 'на', 'с', 'по', 'для', 'или']);

function titleCase(s) {
  return mapLines(s, (line) => {
    let i = 0;
    return line.replace(/[\p{L}\p{N}']+/gu, (w) => {
      const first = i++ === 0;
      return !first && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : cap(w);
    });
  });
}

function sentenceCase(s) {
  return String(s)
    .toLowerCase()
    .replace(/(^\s*|[.!?…]\s+)(\p{L})/gu, (_, pre, ch) => pre + ch.toUpperCase());
}

function htmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function htmlUnescape(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return named[e.toLowerCase()] ?? m;
  });
}

function base64Decode(s) {
  const clean = String(s).trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error('Это не Base64');
  return Buffer.from(clean, 'base64').toString('utf8');
}

function hash(algo) {
  return (s) => crypto.createHash(algo).update(String(s), 'utf8').digest('hex');
}

function uniqueLines(s) {
  const seen = new Set();
  return String(s)
    .split(/\r?\n/)
    .filter((l) => (seen.has(l) ? false : (seen.add(l), true)))
    .join('\n');
}

function sortLines(s) {
  const collator = new Intl.Collator(['ru', 'en'], { numeric: true, sensitivity: 'base' });
  return String(s).split(/\r?\n/).sort(collator.compare).join('\n');
}

function stats(s) {
  const text = String(s);
  const wordsCount = (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;
  const lines = text === '' ? 0 : text.split(/\r?\n/).length;
  const chars = [...text].length;
  const noSpaces = [...text.replace(/\s/g, '')].length;
  const minutes = Math.max(1, Math.round(wordsCount / 200));
  return `Слов: ${wordsCount} · Символов: ${chars} (без пробелов: ${noSpaces}) · Строк: ${lines} · Чтение: ~${minutes} мин`;
}

function extract(re) {
  return (s) => [...new Set(String(s).match(re) || [])].join('\n');
}

/**
 * Registry. `id` is stable (used for frecency), `title` is shown in the UI,
 * `keywords` help search in both languages. `info: true` means the result is
 * informational and is shown rather than copied.
 */
const TRANSFORMS = [
  { id: 'upper', title: 'ВЕРХНИЙ РЕГИСТР', keywords: ['upper case', 'uppercase', 'caps', 'заглавные', 'верхний регистр'], fn: (s) => s.toUpperCase() },
  { id: 'lower', title: 'нижний регистр', keywords: ['lower case', 'lowercase', 'строчные', 'маленькие буквы'], fn: (s) => s.toLowerCase() },
  { id: 'title', title: 'Каждое Слово С Заглавной', keywords: ['title case', 'capitalize', 'заголовок'], fn: titleCase },
  { id: 'sentence', title: 'Как в предложении', keywords: ['sentence case', 'предложение'], fn: sentenceCase },
  { id: 'camel', title: 'camelCase', keywords: ['camel case', 'верблюжий'], fn: (s) => words(s).map((w, i) => (i ? cap(w) : w.toLowerCase())).join('') },
  { id: 'pascal', title: 'PascalCase', keywords: ['pascal case', 'upper camel'], fn: (s) => words(s).map(cap).join('') },
  { id: 'snake', title: 'snake_case', keywords: ['snake case', 'underscore', 'змеиный'], fn: (s) => words(s).map((w) => w.toLowerCase()).join('_') },
  { id: 'kebab', title: 'kebab-case', keywords: ['kebab case', 'dash case', 'slug', 'дефис'], fn: (s) => words(s).map((w) => w.toLowerCase()).join('-') },
  { id: 'constant', title: 'CONSTANT_CASE', keywords: ['constant case', 'screaming snake', 'константа'], fn: (s) => words(s).map((w) => w.toUpperCase()).join('_') },
  { id: 'fixLayout', title: 'Исправить раскладку (ghbdtn → привет)', keywords: ['fix layout', 'keyboard layout', 'punto switcher', 'раскладка', 'ghbdtn'], fn: fixLayout },
  { id: 'translit', title: 'Транслитерация (привет → privet)', keywords: ['transliterate', 'translit', 'латиница', 'транслит'], fn: transliterate },
  { id: 'trim', title: 'Убрать лишние пробелы', keywords: ['trim', 'whitespace', 'collapse spaces', 'пробелы'], fn: (s) => mapLines(s, (l) => l.replace(/[ \t ]+/g, ' ').trim()).replace(/\n{3,}/g, '\n\n').trim() },
  { id: 'joinLines', title: 'Склеить строки в одну', keywords: ['join lines', 'remove line breaks', 'unwrap', 'переносы строк'], fn: (s) => String(s).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(' ') },
  { id: 'sortLines', title: 'Сортировать строки', keywords: ['sort lines', 'alphabetical', 'по алфавиту', 'сортировка'], fn: sortLines },
  { id: 'uniqueLines', title: 'Удалить повторяющиеся строки', keywords: ['unique lines', 'dedupe', 'remove duplicates', 'дубликаты'], fn: uniqueLines },
  { id: 'reverseLines', title: 'Перевернуть порядок строк', keywords: ['reverse lines', 'обратный порядок'], fn: (s) => String(s).split(/\r?\n/).reverse().join('\n') },
  { id: 'reverse', title: 'Текст задом наперёд', keywords: ['reverse text', 'mirror', 'наоборот'], fn: (s) => [...String(s)].reverse().join('') },
  { id: 'b64enc', title: 'Base64: закодировать', keywords: ['base64 encode', 'b64', 'кодировать'], fn: (s) => Buffer.from(String(s), 'utf8').toString('base64') },
  { id: 'b64dec', title: 'Base64: декодировать', keywords: ['base64 decode', 'b64', 'декодировать'], fn: base64Decode },
  { id: 'urlenc', title: 'URL: закодировать', keywords: ['url encode', 'percent encode', 'uri'], fn: (s) => encodeURIComponent(String(s)) },
  { id: 'urldec', title: 'URL: декодировать', keywords: ['url decode', 'percent decode', 'uri'], fn: (s) => decodeURIComponent(String(s).replace(/\+/g, ' ')) },
  { id: 'htmlEsc', title: 'HTML: экранировать', keywords: ['html escape', 'entities', 'encode html'], fn: htmlEscape },
  { id: 'htmlUnesc', title: 'HTML: снять экранирование', keywords: ['html unescape', 'entities', 'decode html'], fn: htmlUnescape },
  { id: 'jsonPretty', title: 'JSON: форматировать', keywords: ['json pretty', 'format json', 'beautify', 'prettify'], fn: (s) => JSON.stringify(JSON.parse(s), null, 2) },
  { id: 'jsonMin', title: 'JSON: в одну строку (minify)', keywords: ['json minify', 'compact json'], fn: (s) => JSON.stringify(JSON.parse(s)) },
  { id: 'jsonToYaml', title: 'JSON → YAML', keywords: ['json to yaml', 'yml', 'convert'], fn: formats.jsonToYaml },
  { id: 'yamlToJson', title: 'YAML → JSON', keywords: ['yaml to json', 'yml', 'convert'], fn: formats.yamlToJson },
  { id: 'csvToJson', title: 'CSV → JSON', keywords: ['csv to json', 'table', 'таблица', 'convert'], fn: formats.csvToJson },
  { id: 'jsonToCsv', title: 'JSON → CSV', keywords: ['json to csv', 'table', 'таблица', 'excel', 'convert'], fn: formats.jsonToCsv },
  { id: 'mdToHtml', title: 'Markdown → HTML', keywords: ['markdown to html', 'md', 'convert'], fn: formats.markdownToHtml },
  { id: 'md5', title: 'Хэш MD5', keywords: ['md5', 'hash', 'checksum', 'хеш'], fn: hash('md5') },
  { id: 'sha1', title: 'Хэш SHA-1', keywords: ['sha1', 'hash', 'checksum', 'хеш'], fn: hash('sha1') },
  { id: 'sha256', title: 'Хэш SHA-256', keywords: ['sha256', 'hash', 'checksum', 'хеш'], fn: hash('sha256') },
  { id: 'urls', title: 'Извлечь ссылки', keywords: ['extract urls', 'links', 'ссылки', 'url'], fn: extract(/https?:\/\/[^\s<>"')\]]+/g) },
  { id: 'emails', title: 'Извлечь e-mail адреса', keywords: ['extract emails', 'email', 'почта'], fn: extract(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) },
  { id: 'stats', title: 'Посчитать слова и символы', keywords: ['word count', 'character count', 'stats', 'статистика', 'количество слов'], fn: stats, info: true },
];

function applyTransform(id, text) {
  const t = TRANSFORMS.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown transform ${id}`);
  return t.fn(String(text ?? ''));
}

module.exports = { TRANSFORMS, applyTransform, words };
