'use strict';

// Instant answers computed from the query itself: calculator, units, number
// bases, colours and timestamps. They always rank above everything else.

const A = require('../actions');
const { tryCalculate, formatNumber } = require('../../core/calculator');
const { parseConversion, unitLabel } = require('../../core/units');
const { parseBaseQuery, parseColor, parseTimestamp } = require('../../core/numbers');

const TOP = 1000;

function answer(id, title, subtitle, icon, value, extra = {}) {
  return {
    id: `quick:${id}`,
    title,
    subtitle,
    icon,
    category: extra.category || 'Ответ',
    dynamic: true,
    score: extra.score ?? TOP,
    actions: [A.copy(value, 'Скопировать результат'), A.paste(value, 'Вставить результат'), ...(extra.actions || [])],
    ...extra.more,
  };
}

function createQuick() {
  return {
    name: 'quick',
    query(q) {
      const query = q.trim();
      if (!query) return [];
      const out = [];

      const calc = tryCalculate(query);
      if (calc !== null) {
        const raw = formatNumber(calc, { group: false });
        out.push(answer('calc', `= ${formatNumber(calc)}`, `${query} · Enter — скопировать ${raw}`, 'calc', raw, { category: 'Калькулятор' }));
      }

      const conv = parseConversion(query);
      if (conv) {
        conv.results.forEach((r, i) => {
          const raw = formatNumber(r.value, { group: false, digits: 8 });
          out.push(
            answer(`unit:${i}`, `${formatNumber(r.value, { digits: 8 })} ${unitLabel(r.unit)}`, `${formatNumber(conv.value)} ${unitLabel(conv.from.id)} → ${unitLabel(r.unit)}`, 'convert', raw, {
              category: 'Единицы',
              score: TOP - i,
            }),
          );
        });
      }

      const base = parseBaseQuery(query);
      if (base) {
        base.results.forEach((r, i) => {
          out.push(answer(`base:${r.base}`, r.text, `${r.base.toUpperCase()} · из ${query}`, 'hash', r.text, { category: 'Системы счисления', score: TOP - i }));
        });
      }

      const color = parseColor(query);
      if (color) {
        [color.hex, color.rgb, color.hsl].forEach((v, i) => {
          out.push(answer(`color:${i}`, v, ['HEX', 'RGB', 'HSL'][i], { color: color.css }, v, { category: 'Цвет', score: TOP - i }));
        });
      }

      const ts = parseTimestamp(query);
      if (ts) {
        const local = ts.toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'medium' });
        out.push(
          answer('timestamp', local, `Unix ${query} · UTC ${ts.toISOString()}`, 'clock', ts.toISOString(), {
            category: 'Время',
            actions: [A.copy(local, 'Скопировать локальное время')],
          }),
        );
      }
      return out;
    },
  };
}

module.exports = { createQuick };
