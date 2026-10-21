'use strict';

// "Frecency" = frequency + recency. Every use of a command is remembered with
// a timestamp; each use contributes 0.5^(age / halfLife), so a command used
// five times today outranks one used fifty times last year. On top of that we
// learn which command the user picks for a given query ("tr" -> Translate),
// the way browsers learn URL-bar shortcuts.

const DAY = 24 * 60 * 60 * 1000;

function normQuery(q) {
  return String(q ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

class Frecency {
  constructor(data = {}, options = {}) {
    this.halfLife = (options.halfLifeDays ?? 5) * DAY;
    this.maxUses = options.maxUses ?? 25;
    this.maxQueries = options.maxQueries ?? 800;
    this.now = options.now ?? (() => Date.now());
    this.items = new Map(Object.entries(data.items || {}));
    this.queries = new Map(Object.entries(data.queries || {}));
  }

  /** Remembers that `id` was chosen, optionally after typing `query`. */
  record(id, query) {
    const now = this.now();
    const entry = this.items.get(id) || { count: 0, uses: [] };
    entry.count += 1;
    entry.uses.push(now);
    if (entry.uses.length > this.maxUses) entry.uses.splice(0, entry.uses.length - this.maxUses);
    this.items.set(id, entry);

    const q = normQuery(query);
    if (q) {
      const qe = this.queries.get(q) || { ts: 0, ids: {} };
      qe.ts = now;
      qe.ids[id] = (qe.ids[id] || 0) + 1;
      this.queries.delete(q); // re-insert to keep Map order = recency order
      this.queries.set(q, qe);
      while (this.queries.size > this.maxQueries) {
        this.queries.delete(this.queries.keys().next().value);
      }
    }
  }

  /** Raw frecency value: decayed sum of uses plus a little for lifetime count. */
  value(id) {
    const entry = this.items.get(id);
    if (!entry) return 0;
    const now = this.now();
    let v = 0;
    for (const ts of entry.uses) v += Math.pow(0.5, Math.max(0, now - ts) / this.halfLife);
    return v + 0.3 * Math.log1p(entry.count);
  }

  /** Ranking bonus in points (0..22) derived from frecency. */
  bonus(id) {
    const v = this.value(id);
    return v > 0 ? 22 * (1 - Math.exp(-v / 3)) : 0;
  }

  /**
   * Bonus (0..18) when the user previously picked `id` for this exact query
   * or for a longer query that starts with it.
   */
  queryBonus(id, query) {
    const q = normQuery(query);
    if (!q) return 0;
    let w = 0;
    const exact = this.queries.get(q);
    if (exact && exact.ids[id]) w += exact.ids[id];
    if (q.length <= 12) {
      for (const [k, qe] of this.queries) {
        if (k !== q && k.startsWith(q) && qe.ids[id]) w += 0.5 * qe.ids[id];
      }
    }
    return w > 0 ? 18 * (1 - Math.exp(-w / 1.5)) : 0;
  }

  /** Ids sorted by frecency, highest first. */
  top(limit = 10, filter = () => true) {
    return [...this.items.keys()]
      .filter(filter)
      .map((id) => [id, this.value(id)])
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);
  }

  lastUsed(id) {
    const entry = this.items.get(id);
    return entry && entry.uses.length ? entry.uses[entry.uses.length - 1] : 0;
  }

  forget(id) {
    this.items.delete(id);
    for (const qe of this.queries.values()) delete qe.ids[id];
  }

  clear() {
    this.items.clear();
    this.queries.clear();
  }

  toJSON() {
    return {
      items: Object.fromEntries(this.items),
      queries: Object.fromEntries(this.queries),
    };
  }
}

module.exports = { Frecency, normQuery };
