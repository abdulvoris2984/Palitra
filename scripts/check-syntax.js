'use strict';

// Parses every source file with `node --check` (catches syntax errors in
// files that the unit tests do not load, such as the Electron main process).

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && !['node_modules', 'dist', '.git'].includes(e.name)) walk(full);
    else if (e.isFile() && e.name.endsWith('.js')) files.push(full);
  }
})(root);

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    console.error(String(err.stderr || err.message));
  }
}
console.log(`${files.length - failed}/${files.length} files OK`);
process.exit(failed ? 1 : 0);
