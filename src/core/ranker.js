'use strict';

const { prepareQuery, matchItem } = require('./fuzzy');

/**
 * Ranks items for a query. Final score (points):
 *   fuzzy match quality * 100   (0..100)
 *   + frecency bonus            (0..22)  used often & recently
 *   + query bonus               (0..18)  picked before for this query
 *   + item.bias                 (provider-specific nudge, e.g. files -6)
 */
function rankItems(query, items, frecency, opts = {}) {
  const PQ = prepareQuery(query);
  if (!PQ.variants.length) return [];
  const out = [];
  for (const item of items) {
    const m = matchItem(PQ, item, opts);
    if (!m) continue;
    const fb = frecency ? frecency.bonus(item.id) : 0;
    const qb = frecency ? frecency.queryBonus(item.id, query) : 0;
    out.push({
      item,
      score: m.score * 100 + fb + qb + (item.bias || 0),
      match: m.score,
      ranges: m.ranges,
    });
  }
  out.sort((a, b) => b.score - a.score || a.item.title.length - b.item.title.length);
  return out;
}

module.exports = { rankItems };
