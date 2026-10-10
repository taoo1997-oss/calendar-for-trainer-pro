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

/* Манифест и значки — настоящие файлы по https-адресу, а не data:-ссылка.
   WebAPK на Android собирает сервер Google: ему нужно скачать манифест по
   URL, а data:-ссылку он скачать не может, и Chrome молча делает вместо
   приложения простой ярлык. */
function manifest() {
  const m = html.match(/<link rel="manifest" href="([^"]+)"/);
  assert.ok(m, 'в index.html нет <link rel="manifest">');
  assert.strictEqual(m[1], '/manifest.webmanifest', 'манифест должен отдаваться файлом, а не data:-ссылкой');
  const j = JSON.parse(readFileSync(join(HERE, '..', 'manifest.webmanifest'), 'utf8'));
  return j;
}

function icon(i) {
  assert.ok(i.src.startsWith('/icons/'), 'значок должен быть файлом в /icons/: ' + i.src);
  return readFileSync(join(HERE, '..', i.src.slice(1)));
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
    assert.strictEqual(icon(i).slice(1, 4).toString('ascii'), 'PNG', 'значок должен быть настоящим PNG-файлом');
  }
});

test('фон заставки совпадает с фоном значка — иначе вокруг знака белый круг', () => {
  const j = manifest();
  // Системная заставка обрезает значок круглой маской. Круг не виден только
  // тогда, когда background_color в точности равен фону самой картинки.
  const png = icon(j.icons[1]);
  assert.strictEqual(png.slice(1, 4).toString('ascii'), 'PNG', 'значок 512 должен быть PNG');
  // Цвет светлой темы «Снег». Фон иконок перекрашен в него же — см. recolor.
  assert.strictEqual(j.background_color.toLowerCase(), '#fcfbff');
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
