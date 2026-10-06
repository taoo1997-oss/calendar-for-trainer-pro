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

const names = ['timeToMinutes', 'overlapColumns', 'formatPhoneInput', 'escapeHtml', 'isValidPhone'];
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

test('escapeHtml экранирует обе кавычки', () => {
  assert.equal(Domain.escapeHtml(`a"b'c<d>&`), 'a&quot;b&#39;c&lt;d&gt;&amp;');
});
