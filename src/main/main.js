'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  globalShortcut,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  screen,
  shell,
} = require('electron');

const system = require('./system');
const clip = require('./clipboard');
const { Config } = require('./settings');
const { DebouncedJsonFile, readJson } = require('./store');
const { Frecency } = require('../core/frecency');
const { toAccelerator } = require('../core/keys');
const { SearchEngine, serialize } = require('./search');
const { createBuiltins } = require('./providers/builtins');
const { createQuick } = require('./providers/quick');
const { createCurrency } = require('./providers/currency');
const { createTranslate } = require('./providers/translate');
const { createApps } = require('./providers/apps');
const { createFiles } = require('./providers/files');
const { createMacros } = require('./providers/macros');
const { createWeb } = require('./providers/web');

const DEV = process.argv.includes('--dev') || process.env.PALITRA_DEV === '1';
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const WINDOW_SIZE = { width: 760, height: 560 };
const FALLBACK_HOTKEYS = ['Alt+Space', 'CommandOrControl+Shift+Space', 'CommandOrControl+Alt+Space'];

if (process.env.PALITRA_USER_DATA) app.setPath('userData', path.resolve(process.env.PALITRA_USER_DATA));
if (system.isWin) app.setAppUserModelId('io.github.abdulvoris2984.palitra');

let win = null;
let tray = null;
let config = null;
let frecency = null;
let frecencyFile = null;
let engine = null;
let providers = null;
let ctx = null;
let activeHotkey = null;
let tools = null;
let quitting = false;
let reindexTimer = null;
let clipboardCache = '';
const iconCache = new Map();
const rendererRequests = new Map();
let rendererRequestId = 0;

// ---------------------------------------------------------------- window ---

function createWindow() {
  win = new BrowserWindow({
    ...WINDOW_SIZE,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: 'Palitra',
    type: system.isMac ? 'panel' : undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.setMenu(null);
  win.setAlwaysOnTop(true, 'pop-up-menu');
  if (system.isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), {
    query: { dark: nativeTheme.shouldUseDarkColors ? '1' : '0' },
  });

  win.on('blur', () => {
    if (!config.settings.hideOnBlur || DEV || win.webContents.isDevToolsOpened()) return;
    hidePalette();
  });
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      hidePalette();
    }
  });
  // Never navigate away from the palette (e.g. a dropped link).
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (DEV) win.webContents.openDevTools({ mode: 'detach' });
}

function positionWindow() {
  const point = screen.getCursorScreenPoint();
  const { x, y, width, height } = screen.getDisplayNearestPoint(point).workArea;
  const [w] = win.getSize();
  win.setPosition(Math.round(x + (width - w) / 2), Math.round(y + Math.max(0, height * 0.16 - 18)));
}

function showPalette(extra = {}) {
  if (!win) return;
  if (!win.isVisible()) positionWindow();
  win.show();
  win.focus();
  if (system.isWin || system.isLinux) win.moveTop();
  win.webContents.send('palette:shown', extra);
}

function hidePalette() {
  if (!win || !win.isVisible()) return;
  win.hide();
  // On macOS hand the focus back to the app that was active before.
  if (system.isMac && !quitting) app.hide();
}

function togglePalette() {
  if (win && win.isVisible() && win.isFocused()) hidePalette();
  else showPalette();
}

// -------------------------------------------------------------- services ---

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body: body || '', silent: true, icon: path.join(ASSETS, 'icon.png') });
  if (onClick) n.on('click', onClick);
  n.show();
}

async function fetchWithTimeout(url, { timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await net.fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Palitra/1.0' } });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Превышено время ожидания');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function pasteText(text, { alreadyHidden = false } = {}) {
  await clip.writeText(text);
  if (!alreadyHidden) hidePalette();
  await system.pasteIntoActiveApp(alreadyHidden ? 60 : 180);
}

/** Asks the renderer (Chromium) to re-encode an image; see renderer/app.js. */
function convertImage(bytes, inExt, outMime, scale) {
  return new Promise((resolve, reject) => {
    const id = ++rendererRequestId;
    const timer = setTimeout(() => {
      rendererRequests.delete(id);
      reject(new Error('Конвертация изображения заняла слишком много времени'));
    }, 120000);
    rendererRequests.set(id, { resolve, reject, timer });
    win.webContents.send('worker:request', { id, type: 'convert-image', payload: { bytes, inExt, outMime, scale } });
  });
}

function detectTools() {
  system.clearWhichCache();
  tools = {
    soffice: system.findSoffice(),
    ffmpeg: system.findFfmpeg(),
    sips: system.isMac && fs.existsSync('/usr/bin/sips') ? '/usr/bin/sips' : null,
  };
  return tools;
}

async function getIcon(ref) {
  if (!ref || !ref.path) return null;
  const key = `${ref.kind}:${ref.key || ref.path}`;
  if (iconCache.has(key)) return iconCache.get(key);
  let url = null;
  try {
    if (ref.kind === 'image') {
      const ext = path.extname(ref.path).toLowerCase();
      if (ext === '.svg') {
        url = `data:image/svg+xml;base64,${(await fs.promises.readFile(ref.path)).toString('base64')}`;
      } else {
        const img = nativeImage.createFromPath(ref.path);
        if (!img.isEmpty()) url = img.resize({ width: 64, quality: 'best' }).toDataURL();
      }
    } else if (ref.kind === 'file') {
      const img = await app.getFileIcon(ref.path, { size: system.isMac ? 'normal' : 'large' });
      if (img && !img.isEmpty()) url = img.toDataURL();
    }
  } catch {
    url = null;
  }
  if (iconCache.size > 1000) iconCache.delete(iconCache.keys().next().value);
  iconCache.set(key, url);
  return url;
}

// ----------------------------------------------------- hotkeys & startup ---

function tryRegister(accelerator, fn) {
  if (!accelerator) return false;
  try {
    return globalShortcut.register(accelerator, fn);
  } catch {
    return false; // invalid accelerator syntax
  }
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const wanted = config.settings.hotkey;
  activeHotkey = null;
  for (const acc of [...new Set([wanted, ...FALLBACK_HOTKEYS])]) {
    if (tryRegister(acc, togglePalette)) {
      activeHotkey = acc;
      break;
    }
  }
  if (activeHotkey !== wanted) {
    notify('Горячая клавиша недоступна', activeHotkey ? `«${wanted}» занята — используется ${activeHotkey}` : `Не удалось зарегистрировать «${wanted}»`);
  }

  // Global hotkeys for individual macros ("hotkey" in macros.json) and for
  // any command ("commandHotkeys" in settings.json).
  const bindings = [];
  for (const m of providers.macros.items()) if (m.hotkey) bindings.push([m.hotkey, m.id]);
  for (const [id, acc] of Object.entries(config.settings.commandHotkeys || {})) bindings.push([acc, id]);
  for (const [acc, id] of bindings) {
    const ok = tryRegister(acc, () => runHotkeyCommand(id));
    if (!ok) console.warn(`[palitra] cannot register hotkey ${acc} for ${id}`);
  }
  updateTray();
}

async function runHotkeyCommand(id) {
  const item = engine.resolve(id);
  if (!item) return notify('Palitra', `Команда ${id} не найдена`);
  if (item.input) {
    // Commands that need an argument open the palette in input mode.
    engine.register([item]);
    return showPalette({ inputFor: serialize(item) });
  }
  const res = await engine.execute({ itemId: id, query: '' });
  if (res && res.error) notify('Palitra', res.error);
  else if (res && (res.query !== undefined || res.detail || res.actionsFor)) showPalette({ result: res });
}

function setHotkey(accelerator) {
  if (activeHotkey) globalShortcut.unregister(activeHotkey);
  if (!tryRegister(accelerator, togglePalette)) {
    tryRegister(activeHotkey, togglePalette);
    return false;
  }
  globalShortcut.unregister(accelerator);
  config.update('hotkey', accelerator);
  return true;
}

function autostartDesktopFile() {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', 'palitra.desktop');
}

function applyLaunchAtLogin(enabled) {
  if (!app.isPackaged) return; // never register the development Electron binary
  if (system.isLinux) {
    const file = autostartDesktopFile();
    if (enabled) {
      const exec = process.env.APPIMAGE || process.execPath;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Palitra\nExec="${exec}" --hidden\nX-GNOME-Autostart-enabled=true\n`);
    } else if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
    return;
  }
  app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true, args: ['--hidden'] });
}

function setLaunchAtLogin(enabled) {
  config.update('launchAtLogin', Boolean(enabled));
}

// ------------------------------------------------------------------ tray ---

function createTray() {
  const file = system.isMac ? 'trayTemplate.png' : 'tray.png';
  let image = nativeImage.createFromPath(path.join(ASSETS, file));
  if (image.isEmpty()) image = nativeImage.createFromPath(path.join(ASSETS, 'icon.png')).resize({ width: 16 });
  if (system.isMac) image.setTemplateImage(true);
  try {
    tray = new Tray(image);
  } catch (err) {
    console.warn('[palitra] tray unavailable:', err.message);
    return;
  }
  tray.on('click', () => showPalette());
  updateTray();
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip(`Palitra — ${activeHotkey || 'горячая клавиша не задана'}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Открыть палитру${activeHotkey ? `  (${activeHotkey})` : ''}`, click: () => showPalette() },
      { type: 'separator' },
      { label: 'Настройки…', click: () => shell.openPath(config.settingsFile) },
      { label: 'Макросы…', click: () => shell.openPath(config.macrosFile) },
      { label: 'Переиндексировать файлы', click: () => reindex() },
      {
        label: 'Запускать при входе в систему',
        type: 'checkbox',
        checked: Boolean(config.settings.launchAtLogin),
        click: (mi) => setLaunchAtLogin(mi.checked),
      },
      { type: 'separator' },
      { label: 'Выйти', click: () => quit() },
    ]),
  );
}

// ------------------------------------------------------------- lifecycle ---

function reindex() {
  detectTools();
  providers.apps.scan();
  providers.files.index();
}

function scheduleReindex() {
  clearInterval(reindexTimer);
  const minutes = Math.max(5, Number(config.settings.files.reindexMinutes) || 30);
  reindexTimer = setInterval(() => providers.files.index(), minutes * 60 * 1000);
}

function quit() {
  quitting = true;
  app.quit();
}

function buildContext() {
  ctx = {
    config,
    frecency,
    system,
    electron: { app, shell, nativeImage },
    clipboard: clip,
    paths: { data: app.getPath('userData') },
    fetch: fetchWithTimeout,
    tools: () => tools || detectTools(),
    hide: hidePalette,
    show: showPalette,
    notify,
    copy: (text) => clip.writeText(text),
    pasteText,
    convertImage,
    // Clipboard text snapshot taken once per search, for synchronous previews.
    clipboardText: () => clipboardCache,
    loadClipboard: async () => {
      clipboardCache = await clip.readText();
      return clipboardCache;
    },
    saveFrecency: () => frecencyFile.schedule(),
    reloadConfig: () => {
      config.load();
      config.emit();
    },
    reindex,
    setHotkey,
    getLaunchAtLogin: () => Boolean(config.settings.launchAtLogin),
    setLaunchAtLogin,
    quit,
    makeFileItem: (p, opts) => providers.files.makeFileItem(p, opts),
    findApp: (name) => providers.apps.findByName(name),
    runCommand: (id, actionId, arg) => engine.runCommand(id, actionId, arg),
  };
  return ctx;
}

function setupIpc() {
  ipcMain.handle('palette:search', async (event, { query, seq }) => {
    const push = (s, items) => {
      if (!event.sender.isDestroyed()) event.sender.send('palette:results', { seq: s, items });
    };
    return { seq, ...(await engine.search(query, seq, push)) };
  });
  ipcMain.handle('palette:execute', async (_e, payload) => {
    const result = await engine.execute(payload);
    if (result && result.hide) hidePalette();
    return result;
  });
  ipcMain.handle('palette:icon', (_e, ref) => getIcon(ref));
  ipcMain.handle('palette:accelerator', (_e, keyEvent) => toAccelerator(keyEvent));
  ipcMain.handle('palette:info', () => ({
    version: app.getVersion(),
    hotkey: activeHotkey,
    platform: process.platform,
    files: providers.files.count(),
    apps: providers.apps.count(),
    indexing: providers.files.isIndexing(),
  }));
  ipcMain.on('palette:hide', () => hidePalette());
  ipcMain.on('worker:response', (_e, { id, result, error }) => {
    const req = rendererRequests.get(id);
    if (!req) return;
    rendererRequests.delete(id);
    clearTimeout(req.timer);
    if (error) req.reject(new Error(error));
    else req.resolve(result);
  });
}

function start() {
  config = new Config(app.getPath('userData'));
  config.load();
  nativeTheme.themeSource = ['light', 'dark'].includes(config.settings.theme) ? config.settings.theme : 'system';

  const usagePath = path.join(app.getPath('userData'), 'usage.json');
  frecency = new Frecency(readJson(usagePath, {}));
  frecencyFile = new DebouncedJsonFile(usagePath, () => frecency.toJSON());

  buildContext();
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

  setupIpc();
  createWindow();
  createTray();
  registerHotkeys();
  applyLaunchAtLogin(Boolean(config.settings.launchAtLogin));
  reindex();
  scheduleReindex();

  nativeTheme.on('updated', () => {
    if (win) win.webContents.send('palette:theme', nativeTheme.shouldUseDarkColors);
  });

  config.watch();
  let filesSettings = JSON.stringify(config.settings.files);
  config.onChange(() => {
    nativeTheme.themeSource = ['light', 'dark'].includes(config.settings.theme) ? config.settings.theme : 'system';
    registerHotkeys();
    applyLaunchAtLogin(Boolean(config.settings.launchAtLogin));
    scheduleReindex();
    if (JSON.stringify(config.settings.files) !== filesSettings) {
      filesSettings = JSON.stringify(config.settings.files);
      providers.files.index();
    }
    if (win) win.webContents.send('palette:config-changed');
  });

  // Started by the OS at login: stay in the tray until the hotkey is pressed.
  const startHidden =
    process.argv.includes('--hidden') || (system.isMac && app.getLoginItemSettings().wasOpenedAtLogin);
  if (!startHidden) win.once('ready-to-show', () => showPalette());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showPalette());
  if (system.isMac && app.dock) app.dock.hide();
  app.whenReady().then(start);
  // Keep running in the tray when the palette window is hidden or closed.
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (frecencyFile) frecencyFile.flush();
    if (config) config.close();
  });
  process.on('unhandledRejection', (err) => console.error('[palitra] unhandled rejection', err));
}
