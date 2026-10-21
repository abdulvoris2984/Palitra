'use strict';

// Currency conversion with live rates from open.er-api.com (free, no key,
// updated daily), falling back to the fawazahmed0 currency-api on jsDelivr.
// Rates are cached for 6 hours and persisted to disk so the converter keeps
// working offline with the last known rates.

const path = require('node:path');
const A = require('../actions');
const { parseCurrencyQuery, convertCurrency } = require('../../core/currency');
const { formatNumber } = require('../../core/calculator');
const { readJson, writeJson } = require('../store');

const TTL = 6 * 60 * 60 * 1000;

const SOURCES = [
  {
    url: 'https://open.er-api.com/v6/latest/USD',
    parse(json) {
      if (json.result !== 'success' || !json.rates) throw new Error('bad response');
      return { rates: json.rates, updated: json.time_last_update_utc };
    },
  },
  {
    url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    parse(json) {
      if (!json.usd) throw new Error('bad response');
      const rates = {};
      for (const [code, v] of Object.entries(json.usd)) {
        if (/^[a-z]{3}$/.test(code) && typeof v === 'number') rates[code.toUpperCase()] = v;
      }
      rates.USD = 1;
      return { rates, updated: json.date };
    },
  },
];

/** Downloads USD-based rates, trying each source in turn. */
async function fetchRates(fetch) {
  const errors = [];
  for (const src of SOURCES) {
    try {
      const res = await fetch(src.url, { timeoutMs: 6000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return src.parse(await res.json());
    } catch (err) {
      errors.push(err.message);
    }
  }
  throw new Error(errors.join('; '));
}

function createCurrency(ctx) {
  const cacheFile = path.join(ctx.paths.data, 'rates.json');
  let cache = readJson(cacheFile, null);
  let inflight = null;

  async function getRates() {
    if (cache && Date.now() - cache.fetchedAt < TTL) return cache;
    if (!inflight) {
      inflight = (async () => {
        try {
          const { rates, updated } = await fetchRates(ctx.fetch);
          cache = { fetchedAt: Date.now(), updated, rates };
          writeJson(cacheFile, cache);
        } catch (err) {
          if (!cache) throw err;
          console.warn('[palitra] rates refresh failed, using cached rates:', err.message);
        } finally {
          inflight = null;
        }
        return cache;
      })();
    }
    return inflight;
  }

  const knownCodes = () => new Set(Object.keys(cache?.rates || {}));

  return {
    name: 'currency',
    /** Cheap synchronous check so the engine knows whether to wait for us. */
    matches(q) {
      return Boolean(parseCurrencyQuery(q.trim(), knownCodes()));
    },
    async queryAsync(q) {
      const parsed = parseCurrencyQuery(q.trim(), knownCodes());
      if (!parsed) return [];
      let data;
      try {
        data = await getRates();
      } catch (err) {
        return [
          {
            id: 'currency:error',
            title: 'Не удалось получить курсы валют',
            subtitle: err.message,
            icon: 'currency',
            category: 'Валюта',
            dynamic: true,
            score: 990,
            actions: [],
          },
        ];
      }
      const targets = (parsed.to || ctx.config.settings.currency.targets || ['USD', 'EUR'])
        .map((c) => c.toUpperCase())
        .filter((c) => c !== parsed.from);
      const updated = data.updated ? new Date(data.updated).toLocaleDateString('ru-RU') : '';
      return targets
        .map((to, i) => {
          const v = convertCurrency(parsed.amount, parsed.from, to, data.rates);
          if (v === null) return null;
          const rounded = Math.abs(v) >= 1 ? Math.round(v * 100) / 100 : v;
          const raw = formatNumber(rounded, { group: false });
          return {
            id: `currency:${to}`,
            title: `${formatNumber(rounded)} ${to}`,
            subtitle: `${formatNumber(parsed.amount)} ${parsed.from} → ${to}${updated ? ` · курс от ${updated}` : ''}`,
            icon: 'currency',
            category: 'Валюта',
            dynamic: true,
            score: 995 - i,
            actions: [A.copy(raw, 'Скопировать сумму'), A.paste(raw, 'Вставить сумму')],
          };
        })
        .filter(Boolean);
    },
  };
}

module.exports = { createCurrency, fetchRates };
