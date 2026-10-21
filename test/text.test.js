'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { enToRu, ruToEn, fixLayout, transliterate, normalize } = require('../src/core/text');
const { TRANSFORMS, applyTransform } = require('../src/core/transforms');
const formats = require('../src/core/formats');
const keys = require('../src/core/keys');
const { parseTranslateQuery, chooseTargets } = require('../src/core/translate-query');

test('keyboard layout switching', () => {
  assert.equal(enToRu('ghbdtn'), 'привет');
  assert.equal(ruToEn('руддщ'), 'hello');
  assert.equal(fixLayout('ghbdtn? rfr ltkf'), 'привет, как дела');
  assert.equal(fixLayout('Ghbdtn'), 'Привет');
  assert.equal(fixLayout('Руддщ цщкдв'), 'Hello world');
});

test('transliteration keeps case', () => {
  assert.equal(transliterate('Привет, Мир!'), 'Privet, Mir!');
  assert.equal(transliterate('Щука и ёж'), 'Shchuka i yozh');
});

test('normalize keeps length so highlight indices stay valid', () => {
  for (const s of ['Ёлка', 'Café', 'ÉCOLE', 'Йогурт', 'naïve']) {
    assert.equal(normalize(s).length, s.length);
  }
  assert.equal(normalize('Ёлка'), 'елка');
  assert.equal(normalize('Café'), 'cafe');
  assert.equal(normalize('Йогурт'), 'йогурт');
});

test('case transforms', () => {
  const t = (id, s) => applyTransform(id, s);
  assert.equal(t('camel', 'hello big world'), 'helloBigWorld');
  assert.equal(t('pascal', 'hello big world'), 'HelloBigWorld');
  assert.equal(t('snake', 'helloBigWorld'), 'hello_big_world');
  assert.equal(t('kebab', 'Hello Big World'), 'hello-big-world');
  assert.equal(t('constant', 'parseHTTPResponse'), 'PARSE_HTTP_RESPONSE');
  assert.equal(t('title', 'the lord of the rings'), 'The Lord of the Rings');
  assert.equal(t('sentence', 'HELLO. HOW ARE YOU?'), 'Hello. How are you?');
});

test('line and encoding transforms', () => {
  const t = (id, s) => applyTransform(id, s);
  assert.equal(t('sortLines', 'b\na\nC\nfile10\nfile2'), 'a\nb\nC\nfile2\nfile10');
  assert.equal(t('uniqueLines', 'a\nb\na\nc\nb'), 'a\nb\nc');
  assert.equal(t('joinLines', ' a \n\n b\nc '), 'a b c');
  assert.equal(t('trim', '  a   b \n\n\n\n c  '), 'a b\n\nc');
  assert.equal(t('b64enc', 'Привет'), '0J/RgNC40LLQtdGC');
  assert.equal(t('b64dec', '0J/RgNC40LLQtdGC'), 'Привет');
  assert.throws(() => t('b64dec', 'не base64!'));
  assert.equal(t('urlenc', 'a b&c'), 'a%20b%26c');
  assert.equal(t('urldec', 'a+b%26c'), 'a b&c');
  assert.equal(t('htmlEsc', '<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
  assert.equal(t('htmlUnesc', '&lt;b&gt; &#x41; &#66; &amp;'), '<b> A B &');
  assert.equal(t('md5', 'abc'), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(t('jsonMin', '{\n "a": 1\n}'), '{"a":1}');
  assert.equal(t('urls', 'see https://a.com/x and http://b.org, https://a.com/x'), 'https://a.com/x\nhttp://b.org,');
  assert.match(t('stats', 'Hello world'), /Слов: 2/);
});

test('every transform has a unique id and a title', () => {
  const ids = TRANSFORMS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const t of TRANSFORMS) assert.ok(t.title && typeof t.fn === 'function');
});

test('CSV parsing handles quotes, delimiters and CRLF', () => {
  assert.deepEqual(formats.parseCsv('a,b\r\n"x, y","say ""hi"""\r\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  assert.deepEqual(formats.parseCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(JSON.parse(formats.csvToJson('name,age,ok\nAnna,21,true')), [{ name: 'Anna', age: 21, ok: true }]);
});

test('JSON <-> CSV/YAML and Markdown', () => {
  assert.equal(formats.jsonToCsv('[{"a":1,"b":"x,y"},{"a":2,"c":true}]'), 'a,b,c\n1,"x,y",\n2,,true');
  assert.equal(formats.jsonToCsv('[[1,2],[3,4]]'), '1,2\n3,4');
  const yaml = formats.jsonToYaml('{"a":[1,2],"b":{"c":"d"}}');
  assert.deepEqual(JSON.parse(formats.yamlToJson(yaml)), { a: [1, 2], b: { c: 'd' } });
  assert.equal(formats.markdownToHtml('# Hi **there**'), '<h1>Hi <strong>there</strong></h1>');
  assert.match(formats.markdownToHtmlDocument('x', '<T>'), /<title>T<\/title>/);
});

test('key combos for each platform', () => {
  assert.equal(keys.toSendKeys('ctrl+shift+t'), '^+t');
  assert.equal(keys.toSendKeys('alt+f4'), '%{F4}');
  assert.equal(keys.toSendKeys('enter'), '{ENTER}');
  assert.equal(keys.toXdotool('ctrl+shift+t'), 'ctrl+shift+t');
  assert.equal(keys.toXdotool('super+e'), 'super+e');
  assert.equal(keys.toXdotool('enter'), 'Return');
  assert.equal(keys.toAppleScript('mod+v'), 'tell application "System Events" to keystroke "v" using {command down}');
  assert.equal(keys.toAppleScript('enter'), 'tell application "System Events" to key code 36');
  assert.equal(keys.parseCombo('mod+c', 'win32').mods.has('ctrl'), true);
});

test('accelerator capture is layout independent', () => {
  assert.equal(keys.toAccelerator({ alt: true, code: 'Space' }, 'win32'), 'Alt+Space');
  assert.equal(keys.toAccelerator({ ctrl: true, shift: true, code: 'KeyK' }, 'linux'), 'Ctrl+Shift+K');
  assert.equal(keys.toAccelerator({ meta: true, code: 'Digit1' }, 'darwin'), 'Command+1');
  assert.equal(keys.toAccelerator({ code: 'KeyK' }, 'linux'), null, 'bare letters are rejected');
  assert.equal(keys.toAccelerator({ shift: true, code: 'KeyK' }, 'linux'), null, 'shift+letter is just typing');
  assert.equal(keys.toAccelerator({ code: 'F5' }, 'linux'), 'F5');
  assert.equal(keys.toAccelerator({ ctrl: true, code: 'ControlLeft' }, 'linux'), null);
});

test('translate query syntax', () => {
  assert.deepEqual(parseTranslateQuery('tr hello'), { text: 'hello', targets: null });
  assert.deepEqual(parseTranslateQuery('tr it: good morning'), { text: 'good morning', targets: ['it'] });
  assert.deepEqual(parseTranslateQuery('tr>it good morning'), { text: 'good morning', targets: ['it'] });
  assert.deepEqual(parseTranslateQuery('tr > en,ru ciao'), { text: 'ciao', targets: ['en', 'ru'] });
  assert.deepEqual(parseTranslateQuery('пер привет мир'), { text: 'привет мир', targets: null });
  assert.equal(parseTranslateQuery('trains'), null);
  assert.equal(parseTranslateQuery('tr xx: hi'), null);
  assert.deepEqual(chooseTargets('привет', null, ['ru', 'en', 'it']), ['en', 'it']);
  assert.deepEqual(chooseTargets('hello', null, ['ru', 'en']), ['ru', 'en']);
  assert.deepEqual(chooseTargets('hello', ['de'], ['ru']), ['de']);
});
