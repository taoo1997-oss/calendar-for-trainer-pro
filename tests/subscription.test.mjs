/**
 * Юнит-тесты логики подписки (бесплатно / Pro).
 *
 * Приложение — один HTML-файл без сборки, поэтому тестировать «как обычно»
 * (импортировать модуль) нельзя. Вместо этого тест ВЫРЕЗАЕТ из index.html
 * помеченный блок чистой логики (маркеры @limits:start / @limits:end) и
 * выполняет его в изолированном контексте node:vm. Так тест всегда проверяет
 * ровно тот код, который поедет в браузер, а не его копию.
 *
 * Запуск:  node --test tests/
 *          (или:  npm test)
 */
import { test } from 'node:test';
// Не /strict: часть значений создаётся в отдельном контексте node:vm, и у них
// другой Object.prototype — deepStrictEqual считал бы их неравными.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX = join(HERE, '..', 'index.html');
const html = readFileSync(INDEX, 'utf8');

/* —— 1. Вырезаем чистую логику лимитов —— */
function extractBlock(src, startMark, endMark) {
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark, a + startMark.length);
  if (a === -1 || b === -1) {
    throw new Error(`Не найден блок ${startMark} … ${endMark} в index.html`);
  }
  return src.slice(a + startMark.length, b);
}

const limitsSrc = extractBlock(html, '/* @limits:start */', '/* @limits:end */');
const sandbox = { Date };
vm.createContext(sandbox);
vm.runInContext(limitsSrc, sandbox, { filename: 'limits-block.js' });

const { SUB_FREE_LIMITS, subCheckLimit, subCountClassesOnDate, subIsActive } = sandbox;

/* —— 2. Достаём CONFIG.SUBSCRIPTION из index.html (без исполнения всего файла) —— */
function extractSubscriptionConfig(src) {
  const key = 'SUBSCRIPTION: {';
  const start = src.indexOf(key);
  assert.ok(start !== -1, 'CONFIG.SUBSCRIPTION не найден');
  // Идём по фигурным скобкам от открывающей после "SUBSCRIPTION: "
  let i = src.indexOf('{', start);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const objSrc = src.slice(i, j + 1);
        return vm.runInNewContext('(' + objSrc + ')', { Infinity });
      }
    }
  }
  throw new Error('Не удалось разобрать объект SUBSCRIPTION');
}
const SUBSCRIPTION = extractSubscriptionConfig(html);

/* ============================ ТЕСТЫ ============================ */

test('константы лимитов соответствуют оговорённым', () => {
  assert.deepEqual(SUB_FREE_LIMITS, {
    clients: 10,
    classesPerDay: 4,
    clubMembers: 20,
    clubGroups: 2
  });
  // блок логики и CONFIG в index.html не должны разойтись
  assert.deepEqual(SUBSCRIPTION.FREE_LIMITS, SUB_FREE_LIMITS);
});

test('цена — 200 ₽ / 2 €, период 30 дней', () => {
  assert.equal(SUBSCRIPTION.PRICE_RUB, 200);
  assert.equal(SUBSCRIPTION.PRICE_EUR, 2);
  assert.equal(SUBSCRIPTION.PERIOD_DAYS, 30);
});

test('способы оплаты пока без обработчиков (не подключены)', () => {
  assert.ok(Array.isArray(SUBSCRIPTION.METHODS));
  assert.deepEqual(
    SUBSCRIPTION.METHODS.map((m) => m.id).sort(),
    ['card', 'sbp', 'yoomoney']
  );
  for (const m of SUBSCRIPTION.METHODS) {
    assert.equal(m.handler, null, `метод ${m.id} не должен иметь handler до подключения оплаты`);
  }
});

test('subCheckLimit: клиенты — 10 можно, 11-й под подписку', () => {
  assert.equal(subCheckLimit('clients', 9, false).ok, true, '10-го добавить можно');
  assert.equal(subCheckLimit('clients', 10, false).ok, false, '11-й — стоп');
  assert.equal(subCheckLimit('clients', 25, false).ok, false, 'сверх лимита — стоп');

  const at9 = subCheckLimit('clients', 9, false);
  assert.equal(at9.limit, 10);
  assert.equal(at9.used, 9);
  assert.equal(at9.remaining, 1);

  assert.equal(subCheckLimit('clients', 10, false).remaining, 0);
  assert.equal(subCheckLimit('clients', 99, false).remaining, 0, 'remaining не уходит в минус');
});

test('subCheckLimit: занятия в день — потолок 4', () => {
  assert.equal(subCheckLimit('classesPerDay', 3, false).ok, true);
  assert.equal(subCheckLimit('classesPerDay', 4, false).ok, false);
});

test('subCheckLimit: члены клуба — 20, группы — 2', () => {
  assert.equal(subCheckLimit('clubMembers', 19, false).ok, true);
  assert.equal(subCheckLimit('clubMembers', 20, false).ok, false);
  assert.equal(subCheckLimit('clubGroups', 1, false).ok, true);
  assert.equal(subCheckLimit('clubGroups', 2, false).ok, false);
});

test('subCheckLimit: Pro снимает любой лимит', () => {
  for (const kind of ['clients', 'classesPerDay', 'clubMembers', 'clubGroups']) {
    const r = subCheckLimit(kind, 9999, true);
    assert.equal(r.ok, true, `${kind}: с Pro всегда ok`);
    assert.equal(r.limit, Infinity);
    assert.equal(r.remaining, Infinity);
  }
});

test('subCheckLimit: неизвестный раздел не ограничивается', () => {
  const r = subCheckLimit('somethingElse', 1000, false);
  assert.equal(r.ok, true);
  assert.equal(r.limit, Infinity);
});

test('subCheckLimit: мусор во used трактуется как 0', () => {
  assert.equal(subCheckLimit('clients', -5, false).used, 0);
  assert.equal(subCheckLimit('clients', NaN, false).used, 0);
  assert.equal(subCheckLimit('clients', undefined, false).used, 0);
});

test('subCountClassesOnDate: считает только нужный день', () => {
  const classes = [
    { date: '2026-09-03' },
    { date: '2026-09-03' },
    { date: '2026-09-04' },
    null,
    { date: '2026-09-03' }
  ];
  assert.equal(subCountClassesOnDate(classes, '2026-09-03'), 3);
  assert.equal(subCountClassesOnDate(classes, '2026-09-04'), 1);
  assert.equal(subCountClassesOnDate(classes, '2026-09-05'), 0);
  assert.equal(subCountClassesOnDate(null, '2026-09-03'), 0);
  assert.equal(subCountClassesOnDate(classes, ''), 0);
});

test('subIsActive: свободный тариф — не активен', () => {
  assert.equal(subIsActive({ plan: 'free', until: null }, Date.now()), false);
  assert.equal(subIsActive(null, Date.now()), false);
  assert.equal(subIsActive({ plan: 'pro' }, Date.now()), true, 'pro без срока = бессрочно');
});

test('subIsActive: срок действия учитывается', () => {
  const now = Date.UTC(2026, 8, 3);
  const future = Date.UTC(2026, 8, 20);
  const past = Date.UTC(2026, 7, 1);
  assert.equal(subIsActive({ plan: 'pro', until: future }, now), true);
  assert.equal(subIsActive({ plan: 'pro', until: past }, now), false);
  // ISO-строка тоже принимается
  assert.equal(subIsActive({ plan: 'pro', until: new Date(future).toISOString() }, now), true);
});

test('сценарий: тренер добавляет клиентов от 8 до 12', () => {
  const isPro = false;
  const results = [];
  for (let count = 8; count <= 12; count++) {
    results.push(subCheckLimit('clients', count, isPro).ok);
  }
  //            8→9   9→10  10→11 11→12 12→13
  assert.deepEqual(results, [true, true, false, false, false]);
});
