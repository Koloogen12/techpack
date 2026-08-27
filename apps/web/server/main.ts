#!/usr/bin/env tsx
/**
 * Демо-сервер Seamsterly: инвайты, очередь генерации, живой документ.
 *
 *   PORT=8131 DATA_DIR=data pnpm demo:server
 *
 * Это срез для живых созвонов с фабриками и брендами (RAT-2 в реальном
 * времени), а не будущий продакшен. Отсюда три решения:
 *
 *  - Вход только по инвайт-ссылке. Регистрации нет вовсе: на созвоне человек
 *    не должен придумывать пароль, а публичный вход открыл бы генерацию
 *    (платную) любому, кто подберёт адрес.
 *  - Хранилище — файлы. Джоба это каталог: анкета, фото, спека, PDF, статус.
 *    Их можно открыть глазами и целиком забэкапить одним tar.
 *  - Очередь — одна, в памяти, по одной джобе за раз. Генерация ест CPU
 *    браузером и ходит в платные API; две параллельные на демо-сервере
 *    убили бы время ответа обеих.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { isSeamsterlyError } from '@seamsterly/core';
import { editMeasurement } from '@seamsterly/fit';
import { flatDefaults } from '@seamsterly/flats';
import { kb } from '@seamsterly/kb';
import { parseStyleSpec, type StyleSpec } from '@seamsterly/stylespec';
import { generate } from '../../cli/src/generate.js';
import { parseAnswers } from '../../cli/src/answers.js';
import { FREE_PER_MONTH, Limits } from './limits.js';
import { Notifications } from './notify.js';
import { Referrals, refCode } from './referrals.js';
import { tgDocument, tgNotify, tgTrace, telegramReady } from './telegram.js';
import { buildRfq } from './rfq.js';
import { findTemplate } from '@seamsterly/templates';
import {
  candidatesFor,
  readJobTemplate,
  renderJobTemplate,
  replaceJobTemplate,
  writeJobTemplate,
} from './templates.js';

const PORT = Number(process.env.PORT ?? 8131);
const DATA = process.env.DATA_DIR ?? 'data';
const ADMIN = process.env.ADMIN_TOKEN ?? '';
const MAX_PHOTO = 12 * 1024 * 1024;
/** Адрес, по которому кабинет виден снаружи — из него собираются ссылки. */
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? 'https://seamster.pro';
const MAX_PHOTOS = 6;

mkdirSync(join(DATA, 'jobs'), { recursive: true });

const limits = new Limits(join(DATA, 'limits'));
const notes = new Notifications(join(DATA, 'notifications'));
const referrals = new Referrals(join(DATA, 'referrals'));

// ---------------------------------------------------------------- инвайты

interface Invite {
  token: string;
  name: string;
  org: string;
  note?: string;
  /** Персональная месячная квота: фабрике-валидатору генерации не нужны. */
  limit?: number;
  /** Кто пригласил — код реферала. Проставляется при одобрении заявки. */
  ref?: string;
}

function monthlyOf(invite: Invite): number {
  return typeof invite.limit === 'number' && invite.limit >= 0 ? invite.limit : FREE_PER_MONTH;
}

function invites(): Invite[] {
  const path = join(DATA, 'invites.json');
  if (!existsSync(path)) return [];
  try {
    return (JSON.parse(readFileSync(path, 'utf8')) as { invites: Invite[] }).invites ?? [];
  } catch {
    return [];
  }
}

function inviteOf(req: IncomingMessage, url: URL): Invite | null {
  const token = url.searchParams.get('t') ?? String(req.headers['x-invite'] ?? '');
  if (!token) return null;
  return invites().find((i) => i.token === token) ?? null;
}

// ---------------------------------------------------------------- телеметрия

/**
 * Лог событий — это глаза созвона. После него надо уметь ответить,
 * где человек застрял, и «кажется, на анкете» ответом не является.
 */
function logEvent(who: string, type: string, payload: unknown): void {
  appendFileSync(
    join(DATA, 'events.jsonl'),
    JSON.stringify({ at: new Date().toISOString(), who, type, payload }) + '\n',
  );
  // В Телеграм уходит ВСЁ, но по-разному: важное — сразу, шум — дайджестом
  // раз в десять минут. Иначе авария утонет между переходами по разделам.
  const short = JSON.stringify(payload ?? '')
    .replace(/^"|"$/g, '')
    .slice(0, 120);
  tgTrace(who, short ? `${type} · ${short}` : type);
}

// ---------------------------------------------------------------- очередь

type Stage = 'queued' | 'vision' | 'assembly' | 'render' | 'docgen' | 'done' | 'error';

interface JobStatus {
  id: string;
  stage: Stage;
  /** Пройденные стадии с временем — фронт рисует настоящий прогресс. */
  history: { stage: Stage; at: string; detail?: string }[];
  error?: { message: string; action: string };
  notes?: string[];
  cost_ms?: number;
}

const statuses = new Map<string, JobStatus>();
const queue: string[] = [];
let running = false;

function jobDir(id: string): string {
  return join(DATA, 'jobs', id);
}

function setStage(id: string, stage: Stage, detail?: string): void {
  const s = statuses.get(id);
  if (!s) return;
  s.stage = stage;
  s.history.push({ stage, at: new Date().toISOString(), ...(detail ? { detail } : {}) });
  writeFileSync(join(jobDir(id), 'status.json'), JSON.stringify(s, null, 2));
}

/** Владелец джобы — по нему считается лимит и адресуются уведомления. */
function ownerOf(id: string): Invite | null {
  try {
    const token = readFileSync(join(jobDir(id), 'owner.txt'), 'utf8').trim();
    return invites().find((i) => i.token === token) ?? null;
  } catch {
    return null;
  }
}

async function pump(): Promise<void> {
  if (running) return;
  const id = queue.shift();
  if (!id) return;
  running = true;
  const started = Date.now();
  const owner = ownerOf(id);
  try {
    const dir = jobDir(id);
    const photos = (JSON.parse(readFileSync(join(dir, 'photos.json'), 'utf8')) as string[]).map(
      (f) => join(dir, f),
    );
    const result = await generate({
      answersPath: join(dir, 'answers.json'),
      photoPaths: photos,
      outPath: join(dir, 'pack.pdf'),
      roles: [],
      writeSpec: false,
      // Визуализация включена: на демо страница внешнего вида — вау-момент.
      // Если сервис лежит, документ соберётся без неё, это уже устроено.
      render: true,
      cacheDir: join(DATA, 'cache', 'vision'),
      renderCacheDir: join(DATA, 'cache', 'render'),
      onStage: (stage, detail) => setStage(id, stage, detail),
    });
    writeFileSync(join(dir, 'spec.json'), JSON.stringify(result.spec, null, 2));
    // Чем нарисован чертёж — рядом со спекой. Вопрос «почему тут другой
    // карман» задают чаще всего именно про силуэт, и ответ должен лежать
    // в джобе, а не выводиться заново при каждом показе.
    writeJobTemplate(dir, {
      id: result.template?.id ?? null,
      candidates: result.template?.candidates ?? [],
      chosen_by_user: false,
    });
    const s = statuses.get(id)!;
    s.notes = result.notes;
    s.cost_ms = Date.now() - started;
    setStage(id, 'done');

    // Списываем ТОЛЬКО здесь: пак собран, значит человек получил ценность.
    const sec = Math.round((Date.now() - started) / 1000);
    const assumptions = result.spec.meta.assumptions_count ?? 0;
    if (owner) {
      const view = limits.charge(owner.token, monthlyOf(owner));
      notes.push(owner.token, {
        title: `Техпак «${result.spec.style.name}» готов`,
        sub: `${sec} с · ${assumptions} ${assumptions === 1 ? 'предположение' : 'предположений'} к подтверждению`,
        tone: 'ok',
        job: id,
        section: 'cover',
      });
      tgNotify(`✅ Пак готов — ${owner.name}`, [
        `${result.spec.style.name} · ${result.spec.style.article}`,
        `${sec} с · предположений: ${assumptions}`,
        `Осталось генераций: ${view.left} (из ${view.limit} + ${view.credits} подарено)`,
      ]);
    }
  } catch (error) {
    console.error(`job ${id}:`, error);
    const s = statuses.get(id);
    if (s) {
      s.error = isSeamsterlyError(error)
        ? { message: error.userMessage, action: error.userAction }
        : { message: 'Генерация не получилась.', action: 'Повторите — лимит не списан.' };
      setStage(id, 'error');
      if (owner) {
        notes.push(owner.token, {
          title: 'Генерация не удалась',
          sub: `${s.error.message} Лимит не списан.`,
          tone: 'alert',
        });
      }
      // Сбой генерации — то, ради чего стоит поднять телефон: человек
      // сидит на созвоне и смотрит в экран прямо сейчас.
      tgNotify(`⛔️ Сбой генерации — ${owner?.name ?? 'неизвестный'}`, [
        s.error.message,
        String(error).slice(0, 300),
      ]);
    }
  } finally {
    running = false;
    void pump();
  }
}

// ---------------------------------------------------------------- утилиты http

function json(res: ServerResponse, code: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(s);
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
}

/**
 * Частотный предел для публичных ручек — единственная защита у форм,
 * которые открыты без инвайта. Капчу мы не ставим: она стоит человеку
 * больше, чем нам стоит спам, а объёмы здесь штучные.
 */
const publicHits = new Map<string, number[]>();

function tooOften(ip: string, perMinute = 3): boolean {
  const now = Date.now();
  const hits = (publicHits.get(ip) ?? []).filter((t) => now - t < 60_000);
  hits.push(now);
  publicHits.set(ip, hits);
  if (publicHits.size > 5000) publicHits.clear();
  return hits.length > perMinute;
}

function ipOf(req: IncomingMessage): string {
  const fwd = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')[0]
    ?.trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}

function safeStatus(id: string): JobStatus | null {
  try {
    return JSON.parse(readFileSync(join(jobDir(id), 'status.json'), 'utf8')) as JobStatus;
  } catch {
    return null;
  }
}

function specOf(id: string): StyleSpec | null {
  const path = join(jobDir(id), 'spec.json');
  if (!existsSync(path)) return null;
  return parseStyleSpec(JSON.parse(readFileSync(path, 'utf8')));
}

/** Спека + величины чертежа, которых нет в табеле. Один ответ — один рендер. */
function specPayload(spec: StyleSpec): unknown {
  return { spec, flat_defaults: flatDefaults(spec, kb()) };
}

// ---------------------------------------------------------------- сервер

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const invite = inviteOf(req, url);

  try {
    if (url.pathname === '/app/api/health') return json(res, 200, { ok: true });

    // --- Админка созвонов: события по валидаторам + заметки о звонке --------
    // По токену, не по инвайту: это внутренняя страница Данила.
    if (url.pathname === '/app/api/admin' && ADMIN && url.searchParams.get('k') === ADMIN) {
      if (req.method === 'POST') {
        const body = await readBody(req, 16 * 1024);
        if (body) {
          const form = new URLSearchParams(body.toString('utf8'));
          appendFileSync(
            join(DATA, 'call-notes.jsonl'),
            JSON.stringify({
              at: new Date().toISOString(),
              who: (form.get('who') ?? '').slice(0, 200),
              note: (form.get('note') ?? '').slice(0, 4000),
            }) + '\n',
          );
        }
        res.writeHead(303, { location: `/app/api/admin?k=${ADMIN}` });
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(adminPage());
    }

    // Статика кабинета: локальная разработка без nginx. В проде эти же файлы
    // отдаёт nginx, сюда запросы не доходят.
    if (
      req.method === 'GET' &&
      url.pathname.startsWith('/app') &&
      !url.pathname.startsWith('/app/api') &&
      !url.pathname.includes('..')
    ) {
      const root = process.env.WEB_DIST ?? 'dist';
      const rel = url.pathname.replace(/^\/app\/?/, '') || 'index.html';
      const file = join(root, rel);
      if (existsSync(file)) {
        const ext = file.split('.').pop() ?? '';
        const types: Record<string, string> = {
          html: 'text/html; charset=utf-8',
          js: 'text/javascript; charset=utf-8',
          css: 'text/css',
          svg: 'image/svg+xml',
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          webp: 'image/webp',
          woff2: 'font/woff2',
        };
        res.writeHead(200, { 'content-type': types[ext] ?? 'application/octet-stream' });
        return res.end(readFileSync(file));
      }
      if (rel === 'index.html' || !rel.includes('.')) {
        const idx = join(root, 'index.html');
        if (existsSync(idx)) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          return res.end(readFileSync(idx));
        }
      }
    }

    // Самопроверка телеграм-канала: бот не может написать первым, пока
    // человек не нажал Start. Эта ручка отвечает, дошло ли сообщение.
    if (url.pathname === '/app/api/admin/tg-test' && ADMIN && url.searchParams.get('k') === ADMIN) {
      const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
      const chat = process.env.TELEGRAM_ADMIN_ID ?? '';
      if (!token || !chat) return json(res, 200, { ok: false, why: 'токен или chat_id не заданы' });
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chat,
          text: 'Проверка связи — канал Seamsterly работает.',
        }),
      });
      const body = (await r.json()) as { ok?: boolean; description?: string };
      return json(res, 200, {
        ok: Boolean(body.ok),
        why: body.ok
          ? 'доставлено'
          : `${body.description ?? 'сбой'} — откройте бота в Телеграме и нажмите Start`,
      });
    }

    // Документ по фабричной ссылке: read-only HTML без аккаунта и инвайта.
    // Токен ссылки — отдельный от инвайта, знание токена и есть доступ.
    const shareMatch = url.pathname.match(/^\/p\/([a-f0-9]{16})$/);
    if (req.method === 'GET' && shareMatch) {
      const tok = shareMatch[1]!;
      const { readdirSync } = await import('node:fs');
      const id = readdirSync(join(DATA, 'jobs'), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .find((jid) => {
          try {
            return (
              readFileSync(join(jobDir(jid), 'share.txt'), 'utf8').trim() === tok &&
              !existsSync(join(jobDir(jid), 'deleted.flag'))
            );
          } catch {
            return false;
          }
        });
      const spec = id ? specOf(id) : null;
      if (!spec) return json(res, 404, { error: 'нет такого документа' });
      const { renderHtml } = await import('@seamsterly/docgen');
      logEvent('фабрика', 'share_open', { id });
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'x-robots-tag': 'noindex, nofollow',
      });
      return res.end(renderHtml(spec, { pro: true }));
    }

    // Вопрос от фабрики по строке документа. Раньше он оставался внутри
    // read-only страницы и не долетал никуда — теперь доходит и до бренда,
    // и до нас: фабрика на созвоне обязана видеть, что её услышали.
    const askMatch = url.pathname.match(/^\/p\/([a-f0-9]{16})\/question$/);
    if (req.method === 'POST' && askMatch) {
      if (tooOften(ipOf(req))) return json(res, 429, { error: 'слишком часто' });
      const body = await readBody(req, 4096);
      if (!body) return json(res, 413, { error: 'слишком большой запрос' });
      const { code, text } = JSON.parse(body.toString('utf8')) as { code?: string; text?: string };
      const { readdirSync } = await import('node:fs');
      const jid = readdirSync(join(DATA, 'jobs'), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .find((x) => {
          try {
            return readFileSync(join(jobDir(x), 'share.txt'), 'utf8').trim() === askMatch[1];
          } catch {
            return false;
          }
        });
      if (!jid) return json(res, 404, { error: 'нет такого документа' });
      const owner = ownerOf(jid);
      const spec = specOf(jid);
      const row = String(code ?? '').slice(0, 8);
      const question = String(text ?? '').slice(0, 500);
      if (owner) {
        notes.push(owner.token, {
          title: `Вопрос от фабрики${row ? ` по точке ${row}` : ''}`,
          sub: question || 'Уточнение по документу',
          tone: 'alert',
          job: jid,
          section: 'pom',
        });
      }
      logEvent('фабрика', 'question', { id: jid, code: row });
      tgNotify('❓ Вопрос от фабрики', [
        `Пак: ${spec?.style.name ?? jid} · ${spec?.style.article ?? ''}`,
        `Бренд: ${owner?.name ?? '—'}`,
        row ? `Точка: ${row}` : '',
        question,
      ]);
      return json(res, 200, { ok: true });
    }

    // Заявка по реферальной ссылке: публичная, потому что у пришедшего
    // друга ещё нет инвайта — в этом весь смысл приглашения.
    if (req.method === 'POST' && url.pathname === '/app/api/referral/claim') {
      if (tooOften(ipOf(req))) return json(res, 429, { error: 'слишком часто' });
      const body = await readBody(req, 4096);
      if (!body) return json(res, 413, { error: 'слишком большой запрос' });
      const raw = JSON.parse(body.toString('utf8')) as {
        ref?: string;
        name?: string;
        contact?: string;
        note?: string;
      };
      const ref = String(raw.ref ?? '').slice(0, 16);
      const name = String(raw.name ?? '')
        .trim()
        .slice(0, 120);
      const contact = String(raw.contact ?? '')
        .trim()
        .slice(0, 160);
      if (!name || !contact) return json(res, 400, { error: 'нужны имя и контакт' });
      const inviter = invites().find((i) => refCode(i.token) === ref) ?? null;
      const claim = referrals.add({
        ref,
        name,
        contact,
        note: String(raw.note ?? '').slice(0, 300),
      });
      logEvent('гость', 'referral_claim', { ref, name });
      tgNotify('🎟 Заявка на доступ', [
        `Имя: ${name}`,
        `Контакт: ${contact}`,
        claim.note ? `О себе: ${claim.note}` : '',
        inviter ? `Пригласил: ${inviter.name} (${inviter.org})` : 'Без реферала',
        ADMIN
          ? `Одобрить: ${PUBLIC_ORIGIN}/app/api/admin/approve?k=${ADMIN}&claim=${claim.id}`
          : '',
      ]);
      return json(res, 200, { ok: true });
    }

    // Одобрение заявки одной ссылкой из Телеграма: заводит инвайт и
    // начисляет пригласившему обещанную генерацию.
    if (url.pathname === '/app/api/admin/approve' && ADMIN && url.searchParams.get('k') === ADMIN) {
      const claimId = String(url.searchParams.get('claim') ?? '');
      const claim = referrals.all().find((c) => c.id === claimId);
      if (!claim) return json(res, 404, { error: 'нет такой заявки' });
      if (claim.approved) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(
          `<meta charset="utf-8"><p>Заявка уже одобрена. Ссылка: ${PUBLIC_ORIGIN}/app/?t=${claim.approved}</p>`,
        );
      }
      const token = randomBytes(10).toString('hex');
      const list = invites();
      list.push({ token, name: claim.name, org: claim.contact, ref: claim.ref });
      writeFileSync(join(DATA, 'invites.json'), JSON.stringify({ invites: list }, null, 2));
      referrals.approve(claim.id, token);
      const inviter = invites().find((i) => refCode(i.token) === claim.ref);
      if (inviter) {
        const view = limits.grant(inviter.token, 1);
        notes.push(inviter.token, {
          title: `Новый участник по вашей ссылке: ${claim.name}`,
          sub: `Начислена генерация · доступно ${view.left}`,
          tone: 'ok',
        });
      }
      const link = `${PUBLIC_ORIGIN}/app/?t=${token}`;
      tgNotify('✅ Заявка одобрена', [
        `${claim.name} · ${claim.contact}`,
        `Ссылка: ${link}`,
        inviter ? `+1 генерация: ${inviter.name}` : '',
      ]);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(`<meta charset="utf-8"><p>Готово. Ссылка для ${claim.name}:<br>${link}</p>`);
    }

    // Всё остальное — только по инвайту.
    if (!invite) {
      return json(res, 401, {
        error: 'нужна инвайт-ссылка',
        action: 'откройте адрес, который вам прислали, целиком',
      });
    }

    // Превью силуэта библиотеки. Отдаётся по идентификатору из манифеста, а
    // не по пути: путь из запроса открыл бы дорогу к любому файлу на диске.
    if (req.method === 'GET' && url.pathname === '/app/api/template-preview') {
      const wanted = url.searchParams.get('id') ?? '';
      const entry = findTemplate(wanted);
      if (!entry?.preview || !existsSync(entry.preview)) {
        return json(res, 404, { error: 'превью нет' });
      }
      res.writeHead(200, {
        'content-type': 'image/png',
        // Превью неизменно: оно сделано из исходника датасета один раз.
        'cache-control': 'public, max-age=86400, immutable',
      });
      return res.end(readFileSync(entry.preview));
    }

    if (req.method === 'GET' && url.pathname === '/app/api/me') {
      logEvent(invite.name, 'open', { org: invite.org });
      return json(res, 200, {
        name: invite.name,
        org: invite.org,
        limits: limits.view(invite.token, monthlyOf(invite)),
        unread: notes.unread(invite.token),
        ref: refCode(invite.token),
      });
    }

    // Уведомления бренду: живут файлом, поэтому переживают рестарт и
    // возвращение человека через сутки.
    if (url.pathname === '/app/api/notifications') {
      if (req.method === 'GET') {
        return json(res, 200, {
          items: notes.list(invite.token),
          unread: notes.unread(invite.token),
        });
      }
      if (req.method === 'POST') {
        notes.markRead(invite.token);
        return json(res, 200, { ok: true });
      }
    }

    // Реферальная программа: код, ссылка и статистика приглашённых.
    if (req.method === 'GET' && url.pathname === '/app/api/referral') {
      const code = refCode(invite.token);
      const claims = referrals.byRef(code);
      return json(res, 200, {
        code,
        invited: claims.length,
        joined: claims.filter((c) => c.approved).length,
        credits: limits.view(invite.token, monthlyOf(invite)).credits,
      });
    }

    // Лист ожидания платного тарифа. Цены и обещания — решение СЕО,
    // поэтому здесь не оплата, а заявка: она уходит ему в Телеграм.
    if (req.method === 'POST' && url.pathname === '/app/api/waitlist') {
      const body = await readBody(req, 4096);
      const plan = body
        ? String((JSON.parse(body.toString('utf8')) as { plan?: string }).plan ?? '')
        : '';
      logEvent(invite.name, 'waitlist', { plan });
      tgNotify('⭐️ Заявка на тариф', [
        `${invite.name} · ${invite.org}`,
        `Тариф: ${plan.slice(0, 60) || 'Студия'}`,
      ]);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/app/api/jobs') {
      const { readdirSync } = await import('node:fs');
      const list = readdirSync(join(DATA, 'jobs'), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .filter((id) => {
          try {
            return (
              readFileSync(join(jobDir(id), 'owner.txt'), 'utf8') === invite.token &&
              !existsSync(join(jobDir(id), 'deleted.flag'))
            );
          } catch {
            return false;
          }
        })
        .map((id) => {
          const status = statuses.get(id) ?? safeStatus(id);
          let name = '';
          let article = '';
          let category = '';
          const spec = specOf(id);
          if (spec) {
            name = spec.style.name;
            article = spec.style.article;
            category = spec.style.category;
          } else {
            try {
              const a = JSON.parse(readFileSync(join(jobDir(id), 'answers.json'), 'utf8')) as {
                name?: string;
                article?: string;
                category?: string;
              };
              name = a.name ?? '';
              article = a.article ?? '';
              category = a.category ?? '';
            } catch {
              /* каталог без анкеты — не показываем */
            }
          }
          return {
            id,
            name,
            article,
            category,
            stage: status?.stage ?? 'queued',
            created_at: status?.history[0]?.at ?? null,
            assumptions: spec?.meta.assumptions_count ?? null,
          };
        })
        .filter((j) => j.name)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      return json(res, 200, { jobs: list });
    }

    if (req.method === 'POST' && url.pathname === '/app/api/jobs') {
      // Квота проверяется до создания джобы: отказать на входе честнее,
      // чем дать собрать анкету и упереться в лимит на кнопке «Запустить».
      const gate = limits.check(invite.token, running || queue.length ? 1 : 0, monthlyOf(invite));
      if (!gate.ok) {
        logEvent(invite.name, 'limit_blocked', { reason: gate.error });
        return json(res, 402, { error: gate.error, action: gate.action });
      }
      const body = await readBody(req, 64 * 1024);
      if (!body) return json(res, 413, { error: 'анкета слишком большая' });
      let answers;
      try {
        answers = parseAnswers(JSON.parse(body.toString('utf8')));
      } catch (e) {
        return json(res, 400, {
          error: isSeamsterlyError(e) ? e.userMessage : 'анкета не разобралась',
          detail: isSeamsterlyError(e) ? e.userAction : String(e),
        });
      }
      const id = randomBytes(8).toString('hex');
      mkdirSync(jobDir(id), { recursive: true });
      // Юрданные из библиотеки бренда каскадом уходят в ярлыки.
      let enriched = body.toString('utf8');
      const profilePath = join(DATA, 'profiles', `${invite.token}.json`);
      if (existsSync(profilePath)) {
        try {
          const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as {
            legal?: { company?: string; inn?: string; address?: string };
          };
          const parsed = JSON.parse(enriched) as Record<string, unknown>;
          if (profile.legal?.company && !parsed.brand_profile) {
            parsed.brand_profile = {
              company_name: profile.legal.company,
              ...(profile.legal.inn ? { inn: profile.legal.inn } : {}),
              ...(profile.legal.address ? { address: profile.legal.address } : {}),
            };
            if (!parsed.brand) parsed.brand = profile.legal.company;
          }
          enriched = JSON.stringify(parsed);
        } catch {
          /* профиль битый — анкета как есть */
        }
      }
      writeFileSync(join(jobDir(id), 'answers.json'), enriched);
      writeFileSync(join(jobDir(id), 'photos.json'), '[]');
      writeFileSync(join(jobDir(id), 'owner.txt'), invite.token);
      statuses.set(id, { id, stage: 'queued', history: [] });
      logEvent(invite.name, 'job_created', { id, category: answers.category });
      return json(res, 200, { id });
    }

    const jobMatch = url.pathname.match(/^\/app\/api\/jobs\/([a-f0-9]{16})(\/.*)?$/);
    if (jobMatch) {
      const id = jobMatch[1]!;
      const rest = jobMatch[2] ?? '';
      const dir = jobDir(id);
      if (!existsSync(dir)) return json(res, 404, { error: 'нет такой генерации' });
      // Чужие джобы не видны даже с валидным инвайтом: на демо ходят
      // конкурирующие фабрики, и показывать им паки друг друга нельзя.
      if (
        readFileSync(join(dir, 'owner.txt'), 'utf8') !== invite.token &&
        !url.searchParams.get('k')
      ) {
        return json(res, 404, { error: 'нет такой генерации' });
      }

      if (req.method === 'POST' && rest === '/photos') {
        const listPath = join(dir, 'photos.json');
        const list = JSON.parse(readFileSync(listPath, 'utf8')) as string[];
        if (list.length >= MAX_PHOTOS)
          return json(res, 400, { error: `не больше ${MAX_PHOTOS} фото` });
        const body = await readBody(req, MAX_PHOTO);
        if (!body || body.length === 0)
          return json(res, 413, { error: 'файл больше 12 МБ или пуст' });
        const mime = String(req.headers['content-type'] ?? '');
        const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
        // Ракурс объявляется клиентом и попадает в имя — parsePhotoArg
        // в генераторе прочитает его оттуда.
        const view = /^[a-z_]{2,20}$/.test(url.searchParams.get('view') ?? '')
          ? url.searchParams.get('view')
          : null;
        const name = `photo-${list.length + 1}${view ? `-${view}` : ''}.${ext}`;
        writeFileSync(join(dir, name), body);
        list.push(name);
        writeFileSync(listPath, JSON.stringify(list));
        return json(res, 200, { count: list.length });
      }

      if (req.method === 'POST' && rest === '/start') {
        // Вторая проверка не дублирует первую: между созданием джобы и
        // стартом человек мог открыть вкладку второй раз или добить квоту.
        const gate = limits.check(invite.token, running || queue.length ? 1 : 0, monthlyOf(invite));
        if (!gate.ok) {
          logEvent(invite.name, 'limit_blocked', { id, reason: gate.error });
          return json(res, 402, { error: gate.error, action: gate.action });
        }
        if (!queue.includes(id) && statuses.get(id)?.stage === 'queued') {
          queue.push(id);
          limits.noteStart(invite.token);
          void pump();
        }
        logEvent(invite.name, 'job_started', { id });
        let what = '';
        try {
          const a = JSON.parse(readFileSync(join(dir, 'answers.json'), 'utf8')) as {
            name?: string;
            category?: string;
          };
          what = `${a.name ?? ''} · ${a.category ?? ''}`;
        } catch {
          /* анкета нечитаема — сообщение всё равно уходит */
        }
        const photos = (JSON.parse(readFileSync(join(dir, 'photos.json'), 'utf8')) as string[])
          .length;
        tgNotify(`▶️ Запущена генерация — ${invite.name}`, [
          `${invite.org}`,
          what,
          `Фотографий: ${photos}`,
        ]);
        return json(res, 200, { ok: true });
      }

      // Отправка на просчёт: пак уходит в админский Телеграм документом,
      // человеку показывается подтверждение. Фабрики подключены вручную —
      // консьерж-этап, и притворяться автоматикой мы не будем.
      if (req.method === 'POST' && rest === '/quote') {
        const spec = specOf(id);
        if (!spec) return json(res, 404, { error: 'спека ещё не готова' });
        const body = await readBody(req, 4096);
        const comment = body
          ? String((JSON.parse(body.toString('utf8')) as { comment?: string }).comment ?? '').slice(
              0,
              500,
            )
          : '';
        // Ссылка на полный пак вместо вложения на двадцать страниц.
        // Просчитывают по листу, а пак открывают, когда берутся за заказ.
        const sharePath = join(dir, 'share.txt');
        let shareToken: string;
        if (existsSync(sharePath)) shareToken = readFileSync(sharePath, 'utf8').trim();
        else {
          shareToken = randomBytes(8).toString('hex');
          writeFileSync(sharePath, shareToken);
        }
        const packLink = `${PUBLIC_ORIGIN}/p/${shareToken}`;

        const rfq = await buildRfq(
          dir,
          spec,
          { name: invite.name, org: invite.org },
          // Китайский лист собирается сразу: фабрики, ради которых он и
          // задуман, русского не читают, а собирать его отдельной командой
          // значит однажды отправить не тот.
          { dataDir: DATA, token: invite.token, packLink, locales: ['zh'] },
        );

        const points = spec.measurements.points.length;
        const assumptions = spec.meta.assumptions_count ?? 0;
        await tgDocument(
          rfq.path,
          `${spec.style.article}-просчёт.pdf`,
          [
            '<b>📩 Запрос на просчёт</b>',
            `Бренд: ${invite.name} · ${invite.org}`,
            `Изделие: ${spec.style.name} · ${spec.style.article}`,
            `Замеров: ${points} · предположений: ${assumptions}`,
            comment ? `Комментарий бренда: ${comment}` : '',
            rfq.gaps.length ? `⚠️ ${rfq.gaps.join('; ')}` : '',
            `Полный техпак: ${packLink}`,
            '',
            '<b>Текст для фабрики — скопировать и отправить:</b>',
            `<code>${rfq.text}</code>`,
          ]
            .filter((line) => line !== '')
            .join('\n'),
        );

        // Тот же лист на китайском — вторым файлом. Админ пересылает его
        // китайской фабрике без единой лишней команды.
        for (const l of rfq.localized) {
          await tgDocument(
            l.path,
            `${spec.style.article}-rfq-${l.locale}.pdf`,
            [`<b>Тот же лист · ${l.locale}</b>`, `<code>${l.text}</code>`].join('\n'),
          );
        }

        writeFileSync(
          join(dir, 'quote.json'),
          JSON.stringify(
            { at: new Date().toISOString(), by: invite.name, comment, gaps: rfq.gaps },
            null,
            2,
          ),
        );
        notes.push(invite.token, {
          title: `«${spec.style.name}» отправлен на просчёт`,
          // О пробелах говорим бренду сразу, а не после молчания фабрик:
          // лист ушёл, но без обратного адреса ответить на него нельзя.
          sub: rfq.gaps.length
            ? `Лист ушёл, но ${rfq.gaps[0]}`
            : 'Вернёмся с ценами от фабрик в течение 24 часов',
          tone: rfq.gaps.length ? 'alert' : 'ok',
          job: id,
          section: 'export',
        });
        logEvent(invite.name, 'quote_sent', { id, article: spec.style.article });
        return json(res, 200, { ok: true, gaps: rfq.gaps });
      }

      if (req.method === 'GET' && rest === '/status') {
        const s = statuses.get(id) ?? JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8'));
        return json(res, 200, s);
      }

      if (req.method === 'GET' && rest === '/spec') {
        const spec = specOf(id);
        if (!spec) return json(res, 404, { error: 'спека ещё не готова' });
        return json(res, 200, specPayload(spec));
      }

      if (req.method === 'PATCH' && rest === '/measurements') {
        const body = await readBody(req, 4096);
        if (!body) return json(res, 413, { error: 'слишком большой запрос' });
        const { code, value_cm } = JSON.parse(body.toString('utf8')) as {
          code: string;
          value_cm: number;
        };
        const spec = specOf(id);
        if (!spec) return json(res, 404, { error: 'спека ещё не готова' });
        const result = editMeasurement(spec, code, value_cm);
        if (result.rejected) {
          logEvent(invite.name, 'edit_rejected', { id, code, reason: result.rejected });
          return json(res, 422, { error: result.rejected });
        }
        writeFileSync(join(dir, 'spec.json'), JSON.stringify(result.spec, null, 2));
        // PDF устарел: следующая выгрузка пересоберёт его из новой спеки.
        writeFileSync(join(dir, 'pdf-stale.flag'), '1');
        logEvent(invite.name, 'edit', { id, code, changed: result.changed });
        return json(res, 200, { ...(specPayload(result.spec) as object), changed: result.changed });
      }

      // Детали пака: бренд, название, сезон, описание. До сборки — в анкету,
      // после — прямо в спеку: эти поля не участвуют в геометрии.
      if (req.method === 'PATCH' && rest === '/meta') {
        const body = await readBody(req, 8 * 1024);
        if (!body) return json(res, 413, { error: 'слишком большой запрос' });
        const patch = JSON.parse(body.toString('utf8')) as {
          name?: string;
          brand?: string;
          season?: string;
          description?: string;
        };
        const cut = (x: unknown, n: number): string | undefined =>
          typeof x === 'string' && x.trim() ? x.trim().slice(0, n) : undefined;
        const clean = {
          name: cut(patch.name, 120),
          brand: cut(patch.brand, 120),
          season: cut(patch.season, 60),
          description: cut(patch.description, 1000),
        };
        const spec = specOf(id);
        if (spec) {
          const next = {
            ...spec,
            style: {
              ...spec.style,
              ...(clean.name ? { name: clean.name } : {}),
              ...(clean.brand ? { brand: clean.brand } : {}),
              ...(clean.season ? { season: clean.season } : {}),
              ...(clean.description ? { description: clean.description } : {}),
            },
          };
          writeFileSync(join(dir, 'spec.json'), JSON.stringify(next, null, 2));
          writeFileSync(join(dir, 'pdf-stale.flag'), '1');
        }
        try {
          const answers = JSON.parse(readFileSync(join(dir, 'answers.json'), 'utf8')) as Record<
            string,
            unknown
          >;
          writeFileSync(
            join(dir, 'answers.json'),
            JSON.stringify({ ...answers, ...JSON.parse(JSON.stringify(clean)) }),
          );
        } catch {
          /* анкета неизменна */
        }
        logEvent(invite.name, 'meta', {
          id,
          fields: Object.keys(clean).filter((k) => clean[k as keyof typeof clean]),
        });
        return json(res, 200, { ok: true });
      }

      // Дублировать пак / взять за основу: новая джоба с той же анкетой.
      if (req.method === 'POST' && rest === '/duplicate') {
        const answers = readFileSync(join(dir, 'answers.json'), 'utf8');
        const copy = randomBytes(8).toString('hex');
        mkdirSync(jobDir(copy), { recursive: true });
        const parsed = JSON.parse(answers) as Record<string, unknown>;
        parsed.id = `demo-${Date.now()}`;
        parsed.article = `DEMO-${String(Date.now()).slice(-6)}`;
        writeFileSync(join(jobDir(copy), 'answers.json'), JSON.stringify(parsed));
        writeFileSync(join(jobDir(copy), 'photos.json'), '[]');
        writeFileSync(join(jobDir(copy), 'owner.txt'), invite.token);
        statuses.set(copy, { id: copy, stage: 'queued', history: [] });
        logEvent(invite.name, 'duplicate', { from: id, to: copy });
        return json(res, 200, { id: copy });
      }

      // Удаление недеструктивное: флаг, а не rm. Вердикт «удалил и пожалел»
      // на демо должен быть обратим руками.
      if (req.method === 'DELETE' && rest === '') {
        writeFileSync(join(dir, 'deleted.flag'), '1');
        logEvent(invite.name, 'delete', { id });
        return json(res, 200, { ok: true });
      }

      // Фото джобы: референсы в галерее кабинета. Отдаётся только владельцу —
      // проверка owner.txt уже прошла выше.
      const photoMatch = rest.match(/^\/photo\/(\d{1,2})$/);
      if (req.method === 'GET' && photoMatch) {
        const list = JSON.parse(readFileSync(join(dir, 'photos.json'), 'utf8')) as string[];
        const name = list[Number(photoMatch[1]) - 1];
        if (!name) return json(res, 404, { error: 'нет такого фото' });
        const ext = name.split('.').pop() ?? 'jpg';
        res.writeHead(200, {
          'content-type':
            ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg',
          'cache-control': 'private, max-age=86400',
        });
        return res.end(readFileSync(join(dir, name)));
      }

      // HTML-предпросмотр документа: превью первой страницы в экспорте
      // и read-only «ссылка для фабрики». Тот же renderHtml, что печатает PDF.
      if (req.method === 'GET' && rest === '/preview') {
        const spec = specOf(id);
        if (!spec) return json(res, 404, { error: 'спека ещё не готова' });
        const { renderHtml } = await import('@seamsterly/docgen');
        const locale = (['ru', 'en', 'zh'] as const).find(
          (l) => l === url.searchParams.get('locale'),
        );
        const html = renderHtml(spec, { pro: true, ...(locale ? { locale } : {}) });
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(html);
      }

      // Ссылка для фабрики: отдельный токен, живёт в каталоге джобы.
      // Идемпотентно — повторный запрос возвращает тот же токен.
      if (req.method === 'POST' && rest === '/share') {
        const path = join(dir, 'share.txt');
        let token: string;
        if (existsSync(path)) token = readFileSync(path, 'utf8').trim();
        else {
          token = randomBytes(8).toString('hex');
          writeFileSync(path, token);
          logEvent(invite.name, 'share_created', { id });
        }
        return json(res, 200, { token });
      }

      // Силуэт чертежа: чем нарисован и чем заменить.
      //
      // Подбор автоматический, но последнее слово за человеком: он видит
      // изделие, а мы — только признаки, снятые с фотографии.
      if (req.method === 'GET' && rest === '/template') {
        const spec = specOf(id);
        if (!spec) return json(res, 404, { error: 'спека ещё не готова' });
        const current = readJobTemplate(dir);
        // Кандидатов пересчитываем, если их не сохранили при генерации:
        // старые джобы собирались до появления библиотеки.
        const candidates = current.candidates.length ? current.candidates : candidatesFor(spec);
        return json(res, 200, { ...current, candidates });
      }

      if (req.method === 'POST' && rest === '/template') {
        const body = await readBody(req, 4 * 1024);
        if (!body) return json(res, 413, { error: 'слишком большой запрос' });
        const { template_id } = JSON.parse(body.toString('utf8')) as { template_id?: string };
        if (!template_id) return json(res, 400, { error: 'не указан силуэт' });
        const spec = specOf(id);
        if (!spec) return json(res, 404, { error: 'спека ещё не готова' });

        const next = replaceJobTemplate(dir, spec, template_id);
        if (!next) {
          return json(res, 422, {
            error: 'этот силуэт не подходит под табель мер — пропорции корпуса расходятся',
          });
        }
        // PDF устарел: следующая выгрузка пересоберётся уже с новым силуэтом.
        writeFileSync(join(dir, 'pdf-stale.flag'), '1');
        logEvent(invite.name, 'template_replaced', { id, template_id });
        return json(res, 200, next);
      }

      // Готовый вид чертежа из библиотеки. Строится геометрией, без браузера,
      // поэтому его не жалко пересобирать на каждый показ.
      if (req.method === 'GET' && rest === '/flat') {
        const spec = specOf(id);
        if (!spec) return json(res, 404, { error: 'спека ещё не готова' });
        const current = readJobTemplate(dir);
        if (!current.id) return json(res, 404, { error: 'чертёж построен параметрически' });
        const rendered = renderJobTemplate(spec, current.id);
        if (!rendered) return json(res, 404, { error: 'силуэт не подошёл под табель мер' });
        const view = url.searchParams.get('view') === 'back' ? 'back' : 'front';
        const svg = view === 'back' ? rendered.back?.svg : rendered.front.svg;
        if (!svg) return json(res, 404, { error: 'вида нет у этого силуэта' });
        res.writeHead(200, {
          'content-type': 'image/svg+xml; charset=utf-8',
          'cache-control': 'no-store',
        });
        return res.end(svg);
      }

      // Лист на просчёт — тот же файл, что ушёл фабрике. Бренд обязан видеть,
      // что именно отправлено от его имени.
      // Табель мер таблицей. Фабрика считает по нему расход и сверяет ОТК —
      // всё это делают в Excel, а не в PDF: из PDF цифры перебивают руками,
      // и там появляются опечатки, которые выглядят как брак пошива.
      if (req.method === 'GET' && rest === '/pom.csv') {
        const spec = specOf(id);
        if (!spec) return json(res, 404, { error: 'спека ещё не готова' });
        const csvLocale = (['en', 'zh'] as const).find((l) => l === url.searchParams.get('locale'));
        const { pomCsv } = await import('@seamsterly/docgen');
        logEvent(invite.name, 'pom_csv', { id, ...(csvLocale ? { locale: csvLocale } : {}) });
        res.writeHead(200, {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition':
            `attachment; filename="${spec.style.article}-pom` +
            `${csvLocale ? `-${csvLocale}` : ''}.csv"`,
        });
        return res.end(pomCsv(spec, csvLocale ?? 'ru'));
      }

      if (req.method === 'GET' && rest === '/rfq') {
        // Язык листа: тот же выбор, что у техпака. Фабрике отправляют один
        // файл, и чужой язык в нём только мешает.
        const rfqLocale = (['en', 'zh'] as const).find((l) => l === url.searchParams.get('locale'));
        const spec = specOf(id);
        if (!spec) return json(res, 404, { error: 'спека ещё не готова' });
        const path = join(dir, rfqLocale ? `rfq-${rfqLocale}.pdf` : 'rfq.pdf');
        const { statSync } = await import('node:fs');
        const fresh =
          existsSync(path) &&
          statSync(path).mtimeMs >= statSync(join(dir, 'spec.json')).mtimeMs &&
          (!existsSync(join(dir, 'template.json')) ||
            statSync(path).mtimeMs >= statSync(join(dir, 'template.json')).mtimeMs);
        if (!fresh) {
          const sharePath = join(dir, 'share.txt');
          const link = existsSync(sharePath)
            ? `${PUBLIC_ORIGIN}/p/${readFileSync(sharePath, 'utf8').trim()}`
            : undefined;
          await buildRfq(
            dir,
            spec,
            { name: invite.name, org: invite.org },
            {
              dataDir: DATA,
              token: invite.token,
              packLink: link,
              ...(rfqLocale ? { locales: [rfqLocale] } : {}),
            },
          );
        }
        logEvent(invite.name, 'rfq', { id, ...(rfqLocale ? { locale: rfqLocale } : {}) });
        res.writeHead(200, {
          'content-type': 'application/pdf',
          'content-disposition':
            `attachment; filename="${spec.style.article}-rfq` +
            `${rfqLocale ? `-${rfqLocale}` : ''}.pdf"`,
        });
        return res.end(readFileSync(path));
      }

      if (req.method === 'GET' && rest === '/pdf') {
        const spec = specOf(id);
        if (!spec) return json(res, 404, { error: 'спека ещё не готова' });
        const locale = (['en', 'zh'] as const).find((l) => l === url.searchParams.get('locale'));
        const role = (['technologist', 'cutter', 'qc', 'supply'] as const).find(
          (r) => r === url.searchParams.get('role'),
        );
        const variant = `${role ?? 'full'}-${locale ?? 'ru'}`;
        const pdfPath = join(dir, variant === 'full-ru' ? 'pack.pdf' : `pack-${variant}.pdf`);
        // Свежесть — по времени спеки И силуэта: вариантов несколько, а
        // правка замера или замена силуэта обязаны устаревить их все разом.
        const { statSync } = await import('node:fs');
        const mtime = (name: string): number =>
          existsSync(join(dir, name)) ? statSync(join(dir, name)).mtimeMs : 0;
        const sourceM = Math.max(mtime('spec.json'), mtime('template.json'));
        if (!existsSync(pdfPath) || statSync(pdfPath).mtimeMs < sourceM) {
          const { renderPdf, roleProfile } = await import('@seamsterly/docgen');
          const profile = role ? roleProfile(role) : null;
          // Силуэт библиотеки пересобирается здесь же: это чистая геометрия,
          // браузер для неё не нужен, а без него лист чертежа вернулся бы к
          // параметрическому виду — и выгрузка разошлась бы с экраном.
          const chosen = readJobTemplate(dir);
          const library = chosen.id ? renderJobTemplate(spec, chosen.id, locale ?? 'ru') : null;
          writeFileSync(
            pdfPath,
            await renderPdf(spec, {
              ...(profile
                ? { sections: profile.sections, pro: profile.pro, roleLabel: profile.label_ru }
                : { pro: true }),
              ...(locale ? { locale } : {}),
              // Набор видов строится на язык выгрузки: плашка вшита в SVG,
              // и русская оговорка в китайском комплекте бесполезна.
              ...(library ? { visuals: { libraryFlats: { [locale ?? 'ru']: library } } } : {}),
            }),
          );
        }
        logEvent(invite.name, 'pdf', {
          id,
          ...(role ? { role } : {}),
          ...(locale ? { locale } : {}),
        });
        res.writeHead(200, {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${spec.style.article}${role ? `-${role}` : ''}${locale ? `-${locale}` : ''}.pdf"`,
        });
        return res.end(readFileSync(pdfPath));
      }
    }

    // Библиотека бренда: юрданные и материалы. Хранится на инвайт и
    // ПОДМЕШИВАЕТСЯ В АНКЕТУ следующей генерации: заполнил юрданные —
    // ярлыки перестали быть пробелами. Каскад из хендоффа, по-настоящему.
    if (url.pathname === '/app/api/profile') {
      const path = join(DATA, 'profiles', `${invite.token}.json`);
      if (req.method === 'GET') {
        if (!existsSync(path)) return json(res, 200, { profile: null });
        return json(res, 200, { profile: JSON.parse(readFileSync(path, 'utf8')) });
      }
      if (req.method === 'PUT') {
        const body = await readBody(req, 32 * 1024);
        if (!body) return json(res, 413, { error: 'слишком большой запрос' });
        mkdirSync(join(DATA, 'profiles'), { recursive: true });
        writeFileSync(path, body);
        logEvent(invite.name, 'profile_saved', null);
        return json(res, 200, { ok: true });
      }
    }

    if (req.method === 'POST' && url.pathname === '/app/api/events') {
      const body = await readBody(req, 8 * 1024);
      if (!body) return json(res, 413, { error: 'слишком большой запрос' });
      const { type, payload } = JSON.parse(body.toString('utf8')) as {
        type: string;
        payload?: unknown;
      };
      logEvent(invite.name, `ui:${String(type).slice(0, 40)}`, payload ?? null);
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'нет такого пути' });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: 'внутренняя ошибка', detail: String(error).slice(0, 200) });
  }
});

/**
 * Страница созвонов. Отвечает на вопрос «кто где застрял» по телеметрии
 * и хранит заметки. Никаких действий отсюда запустить нельзя — только
 * прочитать и записать слова.
 */
function adminPage(): string {
  const events = existsSync(join(DATA, 'events.jsonl'))
    ? readFileSync(join(DATA, 'events.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { at: string; who: string; type: string; payload: unknown })
    : [];
  const notes = existsSync(join(DATA, 'call-notes.jsonl'))
    ? readFileSync(join(DATA, 'call-notes.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { at: string; who: string; note: string })
    : [];

  const byWho = new Map<string, typeof events>();
  for (const e of events) {
    if (!byWho.has(e.who)) byWho.set(e.who, []);
    byWho.get(e.who)!.push(e);
  }

  const esc = (x: string): string =>
    x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

  const people = [...byWho.entries()]
    .map(([who, list]) => {
      const last = list[list.length - 1]!;
      const rows = list
        .slice(-30)
        .map(
          (e) =>
            `<tr><td class="mono">${esc(e.at.slice(11, 19))}</td><td>${esc(e.type)}</td>` +
            `<td class="mono">${esc(JSON.stringify(e.payload ?? '').slice(0, 90))}</td></tr>`,
        )
        .join('');
      return (
        `<details ${Date.now() - Date.parse(last.at) < 3600_000 ? 'open' : ''}>` +
        `<summary><b>${esc(who)}</b> · событий: ${list.length} · последнее: ${esc(last.type)} в ${esc(last.at.slice(11, 19))}</summary>` +
        `<table>${rows}</table></details>`
      );
    })
    .join('');

  const noteRows = notes
    .slice(-20)
    .reverse()
    .map(
      (n) =>
        `<div class="note"><b>${esc(n.who)}</b> · ${esc(n.at.slice(0, 16))}<br>${esc(n.note)}</div>`,
    )
    .join('');

  return (
    `<!doctype html><html lang="ru"><head><meta charset="utf-8">` +
    `<meta name="robots" content="noindex,nofollow"><title>Seamsterly · созвоны</title>` +
    `<style>body{margin:0;padding:32px;background:#FBFAF8;color:#161616;font:14px/1.5 Sora,Arial,sans-serif;max-width:920px}` +
    `h1{font-size:22px}h2{font-size:16px;margin-top:32px}` +
    `.mono{font-family:"JetBrains Mono",monospace;font-size:11px}` +
    `table{border-collapse:collapse;margin:8px 0}td{padding:4px 10px;border-bottom:1px solid #E3E1DC;font-size:12px}` +
    `details{background:#fff;border:1px solid #E3E1DC;padding:10px 14px;margin-bottom:8px}` +
    `summary{cursor:pointer}` +
    `.note{background:#fff;border:1px solid #E3E1DC;padding:10px 14px;margin-bottom:8px;font-size:13px}` +
    `textarea,input{font:inherit;width:100%;padding:8px;border:1px solid #E3E1DC;margin:4px 0}` +
    `button{font:inherit;padding:9px 18px;background:#161616;color:#fff;border:0;cursor:pointer}</style>` +
    `</head><body><h1>Созвоны</h1>` +
    `<h2>Кто что делал</h2>${people || '<div>Событий пока нет.</div>'}` +
    `<h2>Заметка о звонке</h2>` +
    `<form method="post"><input name="who" placeholder="с кем говорили">` +
    `<textarea name="note" rows="4" placeholder="что сказали, что пообещали, что чинить"></textarea>` +
    `<button>Сохранить</button></form>` +
    `<h2>Прошлые заметки</h2>${noteRows || '<div>Пока пусто.</div>'}` +
    `</body></html>`
  );
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`demo server on 127.0.0.1:${PORT} · data: ${DATA} · invites: ${invites().length}`);
  if (!ADMIN) console.log('ADMIN_TOKEN не задан — админ-просмотр выключен');
  if (!telegramReady) console.log('TELEGRAM_BOT_TOKEN/ADMIN_ID не заданы — канал выключен');
  // Незапланированный рестарт видно по этому сообщению: если оно пришло
  // ночью и его никто не ждал, значит сервис падал.
  tgNotify('🟢 Кабинет запущен', [`${PUBLIC_ORIGIN}/app/`, `Инвайтов: ${invites().length}`], true);
});

// Падение процесса не должно быть тихим.
process.on('uncaughtException', (error) => {
  console.error('uncaught:', error);
  tgNotify('🔴 Сбой сервера кабинета', [String(error).slice(0, 400)]);
});
