'use strict';

// File search: a background indexer walks the configured folders breadth-
// first (so shallow, more relevant files are indexed first) and keeps names
// in memory. Searching is fuzzy and typo-tolerant, with a cheap character
// pre-filter so that 100k+ files stay fast on every keystroke.
// Also handles path navigation: "~/Doc" lists matching entries of ~.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const A = require('../actions');
const { prepareQuery, matchItem } = require('../../core/fuzzy');
const { normalize } = require('../../core/text');
const { conversionsFor, convertFile } = require('../convert');

const BUNDLE_EXT = new Set(['.app', '.photoslibrary', '.bundle', '.framework', '.xcodeproj', '.xcworkspace', '.musiclibrary', '.tvlibrary', '.pkg', '.rtfd']);
const UNIQUE_ICON_EXT = new Set(['.exe', '.lnk', '.app', '.ico', '.appimage', '.dmg']);

function fileIcon(p, isDir) {
  if (isDir && !BUNDLE_EXT.has(path.extname(p).toLowerCase())) return 'folder';
  const ext = path.extname(p).toLowerCase();
  return { kind: 'file', path: p, key: UNIQUE_ICON_EXT.has(ext) || !ext ? p : ext };
}

function createFiles(ctx) {
  let names = []; // basenames
  let norms = []; // normalised basenames (for the pre-filter)
  let paths = [];
  let dirs = [];
  let lite = []; // lazily created { title } objects carrying the fuzzy cache
  let indexing = null;
  let lastIndexed = 0;
  let generation = 0;

  function settings() {
    return ctx.config.settings.files;
  }

  function roots() {
    const s = settings();
    const list = s.roots && s.roots.length ? s.roots : [os.homedir()];
    return list.map((r) => ctx.system.expandHome(String(r)));
  }

  async function index() {
    if (indexing) return indexing;
    const myGen = ++generation;
    indexing = (async () => {
      const s = settings();
      const exclude = new Set((s.exclude || []).map((e) => e.toLowerCase()));
      const maxEntries = s.maxEntries || 150000;
      const maxDepth = s.maxDepth ?? 7;
      const nNames = [];
      const nNorms = [];
      const nPaths = [];
      const nDirs = [];
      const queue = roots().map((r) => [r, 0]);
      let processed = 0;
      while (queue.length && nPaths.length < maxEntries) {
        const [dir, depth] = queue.shift();
        let handle;
        try {
          handle = await fs.promises.opendir(dir);
        } catch {
          continue;
        }
        try {
          for await (const e of handle) {
            const name = e.name;
            if (!s.includeHidden && (name.startsWith('.') || /^(ntuser|desktop\.ini$|thumbs\.db$|\$)/i.test(name))) continue;
            if (exclude.has(name.toLowerCase())) continue;
            if (e.isSymbolicLink()) continue; // avoids loops through junctions/links
            const full = path.join(dir, name);
            const isDir = e.isDirectory();
            nNames.push(name);
            nNorms.push(normalize(name));
            nPaths.push(full);
            nDirs.push(isDir);
            if (isDir && depth < maxDepth && !BUNDLE_EXT.has(path.extname(name).toLowerCase())) queue.push([full, depth + 1]);
            if (nPaths.length >= maxEntries) break;
            if (++processed % 2000 === 0) await new Promise((r) => setImmediate(r));
          }
        } catch {
          // directory vanished or permission denied mid-way
        }
        if (myGen !== generation) return; // a newer index run superseded us
      }
      names = nNames;
      norms = nNorms;
      paths = nPaths;
      dirs = nDirs;
      lite = new Array(nPaths.length);
      lastIndexed = Date.now();
      console.log(`[palitra] indexed ${nPaths.length} files in ${roots().join(', ')}`);
    })().finally(() => {
      indexing = null;
    });
    return indexing;
  }

  function addPath(p) {
    try {
      const st = fs.statSync(p);
      names.push(path.basename(p));
      norms.push(normalize(path.basename(p)));
      paths.push(p);
      dirs.push(st.isDirectory());
      lite.push(undefined);
    } catch {
      // ignore
    }
  }

  function tools() {
    return ctx.tools();
  }

  function conversionActions(p) {
    return conversionsFor(p, tools()).map((conv) => ({
      id: `convert:${conv.id}`,
      title: conv.title,
      run: async () => {
        const slow = conv.kind === 'ffmpeg' || conv.kind === 'soffice';
        if (slow) ctx.notify('Конвертация началась', `${path.basename(p)} → ${conv.to.toUpperCase()}`);
        const job = convertFile(p, conv, {
          run: ctx.system.run,
          tools: tools(),
          convertImage: ctx.convertImage,
        })
          .then((out) => {
            addPath(out);
            ctx.notify('Готово ✓', `${path.basename(out)} — нажмите, чтобы показать`, () => ctx.electron.shell.showItemInFolder(out));
            return out;
          })
          .catch((err) => {
            ctx.notify('Ошибка конвертации', err.message);
            throw err;
          });
        if (slow) {
          job.catch(() => {});
          return { hide: true };
        }
        const out = await job;
        return { keepOpen: true, toast: `Сохранено: ${path.basename(out)}`, refresh: true };
      },
    }));
  }

  /** Builds a palette item for a file or folder path. */
  function makeFileItem(p, opts = {}) {
    let isDir = opts.isDir;
    if (isDir === undefined) {
      try {
        isDir = fs.statSync(p).isDirectory();
      } catch {
        isDir = false;
      }
    }
    const isBundle = BUNDLE_EXT.has(path.extname(p).toLowerCase());
    const base = [];
    if (isDir && !isBundle && opts.navigable) {
      base.push({ id: 'navigate', title: 'Перейти внутрь', run: () => ({ query: p + path.sep }) });
    }
    base.push(A.openPath(p, isDir && !isBundle ? 'Открыть папку' : 'Открыть'), A.reveal(p), A.copyPath(p), A.copyName(p));
    if (!isDir) {
      base.push({
        id: 'trash',
        title: 'Переместить в корзину',
        confirm: 'Файл будет перемещён в корзину. Нажмите Enter ещё раз',
        run: async () => {
          await ctx.electron.shell.trashItem(p);
          return { keepOpen: true, toast: 'Перемещено в корзину', refresh: true };
        },
      });
    }
    const conv = isDir ? [] : conversionActions(p);
    const actions = opts.conversionsFirst && conv.length ? [...conv, ...base] : [...base.slice(0, 1), ...conv, ...base.slice(1)];
    return {
      id: `file:${p}`,
      title: path.basename(p) || p,
      subtitle: ctx.system.tildify(path.dirname(p)),
      category: isDir ? 'Папка' : 'Файл',
      icon: fileIcon(p, isDir),
      bias: -6,
      actions,
      enterOpensActions: Boolean(opts.enterOpensActions),
    };
  }

  /**
   * Fuzzy search over the index. Two passes: exact-ish matching first, and the
   * slower typo-tolerant pass only if the first one found few results.
   */
  function search(query, { limit = 8, onlyConvertible = false } = {}) {
    const PQ = prepareQuery(query);
    if (!PQ.variants.length) return [];
    const variantChars = PQ.variants.map((v) => [...new Set(v.compact)]);
    const results = [];
    const n = paths.length;

    const runPass = (typo) => {
      for (let i = 0; i < n; i++) {
        const name = norms[i];
        // Pre-filter: (almost) every query character must occur in the name.
        let pass = false;
        for (const chars of variantChars) {
          let missing = 0;
          for (const c of chars) if (!name.includes(c)) missing++;
          if (missing === 0 || (typo && missing <= 2 && chars.length >= 4)) {
            pass = true;
            break;
          }
        }
        if (!pass) continue;
        if (onlyConvertible && (dirs[i] || !conversionsFor(paths[i], tools()).length)) continue;
        if (!lite[i]) lite[i] = { title: names[i] };
        const m = matchItem(PQ, lite[i], { typo: typo ? 'strict' : false, minScore: typo ? 0.45 : 0.5 });
        if (m) results.push({ i, m });
      }
    };
    runPass(false);
    if (results.length < Math.max(5, limit)) {
      const found = new Set(results.map((r) => r.i));
      const firstPass = results.splice(0);
      runPass(true);
      const extra = results.splice(0).filter((r) => !found.has(r.i));
      results.push(...firstPass, ...extra);
    }

    const scored = results.map(({ i, m }) => {
      const id = `file:${paths[i]}`;
      // prefer shallower paths a little: ~/Documents/x beats ~/a/b/c/d/x
      const depth = paths[i].split(path.sep).length;
      const score = m.score * 100 + ctx.frecency.bonus(id) + ctx.frecency.queryBonus(id, query) - 6 - Math.min(depth, 12) * 0.25;
      return { i, m, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ i, m, score }) => {
      const item = makeFileItem(paths[i], { isDir: dirs[i], navigable: true, conversionsFirst: onlyConvertible, enterOpensActions: onlyConvertible });
      item.score = score;
      item.ranges = m.ranges;
      return item;
    });
  }

  /** "~/Documents/rep" -> entries of ~/Documents matching "rep". */
  function browse(query) {
    const expanded = ctx.system.expandHome(query.trim());
    if (!path.isAbsolute(expanded)) return null;
    const endsWithSep = /[\\/]$/.test(query);
    const dir = endsWithSep ? expanded : path.dirname(expanded);
    const partial = endsWithSep ? '' : path.basename(expanded);
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }).slice(0, 2000);
    } catch {
      return [];
    }
    const showHidden = partial.startsWith('.');
    let list = entries.filter((e) => showHidden || !e.name.startsWith('.'));
    let ranked;
    if (partial) {
      const PQ = prepareQuery(partial);
      ranked = list
        .map((e) => ({ e, m: matchItem(PQ, { title: e.name }, { typo: 'strict' }) }))
        .filter((x) => x.m)
        .sort((a, b) => b.m.score - a.m.score);
    } else {
      ranked = list
        .map((e) => ({ e, m: null }))
        .sort((a, b) => Number(b.e.isDirectory()) - Number(a.e.isDirectory()) || a.e.name.localeCompare(b.e.name));
    }
    const items = ranked.slice(0, 60).map(({ e, m }, idx) => {
      const full = path.join(dir, e.name);
      const item = makeFileItem(full, { isDir: e.isDirectory(), navigable: true });
      item.score = 900 - idx;
      item.ranges = m ? m.ranges : [];
      return item;
    });
    return items;
  }

  return {
    name: 'files',
    index,
    search,
    browse,
    makeFileItem,
    addPath,
    count: () => paths.length,
    isIndexing: () => Boolean(indexing),
    lastIndexed: () => lastIndexed,
  };
}

module.exports = { createFiles };
