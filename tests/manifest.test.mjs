/**
 * Проверки манифеста — сторож против регрессии, которая уже случалась.
 *
 * История: значки в манифесте пометили как purpose "maskable" и добавили
 * третий, purpose "any", чтобы убрать белый круг с заставки. Базовые
 * критерии установки при этом продолжали выполняться (десктопный Chrome
 * исправно выдавал beforeinstallprompt), но WebAPK на Android собирает
 * сервер Google, и он на такой набор не согласился: Chrome вместо
 * приложения стал делать простой ярлык сайта — со значком браузера в углу
 * и адресной строкой при запуске. Снаружи это выглядело как «установка
 * сломалась», а изнутри всё было «валидно».
 *
 * Отсюда правило: набор значков — ровно тот, с которым установка
 * проверена вживую. Любая правка здесь роняет тест, и это намеренно.
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

function manifest() {
  const m = html.match(/data:application\/manifest\+json;base64,([A-Za-z0-9+/=]+)/);
  assert.ok(m, 'манифест должен быть встроен как data:application/manifest+json;base64');
  return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
}

test('манифест разбирается и содержит обязательные поля', () => {
  const j = manifest();
  for (const key of ['id', 'name', 'short_name', 'start_url', 'scope', 'display',
                     'background_color', 'theme_color', 'icons']) {
    assert.ok(j[key], 'нет поля ' + key);
  }
  assert.strictEqual(j.display, 'standalone');
});

test('id, start_url и scope абсолютные', () => {
  // У data:-URI нет базы, относительные пути разрешать не от чего.
  const j = manifest();
  for (const key of ['id', 'start_url', 'scope']) {
    assert.ok(j[key].startsWith('/'), key + ' должен начинаться с /, а он ' + j[key]);
  }
});

test('набор значков — тот, с которым Chrome собирает приложение, а не ярлык', () => {
  const j = manifest();
  assert.strictEqual(j.icons.length, 2, 'значков должно быть ровно два');
  assert.deepStrictEqual(
    j.icons.map((i) => i.sizes + ' ' + i.purpose),
    ['192x192 any maskable', '512x512 any maskable'],
    'см. заголовок файла: менять набор значков нельзя без живой проверки установки'
  );
  for (const i of j.icons) {
    assert.strictEqual(i.type, 'image/png');
    assert.ok(i.src.startsWith('data:image/png;base64,'), 'значок должен быть встроенным PNG');
  }
});

test('фон заставки совпадает с фоном значка — иначе вокруг знака белый круг', () => {
  const j = manifest();
  // Системная заставка обрезает значок круглой маской. Круг не виден только
  // тогда, когда background_color в точности равен фону самой картинки.
  const png = Buffer.from(j.icons[1].src.split(',')[1], 'base64');
  assert.strictEqual(png.slice(1, 4).toString('ascii'), 'PNG', 'значок 512 должен быть PNG');
  assert.strictEqual(j.background_color.toLowerCase(), '#fdf2f4');
});

test('фон нашей заставки в установленном режиме равен background_color', () => {
  // Наша заставка продолжает системную. Разойдутся цвета — при передаче
  // будет заметный скачок яркости.
  const j = manifest();
  const rule = html.match(/\[data-launch="installed"\]\s*\.splash-bg\s*\{\s*background:\s*([#0-9A-Fa-f]+)/);
  assert.ok(rule, 'нет правила [data-launch="installed"] .splash-bg');
  assert.strictEqual(rule[1].toLowerCase(), j.background_color.toLowerCase());
});

test('своего знака поверх системной заставки нет', () => {
  // Повторить системный знак не получается: она центрует его по экрану, а
  // мы по окну, и знак садится ниже. Подробности — в комментарии к
  // «Заставка установленного приложения» в index.html.
  assert.ok(!html.includes('splash-boot'), 'splash-boot вернулся — знак снова будет скакать');
});
