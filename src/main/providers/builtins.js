'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../actions');
const { TRANSFORMS, applyTransform } = require('../../core/transforms');

function oneLine(s, max = 70) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function password(length = 16) {
  const sets = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%^&*-_=+?'];
  const all = sets.join('');
  const pick = (chars) => chars[crypto.randomInt(chars.length)];
  const out = sets.map(pick); // at least one of each kind
  while (out.length < length) out.push(pick(all));
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function localDateTime(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.';

function transformItem(t) {
  return {
    id: `text:${t.id}`,
    title: t.title,
    keywords: [...t.keywords, 'clipboard', 'буфер', 'текст'],
    category: 'Текст',
    icon: 'text',
    preview(ctx) {
      const text = ctx.clipboardText();
      if (!text) return 'Скопируйте текст (Ctrl+C), затем выберите команду';
      try {
        const out = applyTransform(t.id, text);
        return t.info ? out : `Буфер → ${oneLine(out)}`;
      } catch (err) {
        return `Не подходит для текста в буфере: ${err.message}`;
      }
    },
    actions: [
      {
        id: t.info ? 'show' : 'copy',
        title: t.info ? 'Показать' : 'Заменить текст в буфере',
        run: async (_arg, ctx) => {
          const text = await ctx.clipboard.readText();
          if (!text) return { error: 'В буфере обмена нет текста' };
          const out = applyTransform(t.id, text);
          if (t.info) return { detail: out };
          await ctx.copy(out);
          return { hide: true };
        },
      },
      {
        id: 'paste',
        title: 'Преобразовать и вставить в активное окно',
        run: async (_arg, ctx) => {
          const text = await ctx.clipboard.readText();
          if (!text) return { error: 'В буфере обмена нет текста' };
          await ctx.pasteText(applyTransform(t.id, text));
          return { hide: true };
        },
      },
      {
        id: 'show',
        title: 'Показать результат',
        run: async (_arg, ctx) => {
          const text = await ctx.clipboard.readText();
          if (!text) return { error: 'В буфере обмена нет текста' };
          return { detail: applyTransform(t.id, text) };
        },
      },
    ],
  };
}

function cmd(id, title, keywords, icon, run, extra = {}) {
  return {
    id: `cmd:${id}`,
    title,
    keywords,
    icon,
    category: extra.category || 'Palitra',
    ...extra,
    actions: [{ id: 'run', title: extra.runTitle || 'Выполнить', run }, ...(extra.moreActions || [])],
  };
}

function systemItems(ctx) {
  const { system } = ctx;
  const { shell, app } = ctx.electron;
  const items = [];
  const sys = (id, title, keywords, icon, run, extra) => cmd(id, title, keywords, icon, run, { category: 'Система', ...extra });

  items.push(
    sys('lock', 'Заблокировать компьютер', ['lock screen', 'блокировка', 'замок'], 'lock', async () => {
      await system.lockScreen();
      return { hide: true };
    }),
    sys('sleep', 'Спящий режим', ['sleep', 'suspend', 'сон'], 'moon', async () => {
      await system.sleepComputer();
      return { hide: true };
    }, { confirm: 'Компьютер уснёт. Нажмите Enter ещё раз' }),
    sys('restart', 'Перезагрузить компьютер', ['restart', 'reboot', 'ребут'], 'restart', async () => {
      await system.restart();
      return { hide: true };
    }, { confirm: 'Все программы будут закрыты. Нажмите Enter ещё раз' }),
    sys('shutdown', 'Выключить компьютер', ['shutdown', 'power off', 'выключение'], 'power', async () => {
      await system.shutdown();
      return { hide: true };
    }, { confirm: 'Компьютер выключится. Нажмите Enter ещё раз' }),
    sys('emptyTrash', 'Очистить корзину', ['empty trash', 'recycle bin', 'корзина'], 'trash', async () => {
      await system.emptyTrash();
      return { keepOpen: true, toast: 'Корзина очищена' };
    }, { confirm: 'Файлы удалятся навсегда. Нажмите Enter ещё раз' }),
  );

  const folders = [
    ['home', 'Домашняя папка', ['home', 'user folder', 'дом']],
    ['desktop', 'Рабочий стол', ['desktop']],
    ['documents', 'Документы', ['documents', 'docs']],
    ['downloads', 'Загрузки', ['downloads']],
    ['pictures', 'Изображения', ['pictures', 'photos', 'картинки', 'фото']],
    ['music', 'Музыка', ['music']],
    ['videos', 'Видео', ['videos', 'movies']],
  ];
  for (const [key, title, keywords] of folders) {
    let p;
    try {
      p = app.getPath(key);
    } catch {
      continue;
    }
    items.push({
      id: `folder:${key}`,
      title: `Папка «${title}»`,
      subtitle: system.tildify(p),
      keywords: [...keywords, 'folder', 'папка', title],
      category: 'Папка',
      icon: 'folder',
      actions: [A.openPath(p), A.copyPath(p)],
    });
  }

  const launch = (cmdName, args) => () => {
    system.launchDetached(cmdName, args);
    return { hide: true };
  };
  if (system.isWin) {
    items.push(
      sys('screenshot', 'Снимок области экрана', ['screenshot', 'snip', 'скриншот', 'снимок'], 'screenshot', () => {
        shell.openExternal('ms-screenclip:');
        return { hide: true };
      }),
      sys('osSettings', 'Параметры Windows', ['windows settings', 'control panel', 'параметры', 'панель управления'], 'settings', () => {
        shell.openExternal('ms-settings:');
        return { hide: true };
      }),
      sys('taskmgr', 'Диспетчер задач', ['task manager', 'processes', 'процессы'], 'activity', launch('taskmgr.exe', [])),
      sys('terminal', 'Терминал', ['terminal', 'console', 'cmd', 'powershell', 'консоль'], 'terminal', launch(system.which('wt') ? 'wt.exe' : 'cmd.exe', [])),
    );
  } else if (system.isMac) {
    items.push(
      sys('screenshot', 'Снимок области экрана в буфер', ['screenshot', 'скриншот', 'снимок'], 'screenshot', async () => {
        ctx.hide();
        await system.sleep(250);
        system.launchDetached('screencapture', ['-i', '-c']);
        return { hide: true };
      }),
      sys('osSettings', 'Системные настройки', ['system settings', 'preferences', 'настройки системы'], 'settings', () => {
        shell.openExternal('x-apple.systempreferences:');
        return { hide: true };
      }),
      sys('taskmgr', 'Мониторинг системы', ['activity monitor', 'task manager', 'процессы'], 'activity', launch('open', ['-a', 'Activity Monitor'])),
      sys('terminal', 'Терминал', ['terminal', 'console', 'консоль'], 'terminal', launch('open', ['-a', 'Terminal'])),
    );
  } else {
    const term = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'kitty', 'alacritty', 'xterm'].find((t) => system.which(t));
    if (term) items.push(sys('terminal', 'Терминал', ['terminal', 'console', 'консоль'], 'terminal', launch(term, [])));
    const mon = ['gnome-system-monitor', 'plasma-systemmonitor', 'ksysguard', 'xfce4-taskmanager'].find((t) => system.which(t));
    if (mon) items.push(sys('taskmgr', 'Системный монитор', ['task manager', 'system monitor', 'процессы'], 'activity', launch(mon, [])));
    const shot = system.which('gnome-screenshot') ? ['gnome-screenshot', ['-a', '-c']] : system.which('spectacle') ? ['spectacle', ['-r', '-c']] : null;
    if (shot) items.push(sys('screenshot', 'Снимок области экрана', ['screenshot', 'скриншот', 'снимок'], 'screenshot', launch(shot[0], shot[1])));
    const settingsApp = ['gnome-control-center', 'systemsettings', 'xfce4-settings-manager'].find((t) => system.which(t));
    if (settingsApp) items.push(sys('osSettings', 'Настройки системы', ['system settings', 'настройки системы'], 'settings', launch(settingsApp, [])));
  }
  return items;
}

function paletteItems(ctx) {
  const { shell } = ctx.electron;
  const { config } = ctx;
  const autostart = ctx.getLaunchAtLogin();
  const hotkey = config.settings.hotkey;
  return [
    cmd('translate', 'Перевести текст…', ['translate', 'translator', 'перевод', 'переводчик', 'google translate'], 'translate', () => ({ query: 'tr ' }), {
      subtitle: 'Префикс «tr »: tr привет · tr it: good morning',
      category: 'Перевод',
      suggest: true,
    }),
    cmd('translateClipboard', 'Перевести текст из буфера обмена', ['translate clipboard', 'перевод буфера'], 'translate', async () => {
      const text = (await ctx.clipboard.readText()).replace(/\s+/g, ' ').trim().slice(0, 1000);
      if (!text) return { error: 'В буфере обмена нет текста' };
      return { query: `tr ${text}` };
    }, { category: 'Перевод', preview: (c) => (c.clipboardText() ? `«${oneLine(c.clipboardText(), 60)}»` : 'Буфер обмена пуст') }),
    cmd('files', 'Найти файл…', ['find file', 'search files', 'поиск файлов', 'файлы'], 'search', () => ({ query: 'f ' }), {
      subtitle: 'Префикс «f »: f отчёт pdf · или путь: ~/Documents/',
      category: 'Файлы',
      suggest: true,
    }),
    cmd('convertFile', 'Конвертировать файл…', ['convert file', 'конвертер', 'формат', 'png jpg pdf mp3 csv json'], 'convert', () => ({ query: 'conv ' }), {
      subtitle: 'Найдите файл и выберите формат: PNG, JPG, WEBP, PDF, MP3, JSON…',
      category: 'Конвертер',
      suggest: true,
    }),
    cmd('convertClipboardFile', 'Конвертировать скопированный файл', ['convert copied file', 'конвертировать из буфера'], 'convert', async () => {
      const files = await ctx.clipboard.readFiles();
      if (!files.length) return { error: 'Скопируйте файл в проводнике (Ctrl+C) и повторите' };
      const item = ctx.makeFileItem(files[0], { conversionsFirst: true });
      return { actionsFor: item };
    }, { category: 'Конвертер' }),
    cmd('saveClipboardImage', 'Сохранить картинку из буфера в PNG', ['save clipboard image', 'screenshot to file', 'картинка из буфера'], 'image', async () => {
      const png = await ctx.clipboard.readImagePng();
      if (!png) return { error: 'В буфере обмена нет изображения' };
      const d = new Date();
      const name = `clipboard-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
      const dir = ctx.electron.app.getPath('downloads');
      const out = path.join(dir, name);
      await fs.promises.writeFile(out, png);
      ctx.notify('Изображение сохранено', out, () => shell.showItemInFolder(out));
      return { hide: true };
    }, { category: 'Буфер', subtitle: 'Сохраняется в «Загрузки»' }),
    cmd('plainPaste', 'Вставить как простой текст', ['paste plain text', 'без форматирования', 'strip formatting'], 'clipboard', async () => {
      const text = await ctx.clipboard.readText();
      if (!text) return { error: 'В буфере обмена нет текста' };
      await ctx.pasteText(text);
      return { hide: true };
    }, { category: 'Буфер' }),
    cmd('clearClipboard', 'Очистить буфер обмена', ['clear clipboard', 'буфер'], 'clipboard', async () => {
      await ctx.clipboard.clear();
      return { keepOpen: true, toast: 'Буфер обмена очищен' };
    }, { category: 'Буфер' }),

    cmd('settings', 'Настройки Palitra', ['settings', 'preferences', 'config', 'настройки', 'параметры'], 'settings', async () => {
      await shell.openPath(config.settingsFile);
      return { hide: true };
    }, { subtitle: 'settings.json — горячая клавиша, языки, папки поиска', suggest: true }),
    cmd('macros', 'Редактировать макросы', ['macros', 'automation', 'макросы', 'автоматизация'], 'macro', async () => {
      await shell.openPath(config.macrosFile);
      return { hide: true };
    }, { subtitle: 'macros.json — изменения подхватываются автоматически', suggest: true }),
    cmd('configDir', 'Открыть папку конфигурации', ['config folder', 'папка настроек'], 'folder', async () => {
      await shell.openPath(config.dir);
      return { hide: true };
    }),
    cmd('reload', 'Перечитать настройки и макросы', ['reload config', 'обновить'], 'refresh', () => {
      ctx.reloadConfig();
      return { keepOpen: true, toast: 'Настройки перечитаны', refresh: true };
    }),
    cmd('reindex', 'Переиндексировать файлы и приложения', ['reindex', 'rescan', 'индексация', 'обновить'], 'refresh', () => {
      ctx.reindex();
      return { keepOpen: true, toast: 'Индексация запущена' };
    }),
    cmd('hotkey', 'Изменить горячую клавишу вызова…', ['hotkey', 'shortcut', 'горячая клавиша', 'сочетание'], 'keyboard', (arg) => {
      if (!arg) return { error: 'Сочетание не задано' };
      const ok = ctx.setHotkey(arg);
      return ok ? { keepOpen: true, toast: `Новая горячая клавиша: ${arg}`, refresh: true } : { error: `Сочетание ${arg} занято другой программой` };
    }, { subtitle: `Сейчас: ${hotkey}`, input: { type: 'hotkey', placeholder: 'Нажмите новое сочетание клавиш…' } }),
    cmd('autostart', `Автозапуск при входе в систему: ${autostart ? 'включён' : 'выключен'}`, ['autostart', 'launch at login', 'startup', 'автозапуск'], 'power', () => {
      ctx.setLaunchAtLogin(!autostart);
      return { keepOpen: true, toast: autostart ? 'Автозапуск выключен' : 'Автозапуск включён', refresh: true };
    }, { runTitle: autostart ? 'Выключить' : 'Включить' }),
    cmd('clearHistory', 'Очистить историю использования', ['clear history', 'reset frecency', 'история'], 'trash', () => {
      ctx.frecency.clear();
      ctx.saveFrecency();
      return { keepOpen: true, toast: 'История очищена', refresh: true };
    }, { confirm: 'Порядок команд сбросится. Нажмите Enter ещё раз' }),
    cmd('help', 'Справка: префиксы и сочетания клавиш', ['help', 'справка', 'помощь', 'how to'], 'help', () => ({ query: '?' }), { suggest: true }),
    cmd('quit', 'Выйти из Palitra', ['quit', 'exit', 'close', 'выход', 'закрыть'], 'exit', () => {
      ctx.quit();
      return { hide: true };
    }),
  ];
}

function generatorItems() {
  const uuid = crypto.randomUUID();
  const pass = password(16);
  const now = new Date();
  const iso = now.toISOString();
  const unix = String(Math.floor(now.getTime() / 1000));
  const gen = (id, title, keywords, icon, value, extraActions = []) => ({
    id: `gen:${id}`,
    title,
    subtitle: value,
    keywords,
    icon,
    category: 'Генератор',
    actions: [A.copy(value), A.paste(value), ...extraActions],
  });
  return [
    gen('uuid', 'Сгенерировать UUID', ['uuid', 'guid', 'id'], 'hash', uuid),
    gen('password', 'Сгенерировать пароль', ['password', 'пароль', 'random'], 'key', pass),
    gen('datetime', 'Текущие дата и время', ['date', 'time', 'now', 'дата', 'время', 'сейчас'], 'clock', localDateTime(now), [A.copy(iso, 'Скопировать в ISO 8601')]),
    gen('unix', 'Unix-время сейчас', ['timestamp', 'unix time', 'epoch', 'метка времени'], 'clock', unix),
    gen('lorem', 'Lorem ipsum', ['lorem ipsum', 'placeholder text', 'рыба', 'заполнитель'], 'text', LOREM),
  ];
}

function createBuiltins(ctx) {
  return {
    name: 'builtins',
    items() {
      return [...paletteItems(ctx), ...systemItems(ctx), ...TRANSFORMS.map(transformItem), ...generatorItems()];
    },
  };
}

module.exports = { createBuiltins, password };
