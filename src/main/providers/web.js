'use strict';

// Web search shortcuts ("g query", "yt query", configurable in settings.json),
// opening URLs typed directly, and a "search the web" fallback row.

const A = require('../actions');

// Only well-known TLDs, so that "report.pdf" or "main.py" are not taken for sites.
const TLDS = 'com|net|org|io|dev|app|ai|ru|uz|it|de|fr|uk|us|eu|edu|gov|co|me|info|biz|tv|gg|xyz|site|online|tech|рф|es|nl|pl|ch|at|se|no|fi|cz|ua|kz|by|jp|cn|kr|in|br|ca|au|so|to|fm|news|blog|cloud|page|link|store|shop';
const URL_LIKE = new RegExp(String.raw`^(https?:\/\/\S+|(www\.)?([\p{L}\p{N}-]+\.)+(${TLDS})(:\d+)?(\/\S*)?)$`, 'iu');

function buildUrl(template, q) {
  return template.replace('%s', encodeURIComponent(q));
}

function createWeb(ctx) {
  function engines() {
    return ctx.config.settings.webSearch || {};
  }

  function searchItem(key, engine, q, score) {
    const url = buildUrl(engine.url, q);
    return {
      id: `web:${key}`,
      title: q ? `Искать «${q}» в ${engine.name}` : `Поиск в ${engine.name}`,
      subtitle: q ? url : `Введите запрос после «${key} »`,
      icon: 'web',
      category: 'Веб',
      dynamic: true,
      score,
      actions: q ? [A.openUrl(url), A.copy(url, 'Скопировать ссылку')] : [],
    };
  }

  return {
    name: 'web',
    /** "g cats" -> { key: 'g', engine, text: 'cats' } */
    parse(query) {
      const m = /^(\S+)\s+([\s\S]*)$/.exec(query);
      if (!m) return null;
      const engine = engines()[m[1].toLowerCase()];
      return engine && engine.url ? { key: m[1].toLowerCase(), engine, text: m[2].trim() } : null;
    },
    prefixed(parsed) {
      return [searchItem(parsed.key, parsed.engine, parsed.text, 1000)];
    },
    /** Rows added to normal results: open typed URL, search the web. */
    extras(query) {
      const q = query.trim();
      const out = [];
      if (!q) return out;
      if (URL_LIKE.test(q) && !/\s/.test(q)) {
        const url = /^https?:\/\//i.test(q) ? q : `https://${q}`;
        out.push({
          id: 'web:url',
          title: `Открыть ${q}`,
          subtitle: url,
          icon: 'link',
          category: 'Веб',
          dynamic: true,
          score: 990,
          actions: [A.openUrl(url, 'Открыть'), A.copy(url, 'Скопировать ссылку')],
        });
      }
      const key = ctx.config.settings.fallbackSearch;
      const engine = engines()[key];
      if (engine && q.length >= 2) out.push(searchItem(key, engine, q, -1000));
      return out;
    },
    /** Help rows describing available web prefixes. */
    helpItems() {
      return Object.entries(engines()).map(([key, e]) => ({ key, name: e.name }));
    },
  };
}

module.exports = { createWeb };
