'use strict';

// Thin wrapper over Electron's asynchronous (W3C-style) clipboard API:
// readText/writeText return promises, images and raw OS formats are read via
// clipboard.read() -> ClipboardItem.getType(type) -> Blob.

const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { clipboard, nativeImage } = require('electron');
const { expandHome } = require('./system');

const RAW = (format) => `electron application/osclipboard;format="${format}"`;

async function readText() {
  try {
    return (await clipboard.readText()) || '';
  } catch {
    return '';
  }
}

async function writeText(text) {
  await clipboard.writeText(String(text));
}

async function clear() {
  await clipboard.clear();
}

async function items() {
  try {
    return await clipboard.read();
  } catch {
    return [];
  }
}

/** Returns the clipboard image as PNG bytes, or null. */
async function readImagePng() {
  for (const item of await items()) {
    const type = item.types.find((t) => t.startsWith('image/'));
    if (!type) continue;
    const blob = await item.getType(type);
    const buf = Buffer.from(await blob.arrayBuffer());
    if (type === 'image/png') return buf;
    const img = nativeImage.createFromBuffer(buf);
    return img.isEmpty() ? null : img.toPNG();
  }
  return null;
}

/**
 * Paths of files copied in the file manager (Ctrl+C in Explorer, Finder,
 * Nautilus…), or a single absolute path copied as text.
 */
async function readFiles() {
  const out = [];
  const add = (p) => {
    if (p && fs.existsSync(p) && !out.includes(p)) out.push(p);
  };
  const addUrls = (text) => {
    for (const line of String(text).split(/\r?\n/)) {
      const l = line.trim().replace(/\0/g, '');
      if (!l.startsWith('file://')) continue;
      try {
        add(fileURLToPath(l));
      } catch {
        // malformed URL
      }
    }
  };

  for (const item of await items()) {
    for (const type of item.types) {
      try {
        if (type === RAW('FileNameW')) {
          const buf = Buffer.from(await (await item.getType(type)).arrayBuffer());
          add(buf.toString('utf16le').replace(/\0+$/, ''));
        } else if (type === RAW('FileName')) {
          add(Buffer.from(await (await item.getType(type)).arrayBuffer()).toString('latin1').replace(/\0+$/, ''));
        } else if (
          type === 'text/uri-list' ||
          type === RAW('text/uri-list') ||
          type === RAW('x-special/gnome-copied-files') ||
          type === RAW('public.file-url') ||
          type === RAW('NSFilenamesPboardType')
        ) {
          const text = await (await item.getType(type)).text();
          if (type === RAW('NSFilenamesPboardType')) {
            for (const m of text.matchAll(/<string>([^<]+)<\/string>/g)) add(m[1]);
          } else {
            addUrls(text);
          }
        }
      } catch {
        // this format could not be read; try the next one
      }
    }
  }

  const text = (await readText()).trim().replace(/^"(.*)"$/, '$1');
  if (text && text.length < 1024 && !text.includes('\n')) {
    if (text.startsWith('file://')) addUrls(text);
    else if (path.isAbsolute(expandHome(text))) add(expandHome(text));
  }
  return out;
}

module.exports = { readText, writeText, clear, readImagePng, readFiles };
