'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJson } = require('./store');

const DEFAULT_SETTINGS = {
  hotkey: 'Alt+Space',
  // Global hotkeys for any command id, e.g. { "text:fixLayout": "Ctrl+Alt+L" }.
  commandHotkeys: {},
  launchAtLogin: true,
  hideOnBlur: true,
  theme: 'system',
  maxResults: 40,
  showFilesInMainSearch: true,
  translate: {
    // Shown side by side for "tr <text>"; the source language is skipped.
    targets: ['ru', 'en', 'it'],
  },
  currency: {
    // Shown for "100 usd" without an explicit target currency.
    targets: ['EUR', 'USD', 'RUB', 'UZS'],
  },
  files: {
    // Empty = your home folder. Add more, e.g. "D:\\Projects".
    roots: [],
    maxDepth: 7,
    maxEntries: 150000,
    includeHidden: false,
    exclude: [
      'node_modules', 'AppData', 'Library', 'Application Data', 'Local Settings',
      '$RECYCLE.BIN', 'System Volume Information', '__pycache__', 'venv', '.venv',
      'site-packages', 'Pods', 'DerivedData', 'snap', 'go', 'vendor',
    ],
    reindexMinutes: 30,
  },
  webSearch: {
    g: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
    yt: { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=%s' },
    gh: { name: 'GitHub', url: 'https://github.com/search?q=%s' },
    w: { name: 'Wikipedia', url: 'https://ru.wikipedia.org/w/index.php?search=%s' },
    so: { name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q=%s' },
    maps: { name: 'Google Maps', url: 'https://www.google.com/maps/search/%s' },
    ai: { name: 'Claude', url: 'https://claude.ai/new?q=%s' },
  },
  fallbackSearch: 'g',
};

const DEFAULT_MACROS = {
  macros: [
    {
      name: 'Утренний старт',
      description: 'Открывает почту, календарь и папку загрузок',
      keywords: ['morning', 'start', 'work'],
      steps: [
        { type: 'open', target: 'https://mail.google.com' },
        { type: 'open', target: 'https://calendar.google.com' },
        { type: 'open', target: '{downloads}' },
        { type: 'notify', text: 'Хорошего дня! ☀️' },
      ],
    },
    {
      name: 'Найти на Stack Overflow',
      description: 'Спросит запрос и откроет поиск',
      keywords: ['stackoverflow', 'question'],
      input: 'Что ищем?',
      steps: [{ type: 'open', target: 'https://stackoverflow.com/search?q={input:url}' }],
    },
    {
      name: 'Вставить подпись письма',
      description: 'Вставляет текст в активное окно',
      keywords: ['signature', 'email', 'подпись'],
      hotkey: '',
      steps: [{ type: 'paste', text: 'С уважением,\nВаше Имя' }],
    },
    {
      name: 'Сегодняшняя дата',
      description: 'Вставляет дату в формате ГГГГ-ММ-ДД',
      keywords: ['date', 'today', 'дата'],
      steps: [{ type: 'paste', text: '{date}' }],
    },
    {
      name: 'Буфер → ВЕРХНИЙ регистр и вставить',
      description: 'Пример цепочки: команда Palitra + вставка',
      keywords: ['upper', 'chain'],
      steps: [
        { type: 'command', id: 'text:upper' },
        { type: 'paste' },
      ],
    },
  ],
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Deep merge where arrays and scalars from `over` replace those in `base`. */
function merge(base, over) {
  if (!isPlainObject(base) || !isPlainObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

class Config {
  constructor(dir) {
    this.dir = dir;
    this.settingsFile = path.join(dir, 'settings.json');
    this.macrosFile = path.join(dir, 'macros.json');
    this.settings = DEFAULT_SETTINGS;
    this.macros = [];
    this.errors = [];
    this.listeners = new Set();
    this.watcher = null;
    this.reloadTimer = null;
    this.selfWrite = 0;
  }

  ensureFiles() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.settingsFile)) writeJson(this.settingsFile, DEFAULT_SETTINGS);
    if (!fs.existsSync(this.macrosFile)) writeJson(this.macrosFile, DEFAULT_MACROS);
  }

  load() {
    this.ensureFiles();
    this.errors = [];
    const user = this.readStrict(this.settingsFile);
    this.settings = merge(DEFAULT_SETTINGS, isPlainObject(user) ? user : {});
    const macros = this.readStrict(this.macrosFile);
    const list = Array.isArray(macros) ? macros : macros && Array.isArray(macros.macros) ? macros.macros : [];
    this.macros = list.filter((m) => {
      const ok = isPlainObject(m) && typeof m.name === 'string' && Array.isArray(m.steps);
      if (!ok && m) this.errors.push({ file: this.macrosFile, message: `Макрос без "name" или "steps": ${JSON.stringify(m).slice(0, 80)}` });
      return ok;
    });
  }

  readStrict(file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') this.errors.push({ file, message: err.message });
      return null;
    }
  }

  /** Updates one top-level setting in settings.json, keeping the rest of the file. */
  update(key, value) {
    const current = readJson(this.settingsFile, {});
    const next = isPlainObject(current) ? current : {};
    next[key] = value;
    this.selfWrite = Date.now();
    writeJson(this.settingsFile, next);
    this.load();
    this.emit();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) {
      try {
        fn(this);
      } catch (err) {
        console.error('[palitra] config listener failed', err);
      }
    }
  }

  watch() {
    if (this.watcher) return;
    try {
      this.watcher = fs.watch(this.dir, (_event, filename) => {
        if (filename && !['settings.json', 'macros.json'].includes(String(filename))) return;
        if (Date.now() - this.selfWrite < 500) return;
        clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => {
          this.load();
          this.emit();
        }, 300);
      });
    } catch (err) {
      console.warn('[palitra] cannot watch config dir', err.message);
    }
  }

  close() {
    if (this.watcher) this.watcher.close();
    this.watcher = null;
  }
}

module.exports = { Config, DEFAULT_SETTINGS, DEFAULT_MACROS, merge };
