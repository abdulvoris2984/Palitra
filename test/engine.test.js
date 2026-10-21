'use strict';

// Integration tests: the real search engine and providers, with a fake
// context instead of Electron (clipboard, shell, network are stubbed).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const system = require('../src/main/system');
const { DEFAULT_SETTINGS, DEFAULT_MACROS, merge } = require('../src/main/settings');
const { Frecency } = require('../src/core/frecency');
const { SearchEngine } = require('../src/main/search');
const { createBuiltins } = require('../src/main/providers/builtins');
const { createQuick } = require('../src/main/providers/quick');
const { createCurrency, fetchRates } = require('../src/main/providers/currency');
const { createTranslate, translate } = require('../src/main/providers/translate');
const { createApps, parseDesktopEntry, parseExec } = require('../src/main/providers/apps');
const { createFiles } = require('../src/main/providers/files');
const { createMacros, expandVars } = require('../src/main/providers/macros');
const { createWeb } = require('../src/main/providers/web');
const { conversionsFor, convertFile, uniqueOutputPath } = require('../src/main/convert');

function jsonResponse(data, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => data };
}

function makeFixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'palitra-test-'));
  const files = [
    'Documents/University/annual_report_2025.md',
    'Documents/University/grades.csv',
    'Documents/University/Machine Learning - Lecture 3.pdf',
    'Documents/config.json',
    'Pictures/photo.png',
    'Downloads/setup.exe',
    '.hidden/secret.txt',
    'node_modules/pkg/index.js',
  ];
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(home, f)), { recursive: true });
    fs.writeFileSync(path.join(home, f), f.endsWith('.csv') ? 'name,age\nAnna,21\n' : 'x');
  }
  return home;
}

function makeEngine({ fetch } = {}) {
  const home = makeFixture();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'palitra-data-'));
  const config = {
    settings: merge(DEFAULT_SETTINGS, { files: { roots: [home] } }),
    macros: DEFAULT_MACROS.macros,
    errors: [],
    dir: data,
    settingsFile: path.join(data, 'settings.json'),
    macrosFile: path.join(data, 'macros.json'),
  };
  let clip = '';
  let clipSnapshot = '';
  const calls = { opened: [], external: [], pasted: [], hidden: 0, notified: [] };
  let providers;
  let engine;
  const ctx = {
    config,
    frecency: new Frecency(),
    system,
    electron: {
      app: { getPath: (k) => path.join(home, k) },
      shell: {
        openPath: async (p) => {
          calls.opened.push(p);
          return '';
        },
        openExternal: async (u) => calls.external.push(u),
        showItemInFolder: () => {},
        trashItem: async () => {},
      },
    },
    clipboard: {
      readText: async () => clip,
      writeText: async (t) => {
        clip = String(t);
      },
      clear: async () => {
        clip = '';
      },
      readFiles: async () => [],
      readImagePng: async () => null,
    },
    paths: { data },
    fetch: fetch || (async () => {
      throw new Error('offline');
    }),
    tools: () => ({}),
    hide: () => calls.hidden++,
    show: () => {},
    notify: (title, body) => calls.notified.push([title, body]),
    copy: async (t) => {
      clip = String(t);
    },
    pasteText: async (t) => {
      clip = String(t);
      calls.pasted.push(String(t));
    },
    convertImage: async () => {
      throw new Error('no renderer in tests');
    },
    clipboardText: () => clipSnapshot,
    loadClipboard: async () => {
      clipSnapshot = clip;
      return clip;
    },
    saveFrecency: () => {},
    reloadConfig: () => {},
    reindex: () => {},
    setHotkey: () => true,
    getLaunchAtLogin: () => false,
    setLaunchAtLogin: () => {},
    quit: () => {},
    makeFileItem: (p, o) => providers.files.makeFileItem(p, o),
    findApp: () => null,
    runCommand: (id, a, arg) => engine.runCommand(id, a, arg),
  };
  providers = {
    builtins: createBuiltins(ctx),
    quick: createQuick(ctx),
    currency: createCurrency(ctx),
    translate: createTranslate(ctx),
    apps: createApps(ctx),
    files: createFiles(ctx),
    macros: createMacros(ctx),
    web: createWeb(ctx),
  };
  engine = new SearchEngine(ctx, providers);
  return {
    engine,
    providers,
    ctx,
    home,
    calls,
    setClip: (t) => {
      clip = t;
    },
    getClip: () => clip,
  };
}

const noPush = () => {};
const titles = (res) => res.items.map((i) => i.title);

test('empty query shows suggestions, then recently used commands first', async () => {
  const t = makeEngine();
  let res = await t.engine.search('', 1, noPush);
  assert.equal(res.mode, 'home');
  assert.ok(res.items.some((i) => i.id === 'cmd:translate'));

  t.setClip('hello');
  await t.engine.search('upper', 2, noPush);
  const exec = await t.engine.execute({ itemId: 'text:upper', query: 'upper' });
  assert.equal(exec.hide, true);
  assert.equal(t.getClip(), 'HELLO');

  res = await t.engine.search('', 3, noPush);
  assert.equal(res.items[0].id, 'text:upper');
  assert.equal(res.items[0].section, 'Недавние');
});

test('calculator, units and colours answer instantly at the top', async () => {
  const t = makeEngine();
  assert.equal((await t.engine.search('2+2*2', 1, noPush)).items[0].title, '= 6');
  assert.equal((await t.engine.search('10 km to mi', 2, noPush)).items[0].title, '6.2137119 mi');
  assert.equal((await t.engine.search('#ff8800', 3, noPush)).items[0].title, '#FF8800');
  const res = await t.engine.search('2+2*2', 4, noPush);
  const out = await t.engine.execute({ itemId: res.items[0].id, query: '2+2*2' });
  assert.equal(out.hide, true);
  assert.equal(t.getClip(), '6');
  assert.equal(t.ctx.frecency.value(res.items[0].id), 0, 'instant answers are not learned');
});

test('typo and wrong-layout queries find commands', async () => {
  const t = makeEngine();
  assert.equal((await t.engine.search('tarnslate', 1, noPush)).items[0].id, 'cmd:translate');
  assert.equal((await t.engine.search('ghtdtcnb', 2, noPush)).items[0].id, 'cmd:translate'); // "перевести"
  assert.equal((await t.engine.search('настройки', 3, noPush)).items[0].id, 'cmd:settings');
  assert.equal((await t.engine.search('settings', 4, noPush)).items[0].id, 'cmd:settings');
});

test('clipboard previews are shown in subtitles', async () => {
  const t = makeEngine();
  t.setClip('ghbdtn');
  const res = await t.engine.search('исправить раскладку', 1, noPush);
  const row = res.items.find((i) => i.id === 'text:fixLayout');
  assert.equal(row.subtitle, 'Буфер → привет');
});

test('dangerous commands require confirmation', async () => {
  const t = makeEngine();
  const res = await t.engine.search('выключить компьютер', 1, noPush);
  const row = res.items.find((i) => i.id === 'cmd:shutdown');
  assert.ok(row.actions[0].confirm);
});

test('file search: index, typo tolerance, hidden and excluded folders', async () => {
  const t = makeEngine();
  await t.providers.files.index();
  assert.equal(t.providers.files.count() > 5, true);
  let res = await t.engine.search('f report', 1, noPush);
  assert.equal(res.mode, 'files');
  assert.equal(res.items[0].title, 'annual_report_2025.md');
  res = await t.engine.search('f anual reprt', 2, noPush);
  assert.equal(res.items[0].title, 'annual_report_2025.md');
  res = await t.engine.search('f machine lecture', 3, noPush);
  assert.equal(res.items[0].title, 'Machine Learning - Lecture 3.pdf');
  assert.equal((await t.engine.search('f secret', 4, noPush)).items.length, 0, 'hidden files are skipped');
  assert.equal((await t.engine.search('f index', 5, noPush)).items.length, 0, 'node_modules is excluded');
  res = await t.engine.search('report', 6, noPush);
  assert.ok(res.items.some((i) => i.title === 'annual_report_2025.md'), 'files appear in the main search');
});

test('convert mode lists only convertible files and opens actions on Enter', async () => {
  const t = makeEngine();
  await t.providers.files.index();
  const res = await t.engine.search('conv grades', 1, noPush);
  const row = res.items[0];
  assert.equal(row.title, 'grades.csv');
  assert.equal(row.enterOpensActions, true);
  assert.equal(row.actions[0].title, 'Конвертировать в JSON');
  const out = await t.engine.execute({ itemId: row.id, actionId: row.actions[0].id, query: 'conv grades' });
  assert.match(out.toast, /grades\.json/);
  const json = JSON.parse(fs.readFileSync(path.join(t.home, 'Documents/University/grades.json'), 'utf8'));
  assert.deepEqual(json, [{ name: 'Anna', age: 21 }]);
  assert.equal((await t.engine.search('conv setup', 2, noPush)).items.length, 0);
});

test('path browsing lists folders first and navigates into them', async () => {
  const t = makeEngine();
  let res = await t.engine.search(t.home + path.sep, 1, noPush);
  assert.equal(res.mode, 'browse');
  assert.deepEqual(titles(res), ['Documents', 'Downloads', 'node_modules', 'Pictures'].sort((a, b) => a.localeCompare(b)));
  res = await t.engine.search(path.join(t.home, 'Doc'), 2, noPush);
  assert.equal(res.items[0].title, 'Documents');
  const nav = await t.engine.execute({ itemId: res.items[0].id, query: '' });
  assert.equal(nav.query, path.join(t.home, 'Documents') + path.sep);
});

test('translation: Google first, MyMemory as a fallback', async () => {
  const google = async (url) => {
    assert.match(url, /translate\.googleapis\.com/);
    const target = new URL(url).searchParams.get('tl');
    return jsonResponse([[[target === 'en' ? 'Hi' : 'Ciao', 'Привет', null, null, 10]], null, 'ru']);
  };
  assert.deepEqual(await translate(google, 'Привет', 'en'), { text: 'Hi', source: 'ru' });

  const flaky = async (url) => {
    if (url.includes('googleapis')) throw new Error('blocked');
    assert.match(url, /langpair=ru\|de/);
    return jsonResponse({ responseData: { translatedText: 'Hallo' } });
  };
  assert.deepEqual(await translate(flaky, 'Здравствуй', 'de'), { text: 'Hallo', source: 'ru' });

  const t = makeEngine({ fetch: google });
  const pushed = await new Promise((resolve) => {
    t.engine.search('tr Привет', 7, (seq, items) => resolve({ seq, items })).then((res) => {
      assert.equal(res.mode, 'translate');
      assert.ok(res.items.every((i) => i.loading), 'placeholders while loading');
    });
  });
  assert.equal(pushed.seq, 7);
  assert.deepEqual(pushed.items.map((i) => i.title), ['Hi', 'Ciao']); // ru is skipped: it is the source
});

test('currency rates: primary source, then fallback, then cached results', async () => {
  const primary = async () => jsonResponse({ result: 'success', rates: { USD: 1, EUR: 0.5, RUB: 100 }, time_last_update_utc: 'Fri, 09 Oct 2026 00:00:00 +0000' });
  assert.deepEqual((await fetchRates(primary)).rates, { USD: 1, EUR: 0.5, RUB: 100 });

  const fallback = async (url) => {
    if (url.includes('er-api')) return jsonResponse({}, false);
    return jsonResponse({ date: '2026-10-09', usd: { eur: 0.5, uzs: 12000, '1inch': 3 } });
  };
  assert.deepEqual((await fetchRates(fallback)).rates, { EUR: 0.5, UZS: 12000, USD: 1 });

  const t = makeEngine({ fetch: primary });
  const pushed = await new Promise((resolve) => {
    t.engine.search('10 usd to eur', 3, (seq, items) => resolve(items));
  });
  assert.equal(pushed[0].title, '5 EUR');
});

test('macros: variables, input and steps', async () => {
  assert.equal(expandVars('q={input:url}&c={clipboard}', { input: 'a b', clipboard: 'x' }), 'q=a%20b&c=x');
  assert.equal(expandVars('{unknown}', {}), '{unknown}');

  const t = makeEngine();
  let res = await t.engine.search('stack overflow', 1, noPush);
  const so = res.items.find((i) => i.title === 'Найти на Stack Overflow');
  assert.ok(so.input, 'macro asks for input');
  await t.engine.execute({ itemId: so.id, arg: 'electron ipc', query: 'stack overflow' });
  assert.deepEqual(t.calls.external, ['https://stackoverflow.com/search?q=electron%20ipc']);

  res = await t.engine.search('сегодняшняя дата', 2, noPush);
  await t.engine.execute({ itemId: res.items[0].id, query: '' });
  assert.match(t.calls.pasted[0], /^\d{4}-\d{2}-\d{2}$/);
});

test('macro errors are reported, not thrown', async () => {
  const t = makeEngine();
  t.ctx.config.macros = [{ name: 'Broken', steps: [{ type: 'teleport' }] }];
  const res = await t.engine.search('broken', 1, noPush);
  const out = await t.engine.execute({ itemId: res.items[0].id, query: 'broken' });
  assert.match(out.error, /teleport/);
  assert.equal(t.calls.notified.length, 1);
});

test('web prefixes, URLs and the fallback search row', async () => {
  const t = makeEngine();
  let res = await t.engine.search('yt lofi beats', 1, noPush);
  assert.equal(res.mode, 'web');
  assert.match(res.items[0].title, /YouTube/);
  res = await t.engine.search('github.com', 2, noPush);
  assert.equal(res.items[0].id, 'web:url');
  res = await t.engine.search('report.pdf', 3, noPush);
  assert.ok(!res.items.some((i) => i.id === 'web:url'), 'file names are not URLs');
  assert.equal(res.items[res.items.length - 1].id, 'web:g', 'web search is always last');
});

test('commands-only mode and help', async () => {
  const t = makeEngine();
  await t.providers.files.index();
  const res = await t.engine.search('>report', 1, noPush);
  assert.equal(res.mode, 'commands');
  assert.ok(!res.items.some((i) => i.id.startsWith('file:')));
  const help = await t.engine.search('?', 2, noPush);
  assert.equal(help.mode, 'help');
  assert.ok(help.items.length > 10);
});

test('conversions offered per file type and tools', () => {
  assert.deepEqual(conversionsFor('a.png').map((c) => c.id), ['image:jpg', 'image:webp', 'image:png:half']);
  assert.deepEqual(conversionsFor('a.csv').map((c) => c.id), ['text:json']);
  assert.deepEqual(conversionsFor('a.docx').map((c) => c.id), []);
  assert.deepEqual(conversionsFor('a.docx', { soffice: '/x' }).map((c) => c.id), ['soffice:pdf', 'soffice:odt']);
  assert.ok(conversionsFor('a.mov', { ffmpeg: '/x' }).some((c) => c.id === 'ffmpeg:gif'));
  assert.ok(conversionsFor('a.heic', { sips: '/x' }).some((c) => c.id === 'sips:jpg'));
});

test('converted files never overwrite existing ones', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'palitra-conv-'));
  const src = path.join(dir, 'data.json');
  fs.writeFileSync(src, '[{"a":1}]');
  const conv = conversionsFor(src).find((c) => c.to === 'yaml');
  const first = await convertFile(src, conv, {});
  const second = await convertFile(src, conv, {});
  assert.equal(path.basename(first), 'data.yaml');
  assert.equal(path.basename(second), 'data (1).yaml');
  assert.equal(fs.readFileSync(first, 'utf8'), '- a: 1\n');
  assert.equal(path.basename(uniqueOutputPath(src, 'yaml')), 'data (2).yaml');
});

test('linux .desktop parsing', () => {
  const entry = parseDesktopEntry(
    '[Desktop Entry]\nType=Application\nName=Files\nName[ru]=Файлы\nKeywords=folder;manager;\nExec=nautilus --new-window %U\nIcon=org.gnome.Nautilus\n[Desktop Action new]\nName=New',
    'ru',
  );
  assert.equal(entry.name, 'Файлы');
  assert.equal(entry.englishName, 'Files');
  assert.deepEqual(entry.keywords, ['folder', 'manager']);
  assert.deepEqual(parseExec(entry.exec), ['nautilus', '--new-window']);
  assert.deepEqual(parseExec('"/opt/My App/app" --flag "%f" 100%%'), ['/opt/My App/app', '--flag', '100%']);
});
