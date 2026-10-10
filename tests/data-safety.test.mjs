/**
 * Сторожа сохранности данных и вёрстки имён — регрессии, которые уже случались.
 *
 * 1) Вход под новым id раньше удалял старый ключ данных, а переносил данные
 *    только если нового ключа не существовало вовсе. Пустая запись на новом id
 *    — и расписание тренера стиралось.
 * 2) Несколько учеников в одном занятии наезжали друг на друга: nowrap +
 *    overflow:hidden у контейнера, а текст плашки вылезал за её границы.
 *
 * Запуск:  npm test
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, '..', 'index.html'), 'utf8');

test('_adoptServerUser не удаляет старый ключ данных', () => {
  const start = html.indexOf('_adoptServerUser(serverUser');
  const end = html.indexOf('var user = {', start);
  const body = html.slice(start, end);
  assert.ok(body.includes('rename'), 'блок переноса данных найден');
  assert.ok(!/removeKey\s*\(/.test(body), 'старый ключ данных удалять нельзя — он резервная копия');
});

test('перенос данных идёт и поверх пустой записи на новом id', () => {
  const start = html.indexOf('_adoptServerUser(serverUser');
  const body = html.slice(start, html.indexOf('var user = {', start));
  assert.ok(/countRecords\(newData\)\s*===\s*0/.test(body), 'пустая запись на новом id должна считаться пустой');
});

test('есть восстановление данных, оставшихся под другим аккаунтом', () => {
  assert.ok(html.includes('findStrayData('));
  assert.ok(html.includes('data-action="recover-stray"'));
  assert.ok(html.includes('recoverStrayData(true)'), 'предложение при входе в пустой аккаунт');
});

test('имена учеников в списке дня переносятся, а не наезжают друг на друга', () => {
  const rule = html.match(/#dayClasses \.time-class-clients \{([^}]*)\}/);
  assert.ok(rule, 'нет правила #dayClasses .time-class-clients');
  assert.ok(/flex-wrap:\s*wrap/.test(rule[1]), 'flex-wrap должен быть wrap');
  assert.ok(!/nowrap/.test(rule[1]), 'nowrap возвращать нельзя');
  assert.ok(html.includes('class="name-text"'), 'имя в плашке обёрнуто в .name-text для многоточия');
});
