'use strict';

// Quick conversions recognised directly in the query: number bases
// ("0xff", "255 to hex"), colours ("#ff8800", "rgb(10, 20, 30)") and Unix
// timestamps ("1700000000").

const BASES = { bin: 2, oct: 8, dec: 10, hex: 16 };
const BASE_ALIASES = {
  bin: 'bin', binary: 'bin', двоичн: 'bin', двоичная: 'bin', двоичную: 'bin', b: 'bin',
  oct: 'oct', octal: 'oct', восьмеричная: 'oct', восьмеричную: 'oct', o: 'oct',
  dec: 'dec', decimal: 'dec', десятичная: 'dec', десятичную: 'dec', d: 'dec',
  hex: 'hex', hexadecimal: 'hex', шестнадцатеричная: 'hex', шестнадцатеричную: 'hex', h: 'hex', x: 'hex',
};

function formatBase(n, base) {
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const s = abs.toString(BASES[base]);
  const prefix = { bin: '0b', oct: '0o', hex: '0x', dec: '' }[base];
  return (neg ? '-' : '') + prefix + (base === 'hex' ? s.toUpperCase() : s);
}

function parseBigInt(literal) {
  const m = /^(-)?(0x[0-9a-f]+|0b[01]+|0o[0-7]+|\d+)$/i.exec(literal.trim().replace(/_/g, ''));
  if (!m) return null;
  let n = BigInt(m[2].toLowerCase());
  if (m[1]) n = -n;
  return n;
}

/**
 * "0xff" -> all bases; "255 to hex" / "0b101 в dec" -> the requested base.
 * Returns { value: BigInt, results: [{ base, text }] } or null.
 */
function parseBaseQuery(query) {
  const q = String(query ?? '').trim().toLowerCase();
  let m = /^(-?(?:0x[0-9a-f_]+|0b[01_]+|0o[0-7_]+|\d+))\s+(?:to|in|в|во|->|→)\s+([a-zа-я]+)$/i.exec(q);
  if (m) {
    const value = parseBigInt(m[1]);
    const base = BASE_ALIASES[m[2]];
    if (value === null || !base) return null;
    return { value, results: [{ base, text: formatBase(value, base) }] };
  }
  m = /^-?0[xbo][0-9a-f_]+$/i.exec(q);
  if (m) {
    let value;
    try {
      value = parseBigInt(q);
    } catch {
      return null;
    }
    if (value === null) return null;
    const own = { x: 'hex', b: 'bin', o: 'oct' }[q.replace('-', '')[1]];
    return {
      value,
      results: ['dec', 'hex', 'bin', 'oct']
        .filter((b) => b !== own)
        .map((base) => ({ base, text: formatBase(value, base) })),
    };
  }
  return null;
}

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function hex2(n) {
  return n.toString(16).padStart(2, '0');
}

/**
 * Parses "#f80", "#ff8800", "#ff880080", "rgb(255, 136, 0)", "hsl(32, 100%, 50%)".
 * Returns { hex, rgb, hsl, alpha } strings or null.
 */
function parseColor(query) {
  const q = String(query ?? '').trim().toLowerCase();
  let r;
  let g;
  let b;
  let a = 1;
  let m = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(q);
  if (m && q.startsWith('#')) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
    if (h.length === 8) a = parseInt(h.slice(6, 8), 16) / 255;
  } else if ((m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(q))) {
    [r, g, b] = [m[1], m[2], m[3]].map((x) => clamp(parseInt(x, 10), 0, 255));
    if (m[4]) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  } else if ((m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(q))) {
    [r, g, b] = hslToRgb(parseFloat(m[1]) % 360, clamp(parseFloat(m[2]), 0, 100), clamp(parseFloat(m[3]), 0, 100));
    if (m[4]) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  } else {
    return null;
  }
  a = clamp(a, 0, 1);
  const [h, s, l] = rgbToHsl(r, g, b);
  const alphaHex = a < 1 ? hex2(Math.round(a * 255)) : '';
  const alphaStr = a < 1 ? ` / ${+a.toFixed(2)}` : '';
  return {
    hex: `#${hex2(r)}${hex2(g)}${hex2(b)}${alphaHex}`.toUpperCase(),
    rgb: `rgb(${r} ${g} ${b}${alphaStr})`,
    hsl: `hsl(${h} ${s}% ${l}%${alphaStr})`,
    css: `rgba(${r}, ${g}, ${b}, ${a})`,
  };
}

/**
 * "1700000000" (seconds) or "1700000000000" (ms) -> Date, only for plausible
 * dates between 2001 and 2100 so ordinary numbers are not misread.
 */
function parseTimestamp(query) {
  const q = String(query ?? '').trim();
  const m = /^(\d{10}|\d{13})$/.exec(q);
  if (!m) return null;
  const ms = q.length === 10 ? Number(q) * 1000 : Number(q);
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  if (year < 2001 || year > 2100) return null;
  return date;
}

module.exports = { parseBaseQuery, parseColor, parseTimestamp, formatBase, rgbToHsl, hslToRgb };
