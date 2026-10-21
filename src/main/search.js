'use strict';

// The search engine: routes a query to the right providers (prefix modes),
// ranks and merges their results, streams slow (network) results later, and
// executes the chosen action while learning from what the user picks.

const fs = require('node:fs');
const { rankItems } = require('../core/ranker');

const HELP = [
  ['tr <текст>', 'Перевод: tr привет · tr it: good morning · tr>de,fr hello', 'tr '],
  ['f <имя файла>', 'Поиск файлов (опечатки прощаются): f отчет pdf', 'f '],
  ['conv <имя файла>', 'Конвертация: PNG ⇄ JPG ⇄ WEBP, CSV → JSON, DOCX → PDF, видео → MP3/GIF…', 'conv '],
  ['~/  /  C:\\', 'Навигация по папкам с клавиатуры, Tab — действия', '~/'],
  ['> <команда>', 'Только команды и макросы, без файлов и приложений', '>'],
  ['2+2*2 · sqrt(16) · 200+15%', 'Калькулятор, Enter копирует результат', null],
  ['10 km to mi · 5 гб в мб · 100f in c', 'Конвертер единиц: длина, вес, температура, данные, время…', null],
  ['100 usd to eur · 5000 сум', 'Курсы валют (обновляются каждые 6 часов)', null],
  ['#ff8800 · 0xff · 255 to bin · 1700000000', 'Цвета, системы счисления, Unix-время', null],
  ['↑ ↓ · Enter · Tab · Ctrl+Enter · Alt+1…9 · Esc', 'Выбор · выполнить · все действия · второе действие · быстрый выбор · назад/закрыть', null],
];

function serialize(item) {
  const actions = (item.actions || []).map((a, i) => ({
    id: a.id,
    title: a.title,
    confirm: a.confirm || (i === 0 ? item.confirm : undefined),
  }));
  return {
    id: item.id,
    title: item.title,
    subtitle: item.subtitle || '',
    icon: item.icon || 'spark',
    category: item.category || '',
    ranges: item.ranges || [],
    detail: item.detail,
    input: item.input,
    loading: Boolean(item.loading),
    section: item.section,
    hotkey: item.hotkey || '',
    enterOpensActions: Boolean(item.enterOpensActions),
    actions,
  };
}

class SearchEngine {
  constructor(ctx, providers) {
    this.ctx = ctx;
    this.p = providers; // { builtins, macros, apps, files, quick, currency, translate, web }
    this.items = new Map(); // id -> item from the latest results
    this.seq = 0;
    this.translateTimer = null;
  }

  staticItems({ commandsOnly = false } = {}) {
    const list = [...this.p.builtins.items(), ...this.p.macros.items()];
    if (!commandsOnly) list.push(...this.p.apps.items());
    return list;
  }

  /** Finds a non-dynamic item by id (for suggestions and macro "command" steps). */
  resolve(id) {
    if (id.startsWith('file:')) {
      const p = id.slice(5);
      try {
        fs.accessSync(p);
        return this.p.files.makeFileItem(p, { navigable: true });
      } catch {
        return null;
      }
    }
    return this.staticItems().find((i) => i.id === id) || null;
  }

  register(items) {
    for (const it of items) this.items.set(it.id, it);
  }

  /**
   * Sorts, trims, fills in clipboard previews and registers the final rows.
   * Rows of a search that was superseded while awaiting are not registered,
   * so that executing an id always runs the row the user actually sees.
   */
  async finish(items, limit, seq = this.seq) {
    const sorted = items
      .map((it, idx) => ({ it, idx }))
      .sort((a, b) => (b.it.score ?? 0) - (a.it.score ?? 0) || a.idx - b.idx)
      .map(({ it }) => it)
      .slice(0, limit);
    if (sorted.some((it) => typeof it.preview === 'function')) await this.ctx.loadClipboard();
    for (const it of sorted) {
      if (typeof it.preview === 'function') {
        try {
          it.subtitle = it.preview(this.ctx);
        } catch (err) {
          it.subtitle = err.message;
        }
      }
    }
    if (seq === this.seq) this.register(sorted);
    return sorted.map(serialize);
  }

  suggestions() {
    const { frecency } = this.ctx;
    const out = [];
    const seen = new Set();
    const errors = this.p.macros.items().filter((i) => i.category === 'Ошибка');
    for (const e of errors) {
      out.push({ ...e, section: 'Внимание' });
      seen.add(e.id);
    }
    for (const id of frecency.top(12)) {
      if (seen.has(id)) continue;
      const it = this.resolve(id);
      if (it) {
        out.push({ ...it, section: 'Недавние' });
        seen.add(id);
      }
    }
    for (const it of this.p.builtins.items()) {
      if (it.suggest && !seen.has(it.id)) out.push({ ...it, section: 'Подсказки' });
    }
    out.forEach((it, i) => {
      it.score = 1000 - i;
    });
    return out;
  }

  helpItems() {
    const rows = HELP.map(([title, subtitle, q], i) => ({
      id: `help:${i}`,
      title,
      subtitle,
      icon: 'help',
      category: 'Справка',
      dynamic: true,
      score: 1000 - i,
      actions: q ? [{ id: 'query', title: 'Попробовать', run: () => ({ query: q }) }] : [],
    }));
    for (const { key, name } of this.p.web.helpItems()) {
      rows.push({
        id: `help:web:${key}`,
        title: `${key} <запрос>`,
        subtitle: `Искать в ${name}`,
        icon: 'web',
        category: 'Справка',
        dynamic: true,
        score: 500,
        actions: [{ id: 'query', title: 'Попробовать', run: () => ({ query: `${key} ` }) }],
      });
    }
    return rows;
  }

  /**
   * Returns the immediate results; slow providers call `push(seq, items)`
   * later with the full, re-ranked list.
   */
  async search(query, seq, push) {
    this.seq = seq;
    this.items.clear();
    clearTimeout(this.translateTimer);
    const settings = this.ctx.config.settings;
    const limit = settings.maxResults || 40;
    const q = String(query ?? '');
    const trimmed = q.trim();

    if (!trimmed) return { mode: 'home', items: await this.finish(this.suggestions(), limit) };
    if (trimmed === '?') return { mode: 'help', items: await this.finish(this.helpItems(), limit) };

    const tr = this.p.translate.parse(q);
    if (tr) {
      const pending = this.p.translate.pending(tr);
      if (tr.text) {
        this.translateTimer = setTimeout(async () => {
          if (this.seq !== seq) return;
          const results = await this.p.translate.queryAsync(tr);
          if (this.seq !== seq || !results) return;
          push(seq, await this.finish(results.length ? results : this.p.translate.pending({ text: '' }), limit));
        }, 300);
      }
      return { mode: 'translate', items: await this.finish(pending, limit) };
    }

    let m;
    if ((m = /^(f|conv)\s+([\s\S]*)$/i.exec(q))) {
      const convert = m[1].toLowerCase() === 'conv';
      const text = m[2].trim();
      if (!text) {
        return {
          mode: convert ? 'convert' : 'files',
          items: await this.finish(
            [
              {
                id: 'files:hint',
                title: convert ? 'Введите имя файла для конвертации' : 'Введите имя файла',
                subtitle: `Проиндексировано файлов: ${this.p.files.count().toLocaleString('ru-RU')}${this.p.files.isIndexing() ? ' (индексация…)' : ''}`,
                icon: convert ? 'convert' : 'search',
                category: 'Файлы',
                dynamic: true,
                actions: [],
              },
            ],
            limit,
          ),
        };
      }
      const items = this.p.files.search(text, { limit: 50, onlyConvertible: convert });
      return { mode: convert ? 'convert' : 'files', items: await this.finish(items, limit) };
    }

    if (/^(~|\/|[a-zA-Z]:[\\/]|\\\\)/.test(trimmed)) {
      const items = this.p.files.browse(q);
      if (items) return { mode: 'browse', items: await this.finish(items, limit) };
    }

    const web = this.p.web.parse(q);
    if (web) return { mode: 'web', items: await this.finish(this.p.web.prefixed(web), limit) };

    const commandsOnly = trimmed.startsWith('>');
    const text = commandsOnly ? trimmed.slice(1).trim() : trimmed;
    const results = [];

    if (!commandsOnly) results.push(...this.p.quick.query(text));

    const ranked = text ? rankItems(text, this.staticItems({ commandsOnly }), this.ctx.frecency) : [];
    for (const r of ranked) {
      results.push({ ...r.item, score: r.score, ranges: r.ranges });
    }
    if (!text && commandsOnly) {
      for (const it of this.staticItems({ commandsOnly: true })) results.push({ ...it, score: 0 });
    }

    if (!commandsOnly && settings.showFilesInMainSearch && text.length >= 2) {
      results.push(...this.p.files.search(text, { limit: 6 }));
    }
    if (!commandsOnly) results.push(...this.p.web.extras(text));

    const sync = await this.finish(results, limit);

    if (!commandsOnly && this.p.currency.matches(text)) {
      this.p.currency.queryAsync(text).then(async (cur) => {
        if (this.seq !== seq || !cur.length) return;
        push(seq, await this.finish([...cur, ...results], limit));
      });
    }
    return { mode: commandsOnly ? 'commands' : 'all', items: sync };
  }

  async execute({ itemId, actionId, arg, query }) {
    const item = this.items.get(itemId) || this.resolve(itemId);
    if (!item) return { error: 'Результат устарел — попробуйте ещё раз' };
    const action = actionId ? item.actions.find((a) => a.id === actionId) : item.actions[0];
    if (!action) return { error: 'У этого элемента нет действий' };
    let result;
    try {
      result = (await action.run(arg, this.ctx)) || { hide: true };
    } catch (err) {
      console.error('[palitra] action failed', err);
      result = { error: err.message || String(err) };
    }
    if (!item.dynamic && !result.error) {
      this.ctx.frecency.record(item.id, query && query.startsWith('>') ? query.slice(1) : query);
      this.ctx.saveFrecency();
    }
    if (result.actionsFor) {
      this.register([result.actionsFor]);
      result.actionsFor = serialize(result.actionsFor);
    }
    return result;
  }

  /** Runs a command by id (used by macros and per-command hotkeys). */
  async runCommand(id, actionId, arg) {
    const item = this.resolve(id);
    if (!item) return { error: `Команда ${id} не найдена` };
    const action = actionId ? item.actions.find((a) => a.id === actionId) : item.actions[0];
    if (!action) return { error: `У команды ${id} нет действия ${actionId}` };
    return (await action.run(arg, this.ctx)) || { hide: true };
  }
}

module.exports = { SearchEngine, serialize };
