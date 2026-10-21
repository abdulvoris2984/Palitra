'use strict';

(() => {
  const api = window.palitra;
  const ICONS = window.PALITRA_ICONS;
  const $ = (id) => document.getElementById(id);
  const els = {
    q: $('q'),
    list: $('list'),
    empty: $('empty'),
    detail: $('detail'),
    chip: $('chip'),
    spinner: $('spinner'),
    hints: $('hints'),
    status: $('status'),
    toast: $('toast'),
    searchIcon: $('searchIcon'),
  };
  const DEFAULT_PLACEHOLDER = els.q.placeholder;

  const setDark = (dark) => document.documentElement.classList.toggle('dark', Boolean(dark));
  setDark(new URLSearchParams(location.search).get('dark') === '1');
  api.onTheme(setDark);

  const TONES = {
    Palitra: 'violet', Перевод: 'teal', Файлы: 'amber', Файл: 'amber', Папка: 'amber', Конвертер: 'pink',
    Буфер: 'blue', Текст: 'blue', Система: 'orange', Генератор: 'sky', Макрос: 'violet', Калькулятор: 'green',
    Единицы: 'green', Валюта: 'green', Ответ: 'green', 'Системы счисления': 'green', Время: 'green', Цвет: 'green',
    Веб: 'sky', Справка: 'gray', Ошибка: 'orange', Приложение: 'gray', Действие: 'violet',
  };
  const MODE_ICONS = { translate: 'translate', files: 'search', convert: 'convert', web: 'web', browse: 'folder', help: 'help', commands: 'spark' };
  const ACTION_ICONS = {
    copy: 'copy', paste: 'clipboard', open: 'arrow', reveal: 'folder', 'open-url': 'web', trash: 'trash',
    navigate: 'arrow', query: 'arrow', run: 'arrow', edit: 'settings', show: 'text',
  };

  const state = {
    view: 'list', // 'list' | 'actions' | 'input'
    items: [], // rows currently displayed
    results: [], // last search results (restored when leaving actions/input)
    selected: 0,
    savedSelected: 0,
    seq: 0,
    query: '',
    savedQuery: '',
    mode: 'all',
    target: null, // item whose actions / input are shown
    hotkeyValue: '',
    confirmKey: null,
    confirmText: '',
    detailOverride: null,
    busy: false,
    info: null,
    lastMouse: null,
  };

  // ------------------------------------------------------------- search --

  async function search() {
    const query = els.q.value;
    state.query = query;
    state.detailOverride = null;
    state.confirmKey = null;
    const seq = ++state.seq;
    let res;
    try {
      res = await api.search(query, seq);
    } catch (err) {
      showToast(String(err.message || err), true);
      return;
    }
    if (res.seq !== state.seq) return;
    applyResults(res.items, res.mode, true);
  }

  api.onResults(({ seq, items }) => {
    if (seq !== state.seq) return;
    applyResults(items, state.mode, false);
  });

  function applyResults(items, mode, reset) {
    const prevId = state.view === 'list' && state.items[state.selected] ? state.items[state.selected].id : null;
    state.results = items;
    state.mode = mode;
    if (state.view !== 'list') return;
    state.items = items;
    // Keep the user's selection when late results arrive, unless it was still
    // on the first row: then the (new) best result should be selected.
    let idx = reset || !prevId || state.selected === 0 ? 0 : items.findIndex((i) => i.id === prevId);
    state.selected = Math.max(0, idx);
    render();
  }

  // ------------------------------------------------------------- render --

  const iconCache = new Map();

  function loadIcon(ref) {
    const key = `${ref.kind}:${ref.key || ref.path}`;
    if (!iconCache.has(key)) iconCache.set(key, api.icon(ref).catch(() => null));
    return iconCache.get(key);
  }

  function iconEl(item) {
    const box = document.createElement('div');
    box.className = 'row-icon';
    const icon = item.icon;
    const tone = TONES[item.category] || 'violet';
    if (icon && typeof icon === 'object' && icon.color) {
      box.classList.add('swatch');
      box.style.background = icon.color;
    } else if (icon && typeof icon === 'object' && icon.kind) {
      box.innerHTML = ICONS.svg(item.category === 'Приложение' ? 'app' : 'file');
      box.dataset.tone = tone;
      loadIcon(icon).then((url) => {
        if (!url || !box.isConnected) return;
        const img = new Image();
        img.alt = '';
        img.src = url;
        box.replaceChildren(img);
        box.classList.add('has-image');
        delete box.dataset.tone;
      });
    } else {
      box.innerHTML = ICONS.svg(typeof icon === 'string' ? icon : 'spark');
      box.dataset.tone = tone;
    }
    return box;
  }

  function highlighted(text, ranges) {
    const frag = document.createDocumentFragment();
    let pos = 0;
    const sorted = (ranges || []).filter((r) => r[1] > r[0]).sort((a, b) => a[0] - b[0]);
    for (const [s0, e0] of sorted) {
      const s = Math.max(pos, Math.min(s0, text.length));
      const e = Math.min(e0, text.length);
      if (e <= s) continue;
      if (s > pos) frag.append(text.slice(pos, s));
      const mark = document.createElement('mark');
      mark.textContent = text.slice(s, e);
      frag.append(mark);
      pos = e;
    }
    frag.append(text.slice(pos));
    return frag;
  }

  function rowEl(item, index) {
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('role', 'option');
    li.dataset.index = String(index);
    if (index === state.selected) {
      li.classList.add('selected');
      li.setAttribute('aria-selected', 'true');
    }
    if (item.loading) li.classList.add('loading');
    li.append(iconEl(item));

    const text = document.createElement('div');
    text.className = 'row-text';
    const title = document.createElement('div');
    title.className = 'row-title';
    const flatTitle = String(item.title).replace(/\s*\n\s*/g, ' ');
    title.append(highlighted(flatTitle, flatTitle === item.title ? item.ranges : []));
    text.append(title);

    const confirmActive = index === state.selected && state.confirmKey && state.confirmKey.startsWith(`${item.id}|`);
    const subtitleText = confirmActive ? state.confirmText : item.subtitle;
    if (subtitleText) {
      const sub = document.createElement('div');
      sub.className = 'row-subtitle';
      if (confirmActive) sub.classList.add('warn');
      sub.textContent = String(subtitleText).replace(/\s*\n\s*/g, ' ');
      text.append(sub);
    }
    li.append(text);

    const meta = document.createElement('div');
    meta.className = 'row-meta';
    if (item.hotkey) {
      const k = document.createElement('kbd');
      k.textContent = item.hotkey;
      meta.append(k);
    }
    if (item.category) {
      const c = document.createElement('span');
      c.textContent = item.category;
      meta.append(c);
    }
    if (index === state.selected && !item.loading && (item.actions?.length || item.action || state.view === 'input')) {
      const k = document.createElement('kbd');
      k.textContent = '↵';
      meta.append(k);
    }
    li.append(meta);
    return li;
  }

  function render() {
    const frag = document.createDocumentFragment();
    let lastSection = null;
    state.items.forEach((item, i) => {
      if (state.view === 'list' && item.section && item.section !== lastSection) {
        const h = document.createElement('li');
        h.className = 'section';
        h.textContent = item.section;
        frag.append(h);
        lastSection = item.section;
      }
      frag.append(rowEl(item, i));
    });
    els.list.replaceChildren(frag);
    els.empty.hidden = state.items.length > 0;
    els.list.hidden = state.items.length === 0;
    const sel = els.list.querySelector('.row.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
    renderDetail();
    renderChrome();
  }

  function renderDetail() {
    const item = state.items[state.selected];
    const text = state.detailOverride ?? (state.view === 'list' && item ? item.detail : null);
    els.detail.hidden = !text;
    if (text) els.detail.textContent = text;
  }

  function hint(key, label, primary = false) {
    const span = document.createElement('span');
    if (primary) span.className = 'primary';
    const k = document.createElement('kbd');
    k.textContent = key;
    span.append(label, k);
    return span;
  }

  function renderChrome() {
    const mode = state.view === 'list' ? state.mode : state.view === 'actions' ? 'actions' : 'input';
    els.searchIcon.innerHTML = ICONS.svg(MODE_ICONS[mode] || (state.view === 'actions' ? 'arrow' : 'search'));
    els.spinner.hidden = !(state.busy || state.items.some((i) => i.loading));

    const hints = [];
    const item = state.items[state.selected];
    if (state.view === 'list') {
      if (item && item.actions && item.actions.length) {
        const first = item.enterOpensActions ? 'Действия' : item.input ? 'Продолжить' : item.actions[0].title;
        hints.push(hint('↵', first, true));
        if (item.actions.length > 1) hints.push(hint('Tab', 'Все действия'));
      }
      hints.push(hint('Esc', els.q.value ? 'Очистить' : 'Закрыть'));
    } else if (state.view === 'actions') {
      hints.push(hint('↵', 'Выполнить', true), hint('Esc', 'Назад'));
    } else {
      hints.push(hint('↵', 'Выполнить', true), hint('Esc', 'Отмена'));
    }
    els.hints.replaceChildren(...hints);
  }

  function renderStatus() {
    const i = state.info;
    if (!i) return;
    const parts = ['Palitra'];
    if (i.hotkey) parts.push(i.hotkey);
    parts.push(`${i.files.toLocaleString('ru-RU')} файлов${i.indexing ? ' (индексация…)' : ''}`);
    parts.push(`${i.apps} прилож.`);
    els.status.textContent = parts.join(' · ');
  }

  let toastTimer = null;
  function showToast(message, isError = false) {
    els.toast.textContent = message;
    els.toast.classList.toggle('error', isError);
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, isError ? 3500 : 1800);
  }

  // ------------------------------------------------------------- views ---

  function setChip(text) {
    els.chip.hidden = !text;
    els.chip.textContent = text || '';
  }

  function actionRows(item, filter = '') {
    const f = filter.trim().toLowerCase();
    return item.actions
      .filter((a) => !f || a.title.toLowerCase().includes(f))
      .map((a) => ({
        id: `action:${a.id}`,
        title: a.title,
        subtitle: '',
        icon: a.id.startsWith('convert:') ? 'convert' : ACTION_ICONS[a.id] || 'arrow',
        category: '',
        ranges: [],
        action: a,
        actions: [a],
      }));
  }

  function openActions(item) {
    if (!item || !item.actions || !item.actions.length) return;
    if (state.view === 'list') {
      state.savedQuery = els.q.value;
      state.savedSelected = state.selected;
    }
    state.view = 'actions';
    state.target = item;
    state.confirmKey = null;
    els.q.value = '';
    els.q.readOnly = false;
    els.q.placeholder = 'Фильтр действий…';
    setChip(item.title);
    state.items = actionRows(item);
    state.selected = 0;
    render();
  }

  function openInput(item) {
    if (state.view === 'list') {
      state.savedQuery = els.q.value;
      state.savedSelected = state.selected;
    }
    state.view = 'input';
    state.target = item;
    state.hotkeyValue = '';
    state.confirmKey = null;
    els.q.value = '';
    const isHotkey = item.input && item.input.type === 'hotkey';
    els.q.readOnly = isHotkey;
    els.q.placeholder = (item.input && item.input.placeholder) || 'Введите значение…';
    setChip(item.title);
    renderInputRow();
  }

  function renderInputRow() {
    const item = state.target;
    const isHotkey = item.input && item.input.type === 'hotkey';
    const value = isHotkey ? state.hotkeyValue : els.q.value;
    state.items = [
      {
        id: `input:${item.id}`,
        title: isHotkey ? value || 'Нажмите сочетание клавиш…' : `Выполнить «${item.title}»`,
        subtitle: isHotkey ? 'Например Alt+Space или Ctrl+Shift+K · Enter — сохранить' : value ? `Значение: ${value}` : els.q.placeholder,
        icon: isHotkey ? 'keyboard' : item.icon,
        category: item.category,
        ranges: [],
        actions: item.actions,
      },
    ];
    state.selected = 0;
    render();
  }

  function backToList() {
    state.view = 'list';
    state.target = null;
    state.confirmKey = null;
    els.q.readOnly = false;
    els.q.placeholder = DEFAULT_PLACEHOLDER;
    els.q.value = state.savedQuery;
    setChip('');
    state.items = state.results;
    state.selected = Math.min(state.savedSelected, Math.max(0, state.items.length - 1));
    render();
  }

  // ------------------------------------------------------------ actions --

  async function runAction(item, action, arg) {
    const key = `${item.id}|${action.id}`;
    if (action.confirm && state.confirmKey !== key) {
      state.confirmKey = key;
      state.confirmText = action.confirm;
      render();
      return;
    }
    state.confirmKey = null;
    state.busy = true;
    renderChrome();
    let res;
    try {
      res = await api.execute({ itemId: item.id, actionId: action.id, arg, query: state.view === 'list' ? els.q.value : state.savedQuery });
    } catch (err) {
      res = { error: String(err.message || err) };
    }
    state.busy = false;
    handleResult(res || {});
  }

  function handleResult(res) {
    renderChrome();
    if (res.error) {
      showToast(res.error, true);
      if (state.confirmKey) {
        state.confirmKey = null;
        render();
      }
      return;
    }
    if (res.hide) {
      if (state.view !== 'list') backToList();
      return;
    }
    if (res.actionsFor) {
      openActions(res.actionsFor);
    } else if (state.view !== 'list') {
      backToList();
    }
    if (res.query !== undefined) {
      els.q.value = res.query;
      els.q.focus();
      els.q.setSelectionRange(res.query.length, res.query.length);
      search();
    }
    if (res.detail !== undefined) {
      state.detailOverride = res.detail;
      renderDetail();
    }
    if (res.toast) showToast(res.toast);
    if (res.refresh && res.query === undefined) search();
  }

  function activate(index, actionIndex = 0) {
    const row = state.items[index];
    if (!row || row.loading) return;
    if (state.view === 'actions') return runAction(state.target, row.action);
    if (state.view === 'input') {
      const isHotkey = state.target.input && state.target.input.type === 'hotkey';
      const arg = isHotkey ? state.hotkeyValue : els.q.value;
      if (isHotkey && !arg) return showToast('Сначала нажмите сочетание клавиш', true);
      return runAction(state.target, state.target.actions[0], arg);
    }
    if (actionIndex === 0 && row.enterOpensActions) return openActions(row);
    if (actionIndex === 0 && row.input) return openInput(row);
    const action = row.actions && row.actions[actionIndex];
    if (!action) {
      if (actionIndex > 0 && row.actions && row.actions.length) openActions(row);
      return;
    }
    return runAction(row, action);
  }

  function move(delta) {
    if (!state.items.length) return;
    const n = state.items.length;
    let next = state.selected + delta;
    if (Math.abs(delta) === 1) next = (next + n) % n;
    else next = Math.max(0, Math.min(n - 1, next));
    state.selected = next;
    state.confirmKey = null;
    if (state.view === 'list') state.detailOverride = null;
    render();
  }

  function escape() {
    if (state.view !== 'list') return backToList();
    if (state.detailOverride) {
      state.detailOverride = null;
      return renderDetail();
    }
    if (els.q.value) {
      els.q.value = '';
      return search();
    }
    api.hide();
  }

  // ------------------------------------------------------------- input ---

  els.q.addEventListener('keydown', async (e) => {
    if (e.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;

    if (state.view === 'input' && state.target.input && state.target.input.type === 'hotkey') {
      if (e.key === 'Escape') {
        e.preventDefault();
        return backToList();
      }
      if (e.key === 'Enter' && !mod && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        return activate(0);
      }
      if (e.key === 'Backspace' && !mod && !e.altKey) {
        e.preventDefault();
        state.hotkeyValue = '';
        els.q.value = '';
        return renderInputRow();
      }
      e.preventDefault();
      const acc = await api.accelerator({ ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, code: e.code });
      if (acc) {
        state.hotkeyValue = acc;
        els.q.value = acc;
        renderInputRow();
      }
      return;
    }

    // Alt+1…9 (Cmd+1…9 on macOS): run the n-th result directly.
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit && (e.altKey || e.metaKey) && !e.ctrlKey) {
      e.preventDefault();
      const idx = Number(digit[1]) - 1;
      if (idx < state.items.length) {
        state.selected = idx;
        render();
        activate(idx);
      }
      return;
    }

    if (mod && !e.altKey && !e.shiftKey) {
      if (e.code === 'KeyN' || e.code === 'KeyJ') {
        e.preventDefault();
        return move(1);
      }
      if (e.code === 'KeyP') {
        e.preventDefault();
        return move(-1);
      }
      if (e.code === 'KeyK') {
        e.preventDefault();
        return state.view === 'actions' ? backToList() : openActions(state.items[state.selected]);
      }
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'PageDown':
        e.preventDefault();
        move(6);
        break;
      case 'PageUp':
        e.preventDefault();
        move(-6);
        break;
      case 'Enter':
        e.preventDefault();
        if (mod) activate(state.selected, 1);
        else if (e.shiftKey && state.view === 'list') openActions(state.items[state.selected]);
        else activate(state.selected, 0);
        break;
      case 'Tab':
        e.preventDefault();
        if (e.shiftKey || state.view !== 'list') {
          if (state.view !== 'list') backToList();
        } else {
          openActions(state.items[state.selected]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        escape();
        break;
      case 'Backspace':
        if (els.q.value === '' && state.view !== 'list') {
          e.preventDefault();
          backToList();
        }
        break;
      default:
        break;
    }
  });

  els.q.addEventListener('input', () => {
    state.confirmKey = null;
    if (state.view === 'list') {
      search();
    } else if (state.view === 'actions') {
      state.items = actionRows(state.target, els.q.value);
      state.selected = 0;
      render();
    } else {
      renderInputRow();
    }
  });

  // Mouse support (keyboard stays the primary way).
  els.list.addEventListener('mousemove', (e) => {
    if (state.lastMouse && state.lastMouse.x === e.screenX && state.lastMouse.y === e.screenY) return;
    state.lastMouse = { x: e.screenX, y: e.screenY };
    const row = e.target.closest('.row');
    if (!row) return;
    const idx = Number(row.dataset.index);
    if (idx !== state.selected) {
      state.selected = idx;
      state.confirmKey = null;
      render();
    }
  });
  els.list.addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    state.selected = Number(row.dataset.index);
    activate(state.selected);
    els.q.focus();
  });
  document.addEventListener('mousedown', (e) => {
    if (e.target !== els.q && !e.target.closest('.detail')) setTimeout(() => els.q.focus(), 0);
  });

  // ------------------------------------------------------- main events ---

  async function refreshInfo() {
    try {
      state.info = await api.info();
      renderStatus();
    } catch {
      // ignore
    }
  }

  api.onShown((extra = {}) => {
    if (state.view !== 'list') backToList();
    els.q.focus();
    els.q.select();
    search();
    refreshInfo();
    if (extra.inputFor) openInput(extra.inputFor);
    if (extra.result) handleResult(extra.result);
  });

  api.onConfigChanged(() => {
    refreshInfo();
    if (state.view === 'list') search();
  });

  // Image conversion runs here because Chromium can decode WebP/AVIF/SVG/ICO
  // and encode PNG/JPEG/WebP without any native dependencies.
  const IMAGE_MIME = {
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    gif: 'image/gif', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif',
  };

  async function convertImage({ bytes, inExt, outMime, scale }) {
    const blob = new Blob([bytes], { type: IMAGE_MIME[inExt] || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (!w || !h) {
        w = 1024;
        h = 1024;
      }
      if (inExt === 'svg' && Math.max(w, h) < 1024) {
        const k = 1024 / Math.max(w, h); // rasterise small SVGs at a useful size
        w = Math.round(w * k);
        h = Math.round(h * k);
      }
      const W = Math.max(1, Math.round(w * scale));
      const H = Math.max(1, Math.round(h * scale));
      const canvas = new OffscreenCanvas(W, H);
      const g = canvas.getContext('2d');
      if (outMime === 'image/jpeg') {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, W, H);
      }
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, W, H);
      const out = await canvas.convertToBlob({ type: outMime, quality: 0.92 });
      if (out.type !== outMime) throw new Error(`Формат ${outMime} не поддерживается`);
      return new Uint8Array(await out.arrayBuffer());
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  api.onWorkerRequest(async ({ id, type, payload }) => {
    try {
      if (type !== 'convert-image') throw new Error(`unknown request ${type}`);
      api.workerRespond({ id, result: await convertImage(payload) });
    } catch (err) {
      api.workerRespond({ id, error: err && err.message ? err.message : 'Не удалось прочитать изображение' });
    }
  });

  search();
  refreshInfo();
})();
