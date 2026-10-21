'use strict';

// Text-based format conversions (CSV, JSON, YAML, Markdown). Used both for
// clipboard transforms and for converting files.

const yaml = require('js-yaml');
const { marked } = require('marked');

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = 0;
  for (const d of candidates) {
    // count delimiters outside quotes
    let count = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** RFC 4180-ish CSV parser: quoted fields, escaped quotes, CRLF, custom delimiter. */
function parseCsv(text, delimiter) {
  const src = String(text).replace(/^﻿/, '');
  const d = delimiter || detectDelimiter(src);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === d) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function coerce(v) {
  if (v === '') return v;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(v)) return Number(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

function csvToJson(text) {
  const rows = parseCsv(text);
  if (!rows.length) return '[]';
  const header = rows[0].map((h, i) => h.trim() || `column${i + 1}`);
  const out = rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, i) => {
      obj[h] = coerce(r[i] ?? '');
    });
    return obj;
  });
  return JSON.stringify(out, null, 2);
}

function csvEscape(v, d) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /["\r\n]/.test(s) || s.includes(d) ? `"${s.replace(/"/g, '""')}"` : s;
}

function jsonToCsv(text, delimiter = ',') {
  let data = JSON.parse(text);
  if (!Array.isArray(data)) {
    // { "rows": [...] } or a single object
    const arr = Object.values(data).find(Array.isArray);
    data = arr || [data];
  }
  if (data.every(Array.isArray)) {
    return data.map((r) => r.map((v) => csvEscape(v, delimiter)).join(delimiter)).join('\n');
  }
  const keys = [];
  const seen = new Set();
  for (const row of data) {
    if (row && typeof row === 'object') {
      for (const k of Object.keys(row)) {
        if (!seen.has(k)) {
          seen.add(k);
          keys.push(k);
        }
      }
    }
  }
  const lines = [keys.map((k) => csvEscape(k, delimiter)).join(delimiter)];
  for (const row of data) {
    const obj = row && typeof row === 'object' ? row : { value: row };
    lines.push(keys.map((k) => csvEscape(obj[k], delimiter)).join(delimiter));
  }
  return lines.join('\n');
}

function jsonToYaml(text) {
  return yaml.dump(JSON.parse(text), { lineWidth: 120, noRefs: true });
}

function yamlToJson(text) {
  return JSON.stringify(yaml.load(text), null, 2);
}

function markdownToHtml(text) {
  return marked.parse(String(text), { async: false, gfm: true }).trim();
}

function markdownToHtmlDocument(text, title = 'Document') {
  const body = markdownToHtml(text);
  const safeTitle = String(title).replace(/[<&>]/g, '');
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
  body { max-width: 760px; margin: 40px auto; padding: 0 16px; font: 16px/1.6 system-ui, sans-serif; color: #1d1d1f; }
  pre, code { font-family: ui-monospace, Menlo, Consolas, monospace; background: #f4f4f6; border-radius: 6px; }
  pre { padding: 12px; overflow: auto; } code { padding: 1px 4px; }
  table { border-collapse: collapse; } td, th { border: 1px solid #ddd; padding: 4px 8px; }
  img { max-width: 100%; }
  @media (prefers-color-scheme: dark) { body { background: #17171a; color: #e8e8ea; } pre, code { background: #24242a; } }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

module.exports = {
  parseCsv,
  csvToJson,
  jsonToCsv,
  jsonToYaml,
  yamlToJson,
  markdownToHtml,
  markdownToHtmlDocument,
};
