'use strict';

// Unit conversion parsed from natural queries:
//   "10 km to mi", "100f in c", "5 гб в мб", "3.5 часа в минуты", "72 kg"
// Units are case-insensitive and accept English and Russian names.

const CATEGORIES = {
  length: {
    base: 'm',
    units: {
      mm: [0.001, ['mm', 'millimeter', 'millimeters', 'millimetre', 'мм', 'миллиметр', 'миллиметра', 'миллиметров', 'миллиметры']],
      cm: [0.01, ['cm', 'centimeter', 'centimeters', 'centimetre', 'см', 'сантиметр', 'сантиметра', 'сантиметров', 'сантиметры']],
      m: [1, ['m', 'meter', 'meters', 'metre', 'metres', 'м', 'метр', 'метра', 'метров', 'метры']],
      km: [1000, ['km', 'kilometer', 'kilometers', 'kilometre', 'км', 'километр', 'километра', 'километров', 'километры']],
      in: [0.0254, ['in', 'inch', 'inches', '"', 'дюйм', 'дюйма', 'дюймов', 'дюймы']],
      ft: [0.3048, ['ft', 'foot', 'feet', "'", 'фут', 'фута', 'футов', 'футы']],
      yd: [0.9144, ['yd', 'yard', 'yards', 'ярд', 'ярда', 'ярдов', 'ярды']],
      mi: [1609.344, ['mi', 'mile', 'miles', 'миля', 'мили', 'миль', 'милю']],
      nmi: [1852, ['nmi', 'nautical mile', 'nautical miles', 'морская миля', 'морских миль']],
    },
    defaults: { mm: ['in'], cm: ['in'], m: ['ft'], km: ['mi'], in: ['cm'], ft: ['m'], yd: ['m'], mi: ['km'], nmi: ['km'] },
  },
  mass: {
    base: 'kg',
    units: {
      mg: [1e-6, ['mg', 'milligram', 'milligrams', 'мг', 'миллиграмм', 'миллиграмма', 'миллиграммов']],
      g: [0.001, ['g', 'gr', 'gram', 'grams', 'г', 'гр', 'грамм', 'грамма', 'граммов']],
      kg: [1, ['kg', 'kilo', 'kilos', 'kilogram', 'kilograms', 'кг', 'килограмм', 'килограмма', 'килограммов', 'кило']],
      t: [1000, ['t', 'ton', 'tons', 'tonne', 'tonnes', 'т', 'тонна', 'тонны', 'тонн', 'тонну']],
      lb: [0.45359237, ['lb', 'lbs', 'pound', 'pounds', 'фунт', 'фунта', 'фунтов', 'фунты']],
      oz: [0.028349523125, ['oz', 'ounce', 'ounces', 'унция', 'унции', 'унций']],
      st: [6.35029318, ['st', 'stone', 'stones', 'стоун']],
    },
    defaults: { mg: ['g'], g: ['oz'], kg: ['lb'], t: ['lb'], lb: ['kg'], oz: ['g'], st: ['kg'] },
  },
  temperature: {
    base: 'c',
    units: {
      c: [null, ['c', '°c', 'celsius', 'цельсий', 'цельсия', 'градус', 'градуса', 'градусов', '°']],
      f: [null, ['f', '°f', 'fahrenheit', 'фаренгейт', 'фаренгейта']],
      k: [null, ['k', 'kelvin', 'kelvins', 'кельвин', 'кельвина', 'кельвинов']],
    },
    defaults: { c: ['f'], f: ['c'], k: ['c'] },
  },
  volume: {
    base: 'l',
    units: {
      ml: [0.001, ['ml', 'milliliter', 'milliliters', 'millilitre', 'мл', 'миллилитр', 'миллилитра', 'миллилитров']],
      l: [1, ['l', 'liter', 'liters', 'litre', 'litres', 'л', 'литр', 'литра', 'литров', 'литры']],
      m3: [1000, ['m3', 'm^3', 'м3', 'куб', 'кубометр', 'кубометра', 'кубометров']],
      gal: [3.785411784, ['gal', 'gallon', 'gallons', 'галлон', 'галлона', 'галлонов']],
      qt: [0.946352946, ['qt', 'quart', 'quarts', 'кварта', 'кварты']],
      pt: [0.473176473, ['pt', 'pint', 'pints', 'пинта', 'пинты', 'пинт']],
      cup: [0.2365882365, ['cup', 'cups', 'чашка', 'чашки', 'стакан', 'стакана', 'стаканов']],
      floz: [0.0295735295625, ['floz', 'fl oz', 'fluid ounce', 'fluid ounces']],
      tbsp: [0.01478676478125, ['tbsp', 'tablespoon', 'tablespoons', 'ст.л', 'стл']],
      tsp: [0.00492892159375, ['tsp', 'teaspoon', 'teaspoons', 'ч.л', 'чл']],
    },
    defaults: { ml: ['floz'], l: ['gal'], m3: ['l'], gal: ['l'], qt: ['l'], pt: ['ml'], cup: ['ml'], floz: ['ml'], tbsp: ['ml'], tsp: ['ml'] },
  },
  time: {
    base: 's',
    units: {
      ms: [0.001, ['ms', 'millisecond', 'milliseconds', 'мс', 'миллисекунда', 'миллисекунды', 'миллисекунд']],
      s: [1, ['s', 'sec', 'secs', 'second', 'seconds', 'с', 'сек', 'секунда', 'секунды', 'секунд', 'секунду']],
      min: [60, ['min', 'mins', 'minute', 'minutes', 'мин', 'минута', 'минуты', 'минут', 'минуту']],
      h: [3600, ['h', 'hr', 'hrs', 'hour', 'hours', 'ч', 'час', 'часа', 'часов', 'часы']],
      d: [86400, ['d', 'day', 'days', 'д', 'день', 'дня', 'дней', 'дни', 'сутки', 'суток']],
      wk: [604800, ['wk', 'week', 'weeks', 'нед', 'неделя', 'недели', 'недель', 'неделю']],
      mo: [2629746, ['mo', 'month', 'months', 'мес', 'месяц', 'месяца', 'месяцев', 'месяцы']],
      y: [31556952, ['y', 'yr', 'yrs', 'year', 'years', 'г.', 'год', 'года', 'лет', 'годы']],
    },
    defaults: { ms: ['s'], s: ['min'], min: ['h'], h: ['min'], d: ['h'], wk: ['d'], mo: ['d'], y: ['d'] },
  },
  data: {
    base: 'B',
    units: {
      bit: [0.125, ['bit', 'bits', 'бит', 'бита', 'битов']],
      B: [1, ['b', 'byte', 'bytes', 'байт', 'байта', 'байтов']],
      KB: [1e3, ['kb', 'kilobyte', 'kilobytes', 'кб', 'килобайт', 'килобайта', 'килобайтов']],
      MB: [1e6, ['mb', 'megabyte', 'megabytes', 'мб', 'мегабайт', 'мегабайта', 'мегабайтов']],
      GB: [1e9, ['gb', 'gigabyte', 'gigabytes', 'гб', 'гигабайт', 'гигабайта', 'гигабайтов']],
      TB: [1e12, ['tb', 'terabyte', 'terabytes', 'тб', 'терабайт', 'терабайта', 'терабайтов']],
      KiB: [1024, ['kib', 'кибибайт']],
      MiB: [1024 ** 2, ['mib', 'мебибайт']],
      GiB: [1024 ** 3, ['gib', 'гибибайт']],
      TiB: [1024 ** 4, ['tib', 'тебибайт']],
    },
    defaults: { bit: ['B'], B: ['KB'], KB: ['MB'], MB: ['GB', 'MiB'], GB: ['MB', 'GiB'], TB: ['GB', 'TiB'], KiB: ['KB'], MiB: ['MB'], GiB: ['GB'], TiB: ['TB'] },
  },
  speed: {
    base: 'm/s',
    units: {
      'm/s': [1, ['m/s', 'mps', 'м/с']],
      'km/h': [1 / 3.6, ['km/h', 'kmh', 'kph', 'км/ч', 'кмч']],
      mph: [0.44704, ['mph', 'mi/h', 'миль/ч']],
      kn: [0.514444, ['kn', 'kt', 'knot', 'knots', 'узел', 'узла', 'узлов']],
      'ft/s': [0.3048, ['ft/s', 'fps']],
    },
    defaults: { 'm/s': ['km/h'], 'km/h': ['mph'], mph: ['km/h'], kn: ['km/h'], 'ft/s': ['m/s'] },
  },
  area: {
    base: 'm2',
    units: {
      cm2: [1e-4, ['cm2', 'cm^2', 'см2', 'кв.см']],
      m2: [1, ['m2', 'm^2', 'sqm', 'м2', 'кв.м', 'квм']],
      km2: [1e6, ['km2', 'km^2', 'км2', 'кв.км']],
      ha: [1e4, ['ha', 'hectare', 'hectares', 'га', 'гектар', 'гектара', 'гектаров']],
      acre: [4046.8564224, ['acre', 'acres', 'ac', 'акр', 'акра', 'акров']],
      ft2: [0.09290304, ['ft2', 'ft^2', 'sqft', 'sq ft']],
      sotka: [100, ['сотка', 'сотки', 'соток', 'sotka']],
    },
    defaults: { cm2: ['m2'], m2: ['ft2'], km2: ['m2'], ha: ['acre'], acre: ['ha'], ft2: ['m2'], sotka: ['m2'] },
  },
  energy: {
    base: 'J',
    units: {
      J: [1, ['j', 'joule', 'joules', 'дж', 'джоуль', 'джоуля', 'джоулей']],
      kJ: [1000, ['kj', 'kilojoule', 'kilojoules', 'кдж', 'килоджоуль']],
      cal: [4.184, ['cal', 'calorie', 'calories', 'кал', 'калория', 'калории', 'калорий']],
      kcal: [4184, ['kcal', 'kilocalorie', 'kilocalories', 'ккал', 'килокалория', 'килокалорий']],
      Wh: [3600, ['wh', 'вт*ч', 'втч']],
      kWh: [3.6e6, ['kwh', 'квт*ч', 'квтч']],
    },
    defaults: { J: ['cal'], kJ: ['kcal'], cal: ['J'], kcal: ['kJ'], Wh: ['J'], kWh: ['kJ'] },
  },
};

const ALIASES = new Map();
for (const [cat, def] of Object.entries(CATEGORIES)) {
  for (const [id, [factor, names]] of Object.entries(def.units)) {
    for (const n of [id, ...names]) {
      const key = n.toLowerCase();
      if (!ALIASES.has(key)) ALIASES.set(key, { cat, id, factor });
    }
  }
}

function lookupUnit(raw) {
  let s = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  s = s.replace(/²/g, '2').replace(/³/g, '3');
  if (ALIASES.has(s)) return ALIASES.get(s);
  const noDot = s.replace(/\.$/, '');
  if (ALIASES.has(noDot)) return ALIASES.get(noDot);
  const noDeg = s.replace(/^°\s*/, '').replace(/^degrees? /, '').replace(/^градус(а|ов)? (по )?/, '');
  if (ALIASES.has(noDeg)) return ALIASES.get(noDeg);
  if (/^°?[cf]$/.test(noDeg)) return ALIASES.get(noDeg.replace('°', ''));
  return null;
}

function toBase(cat, unit, v) {
  if (cat !== 'temperature') return v * CATEGORIES[cat].units[unit][0];
  if (unit === 'c') return v;
  if (unit === 'f') return ((v - 32) * 5) / 9;
  return v - 273.15;
}

function fromBase(cat, unit, v) {
  if (cat !== 'temperature') return v / CATEGORIES[cat].units[unit][0];
  if (unit === 'c') return v;
  if (unit === 'f') return (v * 9) / 5 + 32;
  return v + 273.15;
}

function convert(value, from, to) {
  const a = typeof from === 'string' ? lookupUnit(from) : from;
  const b = typeof to === 'string' ? lookupUnit(to) : to;
  if (!a || !b || a.cat !== b.cat) return null;
  return fromBase(a.cat, b.id, toBase(a.cat, a.id, value));
}

const NUM = String.raw`([-+]?(?:\d[\d   ]*(?:[.,]\d+)?|[.,]\d+)(?:e[-+]?\d+)?)`;
const CONNECTOR = String.raw`(?:to|in|into|as|в|во|на|->|→|=>|=|>)`;
const WITH_TARGET = new RegExp(String.raw`^\s*${NUM}\s*(.+?)\s+${CONNECTOR}\s+(.+?)\s*$`, 'i');
const NO_TARGET = new RegExp(String.raw`^\s*${NUM}\s*([^\d\s].*?)\s*$`, 'i');

function parseNumber(s) {
  return parseFloat(s.replace(/[   ]/g, '').replace(',', '.'));
}

/**
 * Parses a conversion query. Returns
 *   { value, from: {cat,id}, results: [{ unit, value }] }  or null.
 * Without an explicit target unit a sensible default target is used.
 */
function parseConversion(query) {
  const q = String(query ?? '');
  let m = WITH_TARGET.exec(q);
  if (m) {
    const value = parseNumber(m[1]);
    const from = lookupUnit(m[2]);
    const targets = m[3].split(/\s*(?:,|\band\b|\bи\b)\s*/).map(lookupUnit);
    if (Number.isFinite(value) && from && targets.length && targets.every((t) => t && t.cat === from.cat)) {
      return {
        value,
        from,
        results: targets.map((t) => ({ unit: t.id, value: convert(value, from, t) })),
      };
    }
  }
  m = NO_TARGET.exec(q);
  if (m) {
    const value = parseNumber(m[1]);
    const from = lookupUnit(m[2]);
    // Bare single letters like "5 s" or "3 m" are too ambiguous without a target.
    if (Number.isFinite(value) && from && m[2].trim().length > 1) {
      const defs = CATEGORIES[from.cat].defaults[from.id] || [];
      return {
        value,
        from,
        results: defs.map((id) => ({ unit: id, value: convert(value, from, lookupUnit(id)) })),
      };
    }
  }
  return null;
}

const UNIT_LABELS = { c: '°C', f: '°F', k: 'K', sotka: 'соток', m2: 'm²', cm2: 'cm²', km2: 'km²', ft2: 'ft²', m3: 'm³' };

function unitLabel(id) {
  return UNIT_LABELS[id] || id;
}

module.exports = { parseConversion, convert, lookupUnit, unitLabel, CATEGORIES };
