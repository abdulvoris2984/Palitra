'use strict';

// User macros from macros.json. A macro is a list of steps run in order:
//   open     { target }            URL, file/folder path or application name
//   shell    { command, wait }     run a shell command ({last} = its output)
//   copy     { text }              put text into the clipboard
//   paste    { text? }             paste text (or the clipboard) into the active app
//   keys     { combo }             press a key combination, e.g. "ctrl+shift+t"
//   delay    { ms }                wait
//   notify   { text, title? }      system notification
//   command  { id, arg? }          run another Palitra command, e.g. "text:upper"
// Strings may use variables: {input} {input:url} {clipboard} {clipboard:url}
// {last} {date} {time} {datetime} {home} {desktop} {documents} {downloads}

const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function expandVars(template, vars) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{([a-z]+)(?::(url))?\}/gi, (m, name, mod) => {
    const v = vars[name.toLowerCase()];
    if (v === undefined) return m;
    return mod === 'url' ? encodeURIComponent(v) : v;
  });
}

function shellRun(command, wait) {
  return new Promise((resolve, reject) => {
    const child = exec(command, { windowsHide: true, timeout: wait ? 120000 : 0, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!wait) return;
      if (err) reject(new Error((stderr || err.message).trim().slice(0, 300)));
      else resolve(String(stdout).trim());
    });
    if (!wait) {
      child.unref();
      resolve('');
    }
  });
}

function createMacros(ctx) {
  async function runSteps(macro, input) {
    const { shell, app } = ctx.electron;
    const { clipboard } = ctx;
    const now = new Date();
    const vars = {
      input: input ?? '',
      clipboard: await clipboard.readText(),
      last: '',
      date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
      datetime: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
      home: app.getPath('home'),
      desktop: app.getPath('desktop'),
      documents: app.getPath('documents'),
      downloads: app.getPath('downloads'),
    };
    let hidden = false;
    const hideOnce = async () => {
      if (!hidden) {
        ctx.hide();
        hidden = true;
        await ctx.system.sleep(120);
      }
    };

    for (let i = 0; i < macro.steps.length; i++) {
      const step = macro.steps[i] || {};
      const type = String(step.type || '').toLowerCase();
      const S = (key) => expandVars(step[key], vars);
      try {
        switch (type) {
          case 'open': {
            const target = S('target') || '';
            if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) {
              await shell.openExternal(target);
            } else if (fs.existsSync(ctx.system.expandHome(target))) {
              const err = await shell.openPath(ctx.system.expandHome(target));
              if (err) throw new Error(err);
            } else {
              const appItem = ctx.findApp(target);
              if (!appItem) throw new Error(`Не найдено: «${target}» (не URL, не путь и не приложение)`);
              const err = await appItem.launchApp();
              if (err) throw new Error(err);
            }
            break;
          }
          case 'shell':
          case 'run': {
            const out = await shellRun(S('command'), Boolean(step.wait || step.copyOutput));
            vars.last = out;
            if (step.copyOutput) await clipboard.writeText(out);
            break;
          }
          case 'copy':
            await clipboard.writeText(step.text === undefined ? vars.last : S('text'));
            vars.clipboard = await clipboard.readText();
            break;
          case 'paste':
            await hideOnce();
            if (step.text === undefined) {
              await ctx.system.pasteIntoActiveApp(60);
            } else {
              await ctx.pasteText(S('text'), { alreadyHidden: true });
            }
            break;
          case 'keys':
            await hideOnce();
            await ctx.system.sendKeys(S('combo') || S('keys'));
            break;
          case 'delay':
          case 'wait':
            await ctx.system.sleep(Math.min(Number(step.ms) || 500, 60000));
            break;
          case 'notify':
            ctx.notify(S('title') || macro.name, S('text') || '');
            break;
          case 'command': {
            const res = await ctx.runCommand(String(step.id), step.action, S('arg'));
            if (res && res.error) throw new Error(res.error);
            vars.clipboard = await clipboard.readText();
            break;
          }
          default:
            throw new Error(`Неизвестный тип шага "${step.type}"`);
        }
      } catch (err) {
        ctx.notify(`Макрос «${macro.name}»: ошибка в шаге ${i + 1}`, err.message);
        return { error: `Шаг ${i + 1} (${type}): ${err.message}` };
      }
    }
    return { hide: true };
  }

  function toItem(macro) {
    const steps = macro.steps.map((s) => s && s.type).filter(Boolean);
    return {
      id: `macro:${slug(macro.id || macro.name)}`,
      title: macro.name,
      subtitle: macro.description || `Макрос: ${steps.join(' → ')}`,
      keywords: [...(macro.keywords || []), 'macro', 'макрос'],
      category: 'Макрос',
      icon: 'macro',
      hotkey: macro.hotkey || '',
      input: macro.input ? { type: 'text', placeholder: String(macro.input) } : undefined,
      actions: [
        {
          id: 'run',
          title: 'Запустить макрос',
          run: (arg) => runSteps(macro, arg),
        },
        {
          id: 'edit',
          title: 'Редактировать macros.json',
          run: async () => {
            await ctx.electron.shell.openPath(ctx.config.macrosFile);
            return { hide: true };
          },
        },
      ],
      runMacro: (arg) => runSteps(macro, arg),
    };
  }

  return {
    name: 'macros',
    items() {
      const items = ctx.config.macros.map(toItem);
      for (const e of ctx.config.errors) {
        items.push({
          id: `macro-error:${e.file}`,
          title: `Ошибка в ${path.basename(e.file)}`,
          subtitle: e.message,
          keywords: ['error', 'ошибка', 'macro', 'settings', 'макрос', 'настройки'],
          category: 'Ошибка',
          icon: 'warning',
          bias: 30,
          dynamic: true,
          actions: [
            {
              id: 'open',
              title: 'Открыть файл',
              run: async () => {
                await ctx.electron.shell.openPath(e.file);
                return { hide: true };
              },
            },
          ],
        });
      }
      return items;
    },
  };
}

module.exports = { createMacros, expandVars };
