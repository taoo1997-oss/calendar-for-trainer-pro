/**
 * Чистые функции Domain: раскладка пересекающихся занятий, телефон, экранирование.
 *
 * Как и в subscription.test.mjs, код берётся прямо из index.html: тест
 * вырезает нужные методы объекта Domain по скобкам и собирает из них
 * маленький Domain в node:vm.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, '..', 'index.html'), 'utf8');

/** Текст метода «name(args) { … }» из литерала объекта Domain */
function extractMethod(src, name) {
  const re = new RegExp('\\n\\s{4}' + name + '\\([^)]*\\)\\s*\\{');
  const m = re.exec(src);
  assert.ok(m, 'Не найден метод ' + name);
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(m.index, j + 1).trim();
  }
  throw new Error('Не закрыт метод ' + name);
}

const names = ['timeToMinutes', 'overlapColumns', 'formatPhoneInput', 'escapeHtml', 'isValidPhone', 'isSafeId', 'sanitizeData'];
const ctx = {};
vm.createContext(ctx);
vm.runInContext('var Domain = {\n' + names.map((n) => extractMethod(html, n)).join(',\n') + '\n};', ctx);
const Domain = ctx.Domain;

const cls = (time, duration) => ({ time, duration });
const plain = (v) => JSON.parse(JSON.stringify(v));

test('overlapColumns: занятия без пересечений — по одному на всю ширину', () => {
  assert.deepEqual(plain(Domain.overlapColumns([cls('10:00', 60), cls('11:00', 60)])),
    [{ col: 0, cols: 1 }, { col: 0, cols: 1 }]);
});

test('overlapColumns: два занятия в одно время делят ширину пополам', () => {
  assert.deepEqual(plain(Domain.overlapColumns([cls('10:00', 60), cls('10:00', 60)])),
    [{ col: 0, cols: 2 }, { col: 1, cols: 2 }]);
});

test('overlapColumns: цепочка пересечений и освободившаяся колонка', () => {
  // 10:00–11:00 и 10:30–11:30 пересекаются, 11:00–12:00 встаёт в первую
  // колонку (она освободилась в 11:00), но остаётся в той же группе.
  const r = plain(Domain.overlapColumns([cls('10:00', 60), cls('10:30', 60), cls('11:00', 60), cls('13:00', 60)]));
  assert.deepEqual(r, [{ col: 0, cols: 2 }, { col: 1, cols: 2 }, { col: 0, cols: 2 }, { col: 0, cols: 1 }]);
});

test('overlapColumns: без длительности считается час', () => {
  assert.deepEqual(plain(Domain.overlapColumns([{ time: '09:00' }, { time: '09:59' }])),
    [{ col: 0, cols: 2 }, { col: 1, cols: 2 }]);
  assert.deepEqual(plain(Domain.overlapColumns([])), []);
});

test('formatPhoneInput: обычный ввод', () => {
  assert.equal(Domain.formatPhoneInput('+7 999 111-22-33'), '+7 999 111-22-33');
  assert.equal(Domain.formatPhoneInput('89991112233'), '+7 999 111-22-33');
  assert.equal(Domain.formatPhoneInput('9991112233'), '+7 999 111-22-33');
  // Казахстан: код тот же, номер начинается с 7
  assert.equal(Domain.formatPhoneInput('+7 701 123 45 67'), '+7 701 123-45-67');
  // Лишняя цифра после полного номера отбрасывается, номер не сдвигается
  assert.equal(Domain.formatPhoneInput('+7 701 123-45-678'), '+7 701 123-45-67');
});

test('sanitizeData: id с разметкой отбрасывается вместе со ссылками на него', () => {
  const bad = 'x"><img src=x onerror=alert(1)>';
  const r = plain(Domain.sanitizeData({
    clients: [{ id: bad, name: 'А' }, { id: 'lq3k9a1b2c', name: 'Б' }, { id: 1700000000000, name: 'Старый id-число' }],
    classes: [
      { id: 'c1', date: '2026-10-06', time: '9:30', clientIds: ['lq3k9a1b2c', bad], payments: { lq3k9a1b2c: true, [bad]: true }, clubGroupId: bad },
      { id: 'c2', date: '2026-10-06"><b>', time: '10:00' }
    ],
    clubGroups: [{ id: '0b5e9c1e-7a1d-4c2e-9f00-1a2b3c4d5e6f', name: 'Г', memberIds: ['m1', bad] }],
    incomes: [{ id: 'i1', clientId: bad }],
    settings: { theme: 'dark' }
  }));
  assert.deepEqual(r.clients.map((c) => c.id), ['lq3k9a1b2c', 1700000000000]);
  assert.deepEqual(r.classes.map((c) => c.id), ['c1']);
  assert.deepEqual(r.classes[0].clientIds, ['lq3k9a1b2c']);
  assert.deepEqual(Object.keys(r.classes[0].payments), ['lq3k9a1b2c']);
  assert.equal('clubGroupId' in r.classes[0], false);
  assert.deepEqual(r.clubGroups[0].memberIds, ['m1']);
  assert.equal('clientId' in r.incomes[0], false);
  assert.deepEqual(r.settings, { theme: 'dark' });
  assert.equal(r.dropped, 2);
});

test('sanitizeData: длительность из внешних данных становится числом', () => {
  const r = plain(Domain.sanitizeData({
    classes: [
      { id: 'c1', date: '2026-10-06', time: '10:00', duration: '<img src=x onerror=alert(1)>' },
      { id: 'c2', date: '2026-10-06', time: '11:00', duration: '90' },
      { id: 'c3', date: '2026-10-06', time: '12:00', duration: 99999 },
      { id: 'c4', date: '2026-10-06', time: '13:00' }
    ]
  }));
  assert.deepEqual(r.classes.map((c) => c.duration), [60, 90, 600, undefined]);
});

test('escapeHtml экранирует обе кавычки', () => {
  assert.equal(Domain.escapeHtml(`a"b'c<d>&`), 'a&quot;b&#39;c&lt;d&gt;&amp;');
});
