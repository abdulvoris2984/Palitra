'use strict';

// File format conversion. Picks a backend per file type:
//   images  -> Chromium (decode + canvas re-encode in the renderer), no deps;
//              HEIC/TIFF on macOS via the built-in `sips`
//   data    -> pure JS (CSV, JSON, YAML, Markdown)
//   office  -> LibreOffice (`soffice --headless --convert-to`) if installed
//   media   -> FFmpeg if installed
// The result is written next to the source file, never overwriting anything.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const formats = require('../core/formats');

const IMAGE_IN = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'ico', 'avif', 'svg'];
const IMAGE_OUT = ['png', 'jpg', 'webp'];
const SIPS_IN = ['heic', 'heif', 'tiff', 'tif'];
const VIDEO_IN = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv', 'flv', '3gp', 'mpeg', 'mpg'];
const AUDIO_IN = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus', 'wma', 'aiff'];
const DOC_IN = ['doc', 'docx', 'odt', 'rtf', 'txt'];
const SHEET_IN = ['xls', 'xlsx', 'ods', 'csv'];
const SLIDES_IN = ['ppt', 'pptx', 'odp'];

const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

function extOf(p) {
  return path.extname(p).slice(1).toLowerCase();
}

/** Lists the conversions available for a file given the installed tools. */
function conversionsFor(filePath, tools = {}) {
  const ext = extOf(filePath);
  const list = [];
  const add = (to, kind, title, opts = {}) => list.push({ id: `${kind}:${to}${opts.suffix ? ':' + opts.suffix : ''}`, to, kind, title, ...opts });

  if (IMAGE_IN.includes(ext)) {
    const self = ext === 'jpeg' ? 'jpg' : ext;
    for (const to of IMAGE_OUT) if (to !== self) add(to, 'image', `Конвертировать в ${to.toUpperCase()}`);
    if (ext !== 'svg' && ext !== 'ico' && ext !== 'gif') {
      const out = IMAGE_OUT.includes(self) ? self : 'png';
      add(out, 'image', 'Уменьшить в 2 раза', { scale: 0.5, suffix: 'half' });
    }
  }
  if (SIPS_IN.includes(ext) && tools.sips) {
    add('jpg', 'sips', 'Конвертировать в JPG');
    add('png', 'sips', 'Конвертировать в PNG');
  }
  if (ext === 'csv' || ext === 'tsv') add('json', 'text', 'Конвертировать в JSON');
  if (ext === 'json') {
    add('csv', 'text', 'Конвертировать в CSV');
    add('yaml', 'text', 'Конвертировать в YAML');
  }
  if (ext === 'yaml' || ext === 'yml') add('json', 'text', 'Конвертировать в JSON');
  if (ext === 'md' || ext === 'markdown') add('html', 'text', 'Конвертировать в HTML');

  if (tools.soffice) {
    if (DOC_IN.includes(ext) || SHEET_IN.includes(ext) || SLIDES_IN.includes(ext) || ext === 'html') {
      if (ext !== 'csv') add('pdf', 'soffice', 'Конвертировать в PDF');
      else add('pdf', 'soffice', 'Конвертировать в PDF (LibreOffice)');
    }
    if (['doc', 'odt', 'rtf'].includes(ext)) add('docx', 'soffice', 'Конвертировать в DOCX');
    if (ext === 'docx') add('odt', 'soffice', 'Конвертировать в ODT');
    if (['xls', 'ods', 'csv'].includes(ext)) add('xlsx', 'soffice', 'Конвертировать в XLSX');
    if (['xls', 'xlsx', 'ods'].includes(ext)) add('csv', 'soffice', 'Конвертировать в CSV');
    if (['ppt', 'odp'].includes(ext)) add('pptx', 'soffice', 'Конвертировать в PPTX');
  }

  if (tools.ffmpeg) {
    if (VIDEO_IN.includes(ext)) {
      if (ext !== 'mp4') add('mp4', 'ffmpeg', 'Конвертировать в MP4');
      add('gif', 'ffmpeg', 'Сделать GIF');
      add('mp3', 'ffmpeg', 'Извлечь звук в MP3');
    }
    if (AUDIO_IN.includes(ext)) {
      for (const to of ['mp3', 'wav', 'ogg', 'm4a']) if (to !== ext) add(to, 'ffmpeg', `Конвертировать в ${to.toUpperCase()}`);
    }
  }
  return list;
}

/** "photo.png" -> "photo.jpg", or "photo (1).jpg" if that already exists. */
function uniqueOutputPath(src, ext, suffix = '') {
  const dir = path.dirname(src);
  const base = path.basename(src, path.extname(src)) + suffix;
  let candidate = path.join(dir, `${base}.${ext}`);
  for (let i = 1; fs.existsSync(candidate); i++) candidate = path.join(dir, `${base} (${i}).${ext}`);
  return candidate;
}

function convertText(src, to, text) {
  const ext = extOf(src);
  if (ext === 'csv' || ext === 'tsv') return formats.csvToJson(text);
  if (ext === 'json' && to === 'csv') return formats.jsonToCsv(text);
  if (ext === 'json' && to === 'yaml') return formats.jsonToYaml(text);
  if (ext === 'yaml' || ext === 'yml') return formats.yamlToJson(text);
  if (ext === 'md' || ext === 'markdown') return formats.markdownToHtmlDocument(text, path.basename(src));
  throw new Error(`Нет конвертера ${ext} → ${to}`);
}

function ffmpegArgs(src, out, to) {
  const base = ['-hide_banner', '-loglevel', 'error', '-y', '-i', src];
  switch (to) {
    case 'mp4':
      return [...base, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out];
    case 'gif':
      return [...base, '-vf', 'fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse', '-loop', '0', out];
    case 'mp3':
      return [...base, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', out];
    case 'wav':
      return [...base, '-vn', out];
    case 'ogg':
      return [...base, '-vn', '-c:a', 'libvorbis', '-q:a', '5', out];
    case 'm4a':
      return [...base, '-vn', '-c:a', 'aac', '-b:a', '192k', out];
    default:
      throw new Error(`FFmpeg: неизвестный формат ${to}`);
  }
}

/**
 * Runs a conversion. `deps` provides: run(cmd,args,opts), tools {soffice, ffmpeg, sips},
 * convertImage(bytes, inExt, outMime, scale) -> Uint8Array (renderer-side).
 * Resolves to the output path.
 */
async function convertFile(src, conv, deps) {
  const suffix = conv.scale ? '-small' : '';
  const out = uniqueOutputPath(src, conv.to, suffix);

  if (conv.kind === 'image') {
    const bytes = await fs.promises.readFile(src);
    const result = await deps.convertImage(bytes, extOf(src), MIME[conv.to], conv.scale || 1);
    await fs.promises.writeFile(out, Buffer.from(result));
    return out;
  }

  if (conv.kind === 'text') {
    const text = await fs.promises.readFile(src, 'utf8');
    await fs.promises.writeFile(out, convertText(src, conv.to, text), 'utf8');
    return out;
  }

  if (conv.kind === 'sips') {
    const format = conv.to === 'jpg' ? 'jpeg' : conv.to;
    await deps.run('sips', ['-s', 'format', format, src, '--out', out], { timeout: 120000 });
    return out;
  }

  if (conv.kind === 'ffmpeg') {
    await deps.run(deps.tools.ffmpeg, ffmpegArgs(src, out, conv.to), { timeout: 60 * 60 * 1000 });
    return out;
  }

  if (conv.kind === 'soffice') {
    // LibreOffice always names the output after the input, so convert into a
    // temporary folder and move the file to a unique name afterwards.
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'palitra-'));
    try {
      const filter = conv.to === 'csv' ? 'csv:Text - txt - csv (StarCalc):44,34,76' : conv.to;
      await deps.run(deps.tools.soffice, ['--headless', '--norestore', '--convert-to', filter, '--outdir', tmp, src], { timeout: 5 * 60 * 1000 });
      const produced = (await fs.promises.readdir(tmp)).find((f) => f.toLowerCase().endsWith(`.${conv.to}`));
      if (!produced) throw new Error('LibreOffice не создал файл');
      await fs.promises.copyFile(path.join(tmp, produced), out);
      return out;
    } finally {
      fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }

  throw new Error(`Неизвестный тип конвертации ${conv.kind}`);
}

module.exports = { conversionsFor, convertFile, uniqueOutputPath, extOf };
