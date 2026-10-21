'use strict';

// Discovers installed applications:
//   Windows: Start Menu shortcuts (.lnk) + Get-StartApps (Store/UWP apps)
//   macOS:   *.app bundles in the Applications folders
//   Linux:   *.desktop entries (XDG, Flatpak, Snap)

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const A = require('../actions');

const SKIP_NAME = /uninstall|удал(ить|ение)|deinstall|readme|license|лицензия|documentation|help file|release notes|website/i;

async function walk(dir, depth, onFile, onDir) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (onDir && onDir(full, e.name) === false) continue;
      if (depth > 0) await walk(full, depth - 1, onFile, onDir);
    } else if (e.isFile() || e.isSymbolicLink()) {
      onFile(full, e.name);
    }
  }
}

async function discoverWindows(system) {
  const apps = new Map();
  const roots = [
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ];
  for (const root of roots) {
    await walk(root, 4, (full, name) => {
      if (!/\.(lnk|url|appref-ms)$/i.test(name)) return;
      const title = name.replace(/\.(lnk|url|appref-ms)$/i, '');
      if (SKIP_NAME.test(title)) return;
      const key = title.toLowerCase();
      if (!apps.has(key)) apps.set(key, { title, path: full, launch: { kind: 'path', path: full } });
    });
  }
  // Store apps (Calculator, Settings, Photos...) are only visible via Get-StartApps.
  try {
    const { stdout } = await system.run(
      'powershell.exe',
      [
        '-NoProfile', '-NonInteractive', '-Command',
        '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress',
      ],
      { timeout: 20000 },
    );
    const parsed = JSON.parse(stdout || '[]');
    for (const a of Array.isArray(parsed) ? parsed : [parsed]) {
      if (!a || !a.Name || !a.AppID) continue;
      const key = a.Name.toLowerCase();
      if (apps.has(key) || SKIP_NAME.test(a.Name)) continue;
      apps.set(key, { title: a.Name, path: null, launch: { kind: 'appid', id: a.AppID } });
    }
  } catch (err) {
    console.warn('[palitra] Get-StartApps failed:', err.message);
  }
  return [...apps.values()];
}

async function discoverMac() {
  const apps = new Map();
  const roots = ['/Applications', '/System/Applications', path.join(os.homedir(), 'Applications'), '/System/Library/CoreServices/Applications'];
  for (const root of roots) {
    await walk(
      root,
      2,
      () => {},
      (full, name) => {
        if (name.endsWith('.app')) {
          const title = name.slice(0, -4);
          if (!apps.has(title.toLowerCase())) apps.set(title.toLowerCase(), { title, path: full, launch: { kind: 'path', path: full } });
          return false; // never descend into bundles
        }
        return true;
      },
    );
  }
  if (fs.existsSync('/System/Library/CoreServices/Finder.app')) {
    apps.set('finder', { title: 'Finder', path: '/System/Library/CoreServices/Finder.app', launch: { kind: 'path', path: '/System/Library/CoreServices/Finder.app' } });
  }
  return [...apps.values()];
}

function parseDesktopEntry(text, lang) {
  const out = {};
  let inEntry = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inEntry = line === '[Desktop Entry]';
      continue;
    }
    if (!inEntry || !line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  const localized = (key) => out[`${key}[${lang}]`] || out[key];
  return {
    type: out.Type,
    name: localized('Name'),
    englishName: out.Name,
    genericName: localized('GenericName'),
    keywords: (localized('Keywords') || '').split(';').filter(Boolean),
    exec: out.Exec,
    icon: out.Icon,
    noDisplay: out.NoDisplay === 'true' || out.Hidden === 'true',
    terminal: out.Terminal === 'true',
  };
}

function resolveLinuxIcon(name) {
  if (!name) return null;
  if (path.isAbsolute(name)) return fs.existsSync(name) ? name : null;
  const home = os.homedir();
  const bases = [
    path.join(home, '.local/share/icons/hicolor'),
    '/usr/share/icons/hicolor',
    '/var/lib/flatpak/exports/share/icons/hicolor',
    path.join(home, '.local/share/flatpak/exports/share/icons/hicolor'),
  ];
  for (const base of bases) {
    for (const size of ['64x64', '48x48', '128x128', '256x256', 'scalable']) {
      for (const ext of ['png', 'svg']) {
        const p = path.join(base, size, 'apps', `${name}.${ext}`);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  for (const ext of ['png', 'svg', 'xpm']) {
    const p = path.join('/usr/share/pixmaps', `${name}.${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function discoverLinux() {
  const lang = (process.env.LANG || 'en').slice(0, 2);
  const home = os.homedir();
  const dataDirs = (process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':');
  const roots = [
    path.join(process.env.XDG_DATA_HOME || path.join(home, '.local/share'), 'applications'),
    ...dataDirs.map((d) => path.join(d, 'applications')),
    '/var/lib/flatpak/exports/share/applications',
    path.join(home, '.local/share/flatpak/exports/share/applications'),
    '/var/lib/snapd/desktop/applications',
  ];
  const apps = new Map();
  const seenIds = new Set();
  for (const root of [...new Set(roots)]) {
    const files = [];
    await walk(root, 2, (full, name) => {
      if (name.endsWith('.desktop')) files.push([full, name]);
    });
    for (const [full, name] of files) {
      if (seenIds.has(name)) continue; // earlier dirs take precedence (XDG rules)
      seenIds.add(name);
      let entry;
      try {
        entry = parseDesktopEntry(await fs.promises.readFile(full, 'utf8'), lang);
      } catch {
        continue;
      }
      if (entry.type !== 'Application' || entry.noDisplay || !entry.name || !entry.exec) continue;
      const key = entry.name.toLowerCase();
      if (apps.has(key)) continue;
      apps.set(key, {
        title: entry.name,
        path: full,
        iconPath: resolveLinuxIcon(entry.icon),
        keywords: [entry.englishName, entry.genericName, ...entry.keywords].filter((k) => k && k !== entry.name),
        launch: { kind: 'desktop', id: name.replace(/\.desktop$/, ''), exec: entry.exec, terminal: entry.terminal },
      });
    }
  }
  return [...apps.values()];
}

/** Splits an Exec= line into argv, dropping %f/%U style field codes. */
function parseExec(exec) {
  const args = [];
  let cur = '';
  let quoted = false;
  let had = false;
  for (let i = 0; i < exec.length; i++) {
    const ch = exec[i];
    if (quoted) {
      if (ch === '\\' && i + 1 < exec.length) cur += exec[++i];
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') {
      quoted = true;
      had = true;
    } else if (/\s/.test(ch)) {
      if (cur || had) args.push(cur);
      cur = '';
      had = false;
    } else {
      cur += ch;
    }
  }
  if (cur || had) args.push(cur);
  return args.filter((a) => !/^%[a-zA-Z]$/.test(a)).map((a) => a.replace(/%%/g, '%'));
}

function createApps(ctx) {
  let apps = [];
  let items = [];
  let scanning = null;

  function launch(app) {
    const { system } = ctx;
    const { shell } = ctx.electron;
    const l = app.launch;
    if (l.kind === 'path') return shell.openPath(l.path);
    if (l.kind === 'appid') {
      system.launchDetached('explorer.exe', [`shell:AppsFolder\\${l.id}`]);
      return '';
    }
    if (l.kind === 'desktop') {
      if (system.which('gtk-launch')) {
        system.launchDetached('gtk-launch', [l.id]);
      } else {
        const argv = parseExec(l.exec);
        if (!argv.length) return 'Пустая команда запуска';
        system.launchDetached(argv[0], argv.slice(1));
      }
      return '';
    }
    return 'Неизвестный способ запуска';
  }

  function toItem(app) {
    const actions = [
      {
        id: 'open',
        title: 'Открыть',
        run: async () => {
          const err = await launch(app);
          return err ? { error: err } : { hide: true };
        },
      },
    ];
    if (app.path && app.launch.kind !== 'desktop') actions.push(A.reveal(app.path), A.copyPath(app.path));
    let icon = 'app';
    if (app.iconPath) icon = { kind: 'image', path: app.iconPath };
    else if (app.path && process.platform !== 'linux') icon = { kind: 'file', path: app.path };
    return {
      id: `app:${app.title.toLowerCase()}`,
      title: app.title,
      subtitle: app.path ? ctx.system.tildify(app.path) : 'Приложение Microsoft Store',
      keywords: [...(app.keywords || []), 'app', 'приложение'],
      category: 'Приложение',
      icon,
      bias: 2,
      actions,
      launchApp: () => launch(app),
    };
  }

  async function scan() {
    if (scanning) return scanning;
    scanning = (async () => {
      try {
        if (process.platform === 'win32') apps = await discoverWindows(ctx.system);
        else if (process.platform === 'darwin') apps = await discoverMac();
        else apps = await discoverLinux();
        items = apps.map(toItem);
      } catch (err) {
        console.error('[palitra] app discovery failed', err);
      } finally {
        scanning = null;
      }
    })();
    return scanning;
  }

  return {
    name: 'apps',
    scan,
    items: () => items,
    count: () => items.length,
    /** Finds an app by (case-insensitive) name, for macros: { type: "open", target: "Telegram" }. */
    findByName(name) {
      const n = String(name).toLowerCase();
      return items.find((i) => i.title.toLowerCase() === n) || null;
    },
  };
}

module.exports = { createApps, parseDesktopEntry, parseExec };
