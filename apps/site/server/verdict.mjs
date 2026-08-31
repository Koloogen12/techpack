#!/usr/bin/env node
/**
 * Сборщик вердиктов — единственная живая часть на сервере.
 *
 * Семьдесят строк без единой зависимости. Так задумано: на машине, где
 * крутится десяток чужих продов, наш сервис не должен уметь ничего, кроме
 * как принять форму и дописать строку в файл. Нет базы — нечего дропнуть,
 * нет пакетов — нечего обновлять, нет ключей — нечему утечь.
 *
 * Данные пишутся ДОПИСЫВАНИЕМ в JSONL и никогда не переписываются: вердикт
 * фабрики это результат эксперимента, а результат эксперимента не правят.
 */
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const PORT = Number(process.env.PORT ?? 8130);
const DATA = process.env.VERDICT_FILE ?? '/opt/seamster/data/verdicts.jsonl';
const ADMIN = process.env.ADMIN_TOKEN ?? '';
const MAX_BODY = 16 * 1024;

mkdirSync(dirname(DATA), { recursive: true });

/** Простой заслон от повторов: один адрес — не чаще раза в десять секунд. */
const seen = new Map();
function tooOften(ip) {
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > 60000) seen.delete(k);
  const last = seen.get(ip);
  seen.set(ip, now);
  return last !== undefined && now - last < 10000;
}

function page(title, body) {
  return (
    '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' +
    title +
    '</title>' +
    '<style>body{margin:0;background:#FBFAF8;color:#161616;font-family:Sora,Arial,sans-serif;' +
    'font-size:16px;line-height:1.6}main{max-width:60ch;margin:0 auto;padding:80px 24px}' +
    'h1{font-size:26px;margin:0 0 12px}a{color:#161616}</style></head>' +
    '<body><main>' +
    body +
    '</main></body></html>'
  );
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const ip = req.headers['x-real-ip'] ?? req.socket.remoteAddress ?? '?';

  if (req.method === 'GET' && url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok\n');
  }

  // Чтение ответов — только по токену. Вердикты фабрик это чужие слова
  // о чужих документах, и открытыми они быть не могут.
  if (req.method === 'GET' && url.pathname === '/api/verdicts') {
    if (!ADMIN || url.searchParams.get('k') !== ADMIN) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found\n');
    }
    const body = existsSync(DATA) ? readFileSync(DATA, 'utf8') : '';
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end(body || 'пока пусто\n');
  }

  if (req.method !== 'POST' || url.pathname !== '/api/verdict') {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found\n');
  }

  if (tooOften(ip)) {
    res.writeHead(429, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Слишком часто', '<h1>Слишком часто</h1><p>Подождите десять секунд.</p>'));
  }

  let body = '';
  let over = false;
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > MAX_BODY) {
      over = true;
      req.destroy();
    }
  });
  req.on('end', () => {
    if (over) return;
    const form = new URLSearchParams(body);
    const takes = form.get('takes');
    if (!takes || !['yes', 'fixes', 'no'].includes(takes)) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(
        page(
          'Не хватает ответа',
          '<h1>Не хватает ответа</h1><p>Вернитесь и отметьте, берёте ли документ в работу.</p>',
        ),
      );
    }

    const cut = (s, n) => (s ?? '').toString().slice(0, n);
    appendFileSync(
      DATA,
      JSON.stringify({
        at: new Date().toISOString(),
        article: cut(form.get('article'), 80),
        takes,
        who: cut(form.get('who'), 200),
        name: cut(form.get('name'), 120),
        city: cut(form.get('city'), 80),
        contact: cut(form.get('contact'), 200),
        comment: cut(form.get('comment'), 4000),
        ip: cut(ip, 64),
      }) + '\n',
      'utf8',
    );

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      page(
        'Спасибо',
        '<h1>Записали</h1><p>Спасибо — это ровно тот ответ, ради которого документ ' +
          'и показывали. Если написали, чего не хватает, мы вернёмся с исправленной ' +
          'версией и покажем, что изменилось.</p><p><a href="javascript:history.back()">← назад к паку</a></p>',
      ),
    );
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`verdict collector on 127.0.0.1:${PORT} → ${DATA}`);
});
