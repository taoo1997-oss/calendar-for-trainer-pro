/**
 * Танцевальный тренер — offline shell.
 *
 * ГЛАВНОЕ ОТЛИЧИЕ ОТ ПРЕЖНЕЙ ВЕРСИИ: сама страница берётся из сети,
 * а не из кэша.
 *
 * Раньше index.html отдавался кэшем сразу и безусловно. Приложение
 * запускалось мгновенно, но обновление не приезжало никогда: заливаешь
 * новую сборку на Pages, открываешь телефон — а там прежняя. Ровно то,
 * из-за чего сборка 51 продолжала жить после выкладки 53.
 *
 * Теперь для самой страницы стратегия «сначала сеть»: пробуем скачать,
 * и только если сети нет — достаём из кэша. Задержка на старте — это
 * один запрос к файлу, который лежит на CDN; потеря обновлений стоила
 * дороже.
 *
 * Всё остальное (иконки, шрифты, статика) по-прежнему берётся из кэша
 * сразу: эти файлы не меняются, и гонять их по сети незачем.
 */

/* Версию поднимать при каждой выкладке. Смена имени кэша — это и есть
   команда «выброси всё старое»: activate вычистит прежние хранилища. */
const CACHE = 'cc-0.4.15';

/* Оболочка: то, без чего приложение не откроется офлайн. */
const SHELL = [
  './',
  './index.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      /* Не ждём, пока закроются все вкладки со старой версией.
         Без skipWaiting новый воркер стоит в очереди до полного
         закрытия приложения — на телефоне это может не случиться
         неделями. */
      .then(() => self.skipWaiting())
      .catch((e) => console.warn('[sw] install', e))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      /* Берём под управление уже открытые вкладки сразу, а не со
         следующего запуска. */
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  /* Чужие домены не трогаем: Яндекс.Диск, OAuth и прочее должны
     ходить в сеть напрямую, кэшировать их ответы нельзя. */
  if (url.origin !== self.location.origin) return;

  /* Навигация (открытие приложения) и сам index.html — сначала сеть. */
  const isPage = req.mode === 'navigate' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('/index.html');

  if (isPage) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          /* Свежую страницу кладём в кэш — она пригодится офлайн. */
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          /* Сети нет — работаем тем, что сохранили в прошлый раз. */
          caches.match('./index.html').then((r) => r || caches.match('./'))
        )
    );
    return;
  }

  /* Остальное — сначала кэш, потом сеть. */
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => cached))
  );
});
