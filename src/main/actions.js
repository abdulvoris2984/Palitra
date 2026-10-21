'use strict';

// Reusable item actions. An action's `run(arg, ctx)` returns a result object
// understood by the renderer:
//   { hide: true }                 close the palette (default)
//   { keepOpen: true, toast }      stay open and show a short message
//   { query: 'tr ' }               replace the query text (enter a mode)
//   { detail: '...' }              show text in the detail pane
//   { actionsFor: item }           open the action list of another item
//   { refresh: true }              re-run the current search

const path = require('node:path');

function copy(text, title = 'Скопировать', shortcut = '') {
  return {
    id: 'copy',
    title,
    shortcut,
    run: async (_arg, ctx) => {
      await ctx.copy(String(text));
      return { hide: true };
    },
  };
}

function paste(text, title = 'Вставить в активное окно') {
  return {
    id: 'paste',
    title,
    run: async (_arg, ctx) => {
      await ctx.pasteText(String(text));
      return { hide: true };
    },
  };
}

function openUrl(url, title = 'Открыть в браузере') {
  return {
    id: 'open-url',
    title,
    run: (_arg, ctx) => {
      ctx.electron.shell.openExternal(url);
      return { hide: true };
    },
  };
}

function openPath(p, title = 'Открыть') {
  return {
    id: 'open',
    title,
    run: async (_arg, ctx) => {
      const err = await ctx.electron.shell.openPath(p);
      if (err) return { error: err };
      return { hide: true };
    },
  };
}

function reveal(p, title = 'Показать в папке') {
  return {
    id: 'reveal',
    title,
    run: (_arg, ctx) => {
      ctx.electron.shell.showItemInFolder(p);
      return { hide: true };
    },
  };
}

function copyPath(p) {
  return copy(p, 'Скопировать путь');
}

function copyName(p) {
  return copy(path.basename(p), 'Скопировать имя');
}

function setQuery(value, title = 'Открыть') {
  return { id: 'query', title, run: () => ({ query: value }) };
}

module.exports = { copy, paste, openUrl, openPath, reveal, copyPath, copyName, setQuery };
