'use strict';

// Typo-tolerant fuzzy matcher.
//
// A query is matched against a target string in several stages, from the most
// to the least strict, and the best stage wins:
//   1. exact / prefix of the whole target         (0.95 - 1.0)
//   2. acronym ("cc" -> "Camel Case")               (0.86)
//   3. whole query as a substring                  (0.74 - 0.84)
//   4. every query token matches some word: word prefix, substring,
//      prefix with typos (Damerau-Levenshtein) or subsequence  (0.35 - 0.95)
//   5. subsequence of the whole query (fzf-style)  (0.30 - 0.60)
// Queries are also tried in the other keyboard layout ("ghbdtn" -> "привет").
// All scores are in [0, 1]; ranges are [start, end) indices for highlighting.

const { normalize, enToRu, ruToEn, hasCyrillic, hasLatin } = require('./text');

const MIN_SCORE = 0.3;
const MAX_LEN = 64;

const ALNUM = /[\p{L}\p{N}]/u;
const UPPER = /\p{Lu}/u;
const LOWER = /\p{Ll}/u;
const DIGIT = /\p{N}/u;

function isAlnum(ch) {
  return ALNUM.test(ch);
}

function isBoundary(orig, i) {
  const a = orig[i - 1];
  const b = orig[i];
  if (LOWER.test(a) && UPPER.test(b)) return true; // camelCase
  return DIGIT.test(a) !== DIGIT.test(b); // file2name, mp3
}

/** Pre-computes everything about a target string that does not depend on the query. */
function prepare(text) {
  const orig = String(text ?? '');
  const norm = normalize(orig);
  const words = [];
  let i = 0;
  while (i < norm.length) {
    if (!isAlnum(norm[i])) {
      i++;
      continue;
    }
    const start = i++;
    while (i < norm.length && isAlnum(norm[i]) && !isBoundary(orig, i)) i++;
    words.push({ start, end: i, text: norm.slice(start, i) });
  }
  const initials = words.map((w) => w.text[0]).join('');
  return { orig, norm, words, initials };
}

// Optimal-string-alignment distance (Damerau-Levenshtein with adjacent
// transpositions), bailing out early once the distance exceeds `max`.
const ROWS = [new Int32Array(MAX_LEN + 2), new Int32Array(MAX_LEN + 2), new Int32Array(MAX_LEN + 2)];

function osaDistance(a, b, max) {
  if (a.length > MAX_LEN) a = a.slice(0, MAX_LEN);
  if (b.length > MAX_LEN) b = b.slice(0, MAX_LEN);
  const n = a.length;
  const m = b.length;
  if (Math.abs(n - m) > max) return max + 1;
  let prev2 = ROWS[0];
  let prev = ROWS[1];
  let cur = ROWS[2];
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    let rowMin = i;
    const ai = a[i - 1];
    for (let j = 1; j <= m; j++) {
      const cost = ai === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && ai === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = prev2;
    prev2 = prev;
    prev = cur;
    cur = t;
  }
  return prev[m];
}

/** How many typos a token of a given length may contain. */
function allowedTypos(len, strict) {
  if (strict) return len <= 4 ? 0 : len <= 8 ? 1 : 2;
  return len <= 3 ? 0 : len <= 6 ? 1 : len <= 9 ? 2 : 3;
}

function subsequence(query, target, words) {
  // fzf-like: try a few start positions (word starts first), match greedily,
  // and reward consecutive characters and characters at word starts.
  const m = query.length;
  if (m === 0 || m > target.length) return null;
  const wordStart = new Set(words.map((w) => w.start));
  const starts = [];
  for (let i = 0; i < target.length && starts.length < 12; i++) {
    if (target[i] === query[0]) starts.push(i);
  }
  starts.sort((x, y) => Number(wordStart.has(y)) - Number(wordStart.has(x)));

  let best = null;
  for (const s of starts.slice(0, 6)) {
    const pos = [s];
    let j = s + 1;
    for (let k = 1; k < m; k++) {
      while (j < target.length && target[j] !== query[k]) j++;
      if (j >= target.length) break;
      pos.push(j++);
    }
    if (pos.length !== m) continue;
    let consecutive = 0;
    let boundary = 0;
    for (let k = 0; k < m; k++) {
      if (k > 0 && pos[k] === pos[k - 1] + 1) consecutive++;
      if (wordStart.has(pos[k])) boundary++;
    }
    const span = pos[m - 1] - pos[0] + 1;
    const quality =
      0.45 * (m > 1 ? consecutive / (m - 1) : 1) + 0.35 * (boundary / m) + 0.2 * (m / span);
    if (!best || quality > best.quality) best = { quality, pos };
  }
  if (!best) return null;
  return { quality: best.quality, ranges: positionsToRanges(best.pos) };
}

// "vscode" -> "Visual Studio Code": the query split into consecutive pieces,
// each a prefix of successive (not necessarily adjacent) words.
function wordPrefixChain(q, words) {
  if (words.length > 24) words = words.slice(0, 24);
  const memo = new Map();
  const solve = (qi, wi) => {
    if (qi === q.length) return [];
    const key = qi * 32 + wi;
    if (memo.has(key)) return memo.get(key);
    let res = null;
    for (let w = wi; w < words.length && !res; w++) {
      const text = words[w].text;
      if (text[0] !== q[qi]) continue;
      let len = 0;
      while (len < text.length && qi + len < q.length && text[len] === q[qi + len]) len++;
      for (; len >= 1 && !res; len--) {
        const rest = solve(qi + len, w + 1);
        if (rest) res = [[words[w].start, words[w].start + len], ...rest];
      }
    }
    memo.set(key, res);
    return res;
  };
  return solve(0, 0);
}

function positionsToRanges(pos) {
  const ranges = [];
  for (const p of pos) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === p) last[1] = p + 1;
    else ranges.push([p, p + 1]);
  }
  return ranges;
}

function scoreToken(tok, P, opts) {
  let best = null;
  const consider = (score, ranges) => {
    if (!best || score > best.score) best = { score, ranges };
  };

  for (const w of P.words) {
    if (w.text === tok) {
      consider(1, [[w.start, w.end]]);
    } else if (w.text.startsWith(tok)) {
      consider(0.88 + 0.07 * (tok.length / w.text.length), [[w.start, w.start + tok.length]]);
    }
  }
  if (best && best.score >= 0.88) return best;

  if (tok.length >= 2) {
    const idx = P.norm.indexOf(tok);
    if (idx >= 0) consider(0.72, [[idx, idx + tok.length]]);
  }

  if (opts.typo !== false && tok.length >= 3 && (!best || best.score < 0.66)) {
    const max = allowedTypos(tok.length, opts.typo === 'strict');
    if (max > 0) {
      for (const w of P.words) {
        if (w.text.length < 2) continue;
        let d = max + 1;
        let usedLen = 0;
        // Compare with prefixes of the word one char shorter/longer as well, so
        // that a missing or an extra letter still counts as a single typo.
        for (const len of [tok.length, tok.length - 1, tok.length + 1]) {
          if (len < 2 || len > w.text.length) continue;
          const dd = osaDistance(tok, w.text.slice(0, len), Math.min(d - 1, max));
          if (dd < d) {
            d = dd;
            usedLen = len;
          }
        }
        if (w.text.length < tok.length - 1) {
          const dd = osaDistance(tok, w.text, Math.min(d - 1, max));
          if (dd < d) {
            d = dd;
            usedLen = w.text.length;
          }
        }
        // A wrong first letter is a rarer typo: allow one error less for it.
        const firstDiffers = tok[0] !== w.text[0];
        if (d <= max - (firstDiffers ? 1 : 0)) {
          consider(0.66 - 0.1 * (d - 1) - (firstDiffers ? 0.04 : 0), [[w.start, w.start + usedLen]]);
        }
      }
    }
  }

  if (!best && tok.length >= 2) {
    // Scattered letters only count when they start at a word and mostly cluster.
    const sub = subsequence(tok, P.norm, P.words);
    if (sub && sub.quality >= 0.5 && P.words.some((w) => w.start === sub.ranges[0][0])) {
      consider(0.3 + 0.25 * sub.quality, sub.ranges);
    }
  }
  return best;
}

function mergeRanges(ranges) {
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/**
 * Scores one prepared query variant against one prepared target.
 * Returns { score, ranges } or null when it does not match at all.
 */
function scorePrepared(Q, P, opts = {}) {
  const q = Q.norm;
  if (!q) return null;
  const t = P.norm;
  let best = null;
  const consider = (score, ranges) => {
    if (!best || score > best.score) best = { score, ranges };
  };

  if (t === q) return { score: 1, ranges: [[0, t.length]] };
  if (t.startsWith(q)) consider(0.95 + 0.04 * (q.length / t.length), [[0, q.length]]);

  if (Q.compact.length >= 2 && P.initials.startsWith(Q.compact)) {
    consider(
      0.86,
      P.words.slice(0, Q.compact.length).map((w) => [w.start, w.start + 1]),
    );
  }

  if (Q.compact.length >= 3 && (!best || best.score < 0.84)) {
    const chain = wordPrefixChain(Q.compact, P.words);
    if (chain && chain.length > 1) consider(0.85 - 0.01 * Math.min(chain.length, 6), chain);
  }

  if (q.length >= 2 && (!best || best.score < 0.84)) {
    const idx = t.indexOf(q);
    if (idx >= 0) {
      const atWord = P.words.some((w) => w.start === idx);
      consider(atWord ? 0.84 : 0.74, [[idx, idx + q.length]]);
    }
  }

  if (!best || best.score < 0.9) {
    let total = 0;
    let ok = true;
    const ranges = [];
    let inOrder = true;
    let lastStart = -1;
    for (const tok of Q.tokens) {
      const r = scoreToken(tok, P, opts);
      if (!r) {
        ok = false;
        break;
      }
      total += r.score;
      ranges.push(...r.ranges);
      if (r.ranges[0][0] < lastStart) inOrder = false;
      lastStart = r.ranges[0][0];
    }
    if (ok && Q.tokens.length) {
      let s = total / Q.tokens.length;
      if (Q.tokens.length > 1) s = inOrder ? s : s - 0.03;
      consider(Math.min(s, 0.95), mergeRanges(ranges));
    }
  }

  if (!best && Q.compact.length >= 2) {
    const sub = subsequence(Q.compact, t, P.words);
    if (sub && sub.quality >= 0.3 && P.words.some((w) => w.start === sub.ranges[0][0])) {
      consider(0.3 + 0.3 * sub.quality, sub.ranges);
    }
  }

  if (!best) return null;
  // Tiny preference for shorter targets so that "Code" beats "Code Insiders".
  best.score -= Math.min(0.02, Math.max(0, t.length - q.length) * 0.0005);
  return best;
}

function prepareVariant(text, mult) {
  const norm = normalize(text).replace(/\s+/g, ' ').trim();
  const tokens = norm.split(' ').filter(Boolean);
  return { norm, tokens, compact: tokens.join(''), mult };
}

/**
 * Prepares a user query: the query itself plus the same keystrokes
 * interpreted in the other keyboard layout (slightly penalised).
 */
function prepareQuery(query) {
  const raw = String(query ?? '');
  const variants = [prepareVariant(raw, 1)];
  if (hasLatin(raw)) variants.push(prepareVariant(enToRu(raw), 0.93));
  if (hasCyrillic(raw)) variants.push(prepareVariant(ruToEn(raw), 0.93));
  return { raw, variants: variants.filter((v) => v.norm.length > 0) };
}

/** Lazily prepares and caches the searchable fields of an item. */
function itemFields(item) {
  if (!item._fuzzy) {
    item._fuzzy = {
      title: prepare(item.title),
      keywords: (item.keywords || []).map(prepare),
    };
  }
  return item._fuzzy;
}

/**
 * Matches a prepared query against an item ({ title, keywords }).
 * Title matches carry highlight ranges; keyword matches are slightly weaker.
 */
function matchItem(PQ, item, opts = {}) {
  const fields = itemFields(item);
  let best = null;
  for (const V of PQ.variants) {
    const r = scorePrepared(V, fields.title, opts);
    if (r) {
      const s = r.score * V.mult;
      if (!best || s > best.score) best = { score: s, ranges: r.ranges };
    }
    for (const K of fields.keywords) {
      const k = scorePrepared(V, K, opts);
      if (k) {
        const s = k.score * V.mult * 0.93;
        if (!best || s > best.score) best = { score: s, ranges: [] };
      }
    }
  }
  if (!best || best.score < (opts.minScore ?? MIN_SCORE)) return null;
  return best;
}

/** Convenience wrapper: score a raw query against a raw string. */
function fuzzyScore(query, text, opts) {
  return matchItem(prepareQuery(query), { title: text }, opts);
}

module.exports = {
  prepare,
  prepareQuery,
  matchItem,
  fuzzyScore,
  osaDistance,
  MIN_SCORE,
};
