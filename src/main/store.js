'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[palitra] cannot read ${file}: ${err.message}`);
    return fallback;
  }
}

/** Writes atomically (tmp file + rename) so a crash never leaves half a file. */
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

/** A JSON file that is saved with a debounce and flushed on demand. */
class DebouncedJsonFile {
  constructor(file, getData, delay = 1500) {
    this.file = file;
    this.getData = getData;
    this.delay = delay;
    this.timer = null;
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delay);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    try {
      writeJson(this.file, this.getData());
    } catch (err) {
      console.warn(`[palitra] cannot save ${this.file}: ${err.message}`);
    }
  }
}

module.exports = { readJson, writeJson, DebouncedJsonFile };
