'use strict';

// Platform-specific operations: sending keystrokes, locking the screen,
// power actions, finding executables.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const keys = require('../core/keys');

const platform = process.platform;
const isWin = platform === 'win32';
const isMac = platform === 'darwin';
const isLinux = platform === 'linux';

function run(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: opts.timeout ?? 15000, maxBuffer: 32 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/** Starts a process that outlives Palitra and is not tied to its console. */
function launchDetached(cmd, args = [], opts = {}) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false, ...opts });
  child.on('error', (err) => console.warn(`[palitra] cannot start ${cmd}: ${err.message}`));
  child.unref();
}

const whichCache = new Map();

/** Finds an executable on PATH (honours PATHEXT on Windows). */
function which(name) {
  if (whichCache.has(name)) return whichCache.get(name);
  const exts = isWin ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  let found = null;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (fs.statSync(candidate).isFile()) {
          found = candidate;
          break;
        }
      } catch {
        // not here
      }
    }
    if (found) break;
  }
  whichCache.set(name, found);
  return found;
}

function clearWhichCache() {
  whichCache.clear();
}

function firstExisting(paths) {
  return paths.find((p) => p && fs.existsSync(p)) || null;
}

function findSoffice() {
  return (
    which('soffice') ||
    which('libreoffice') ||
    firstExisting(
      isWin
        ? [
            path.join(process.env.ProgramFiles || 'C:\\Program Files', 'LibreOffice', 'program', 'soffice.exe'),
            path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'LibreOffice', 'program', 'soffice.exe'),
          ]
        : isMac
          ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice']
          : ['/usr/bin/soffice', '/usr/lib/libreoffice/program/soffice', '/snap/bin/libreoffice'],
    )
  );
}

function findFfmpeg() {
  return (
    which('ffmpeg') ||
    firstExisting(isMac ? ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'] : isWin ? ['C:\\ffmpeg\\bin\\ffmpeg.exe'] : [])
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Sends a key combination to whatever window has focus. */
async function sendKeys(combo) {
  if (isWin) {
    const sk = keys.toSendKeys(combo).replace(/'/g, "''");
    await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
      `$w = New-Object -ComObject WScript.Shell; $w.SendKeys('${sk}')`,
    ]);
  } else if (isMac) {
    await run('osascript', ['-e', keys.toAppleScript(combo)]);
  } else if (process.env.WAYLAND_DISPLAY && which('wtype') && !which('xdotool')) {
    const { mods, key } = keys.parseCombo(combo, 'linux');
    const args = [];
    for (const m of mods) args.push('-M', m === 'meta' ? 'logo' : m);
    if ([...key].length === 1) args.push(key);
    else args.push('-k', keys.toXdotool(key));
    for (const m of mods) args.push('-m', m === 'meta' ? 'logo' : m);
    await run('wtype', args);
  } else if (which('xdotool')) {
    await run('xdotool', ['key', '--clearmodifiers', keys.toXdotool(combo)]);
  } else {
    throw new Error('Для эмуляции клавиш установите xdotool (X11) или wtype (Wayland)');
  }
}

/** Pastes the clipboard into the previously focused app (after Palitra hid). */
async function pasteIntoActiveApp(delay = 180) {
  await sleep(delay);
  await sendKeys('mod+v');
}

async function lockScreen() {
  if (isWin) return run('rundll32.exe', ['user32.dll,LockWorkStation']);
  if (isMac) {
    return run('osascript', ['-e', 'tell application "System Events" to keystroke "q" using {control down, command down}']);
  }
  for (const [cmd, args] of [
    ['loginctl', ['lock-session']],
    ['xdg-screensaver', ['lock']],
    ['gnome-screensaver-command', ['-l']],
  ]) {
    if (which(cmd)) return run(cmd, args);
  }
  throw new Error('Не найдено средство блокировки экрана');
}

async function sleepComputer() {
  if (isWin) return run('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']);
  if (isMac) return run('pmset', ['sleepnow']);
  return run('systemctl', ['suspend']);
}

async function shutdown() {
  if (isWin) return run('shutdown', ['/s', '/t', '0']);
  if (isMac) return run('osascript', ['-e', 'tell application "System Events" to shut down']);
  return run('systemctl', ['poweroff']);
}

async function restart() {
  if (isWin) return run('shutdown', ['/r', '/t', '0']);
  if (isMac) return run('osascript', ['-e', 'tell application "System Events" to restart']);
  return run('systemctl', ['reboot']);
}

async function emptyTrash() {
  if (isWin) {
    return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Clear-RecycleBin -Force -ErrorAction SilentlyContinue']);
  }
  if (isMac) return run('osascript', ['-e', 'tell application "Finder" to empty trash']);
  if (which('gio')) return run('gio', ['trash', '--empty']);
  throw new Error('Не удалось очистить корзину: нет утилиты gio');
}

function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** "/home/me/Documents/x" -> "~/Documents/x" for compact display. */
function tildify(p) {
  const home = os.homedir();
  if (p === home) return '~';
  if (p.startsWith(home + path.sep)) return '~' + p.slice(home.length);
  return p;
}

module.exports = {
  isWin,
  isMac,
  isLinux,
  platform,
  run,
  launchDetached,
  which,
  clearWhichCache,
  findSoffice,
  findFfmpeg,
  sendKeys,
  pasteIntoActiveApp,
  lockScreen,
  sleepComputer,
  shutdown,
  restart,
  emptyTrash,
  expandHome,
  tildify,
  sleep,
};
