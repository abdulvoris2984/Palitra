'use strict';

// Translates a portable key combo ("ctrl+shift+t", "mod+v", "enter") into
// the syntax of each platform's keystroke tool:
//   Windows: WScript.Shell SendKeys, macOS: AppleScript, Linux: xdotool.

const MODS = {
  ctrl: 'ctrl', control: 'ctrl', ctl: 'ctrl',
  shift: 'shift',
  alt: 'alt', option: 'alt', opt: 'alt',
  cmd: 'meta', command: 'meta', meta: 'meta', win: 'meta', super: 'meta',
  mod: 'mod', cmdorctrl: 'mod', commandorcontrol: 'mod',
};

const KEY_ALIASES = {
  return: 'enter', esc: 'escape', del: 'delete', bs: 'backspace', pgup: 'pageup',
  pgdn: 'pagedown', arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right',
  spacebar: 'space',
};

function parseCombo(combo, platform) {
  const parts = String(combo).toLowerCase().split('+').map((p) => p.trim());
  // "ctrl++" -> last part is "+"
  if (parts.length > 1 && parts[parts.length - 1] === '' && parts[parts.length - 2] === '') {
    parts.splice(-2, 2, '+');
  }
  const mods = new Set();
  let key = null;
  for (const p of parts) {
    if (!p) continue;
    if (MODS[p] && key === null && p !== parts[parts.length - 1]) {
      let m = MODS[p];
      if (m === 'mod') m = platform === 'darwin' ? 'meta' : 'ctrl';
      mods.add(m);
    } else {
      key = KEY_ALIASES[p] || p;
    }
  }
  if (!key) throw new Error(`Нет клавиши в сочетании "${combo}"`);
  return { mods, key };
}

const SENDKEYS_SPECIAL = {
  enter: '{ENTER}', tab: '{TAB}', escape: '{ESC}', space: ' ', backspace: '{BACKSPACE}',
  delete: '{DELETE}', up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
  home: '{HOME}', end: '{END}', pageup: '{PGUP}', pagedown: '{PGDN}', insert: '{INSERT}',
};

function toSendKeys(combo) {
  const { mods, key } = parseCombo(combo, 'win32');
  if (mods.has('meta')) throw new Error('SendKeys не поддерживает клавишу Win');
  let k = SENDKEYS_SPECIAL[key];
  if (!k && /^f([1-9]|1[0-6])$/.test(key)) k = `{${key.toUpperCase()}}`;
  if (!k) {
    if ([...key].length !== 1) throw new Error(`Неизвестная клавиша "${key}"`);
    k = '+^%~(){}[]'.includes(key) ? `{${key}}` : key;
  }
  let prefix = '';
  if (mods.has('ctrl')) prefix += '^';
  if (mods.has('shift')) prefix += '+';
  if (mods.has('alt')) prefix += '%';
  return prefix + k;
}

const XDO_SPECIAL = {
  enter: 'Return', tab: 'Tab', escape: 'Escape', space: 'space', backspace: 'BackSpace',
  delete: 'Delete', up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home',
  end: 'End', pageup: 'Prior', pagedown: 'Next', insert: 'Insert', '+': 'plus', '-': 'minus',
};

function toXdotool(combo) {
  const { mods, key } = parseCombo(combo, 'linux');
  let k = XDO_SPECIAL[key];
  if (!k && /^f([1-9]|1[0-2])$/.test(key)) k = key.toUpperCase();
  if (!k) k = key;
  const order = ['ctrl', 'shift', 'alt', 'meta'].filter((m) => mods.has(m)).map((m) => (m === 'meta' ? 'super' : m));
  return [...order, k].join('+');
}

const MAC_KEY_CODES = {
  enter: 36, tab: 48, escape: 53, space: 49, backspace: 51, delete: 117, left: 123,
  right: 124, down: 125, up: 126, home: 115, end: 119, pageup: 116, pagedown: 121,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101,
  f10: 109, f11: 103, f12: 111,
};

function toAppleScript(combo) {
  const { mods, key } = parseCombo(combo, 'darwin');
  const using = [];
  if (mods.has('meta')) using.push('command down');
  if (mods.has('ctrl')) using.push('control down');
  if (mods.has('alt')) using.push('option down');
  if (mods.has('shift')) using.push('shift down');
  const suffix = using.length ? ` using {${using.join(', ')}}` : '';
  if (MAC_KEY_CODES[key] !== undefined) {
    return `tell application "System Events" to key code ${MAC_KEY_CODES[key]}${suffix}`;
  }
  if ([...key].length !== 1) throw new Error(`Неизвестная клавиша "${key}"`);
  const escaped = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `tell application "System Events" to keystroke "${escaped}"${suffix}`;
}

const CODE_NAMES = {
  Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
};

/**
 * Converts a keydown event (as captured in the renderer) into an Electron
 * accelerator, e.g. { ctrl, shift, code: 'KeyK' } -> "Ctrl+Shift+K".
 * Uses the physical key code, so it works the same on any keyboard layout.
 */
function toAccelerator({ ctrl, alt, shift, meta, code }, platform = process.platform) {
  let k = CODE_NAMES[code];
  let m;
  if (!k && (m = /^Key([A-Z])$/.exec(code))) k = m[1];
  if (!k && (m = /^(?:Digit|Numpad)([0-9])$/.exec(code))) k = m[1];
  if (!k && /^F([1-9]|1[0-9]|2[0-4])$/.test(code)) k = code;
  if (!k) return null; // modifier alone or unsupported key
  const parts = [];
  if (ctrl) parts.push('Ctrl');
  if (meta) parts.push(platform === 'darwin' ? 'Command' : 'Super');
  if (alt) parts.push(platform === 'darwin' ? 'Option' : 'Alt');
  if (shift) parts.push('Shift');
  if (!parts.length && !/^F\d+$/.test(k)) return null; // a bare letter would hijack typing
  if (parts.length === 1 && parts[0] === 'Shift' && !/^F\d+$/.test(k)) return null;
  parts.push(k);
  return parts.join('+');
}

module.exports = { parseCombo, toSendKeys, toXdotool, toAppleScript, toAccelerator };
