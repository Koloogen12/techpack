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

const PORT = Number(process.env.PORT ?? 8131);
const DATA = process.env.DATA_DIR ?? 'data';
const ADMIN = process.env.ADMIN_TOKEN ?? '';
const MAX_PHOTO = 12 * 1024 * 1024;
const MAX_PHOTOS = 6;

mkdirSync(join(DATA, 'jobs'), { recursive: true });

// ---------------------------------------------------------------- инвайты

interface Invite {
  token: string;
  name: string;
  org: string;
  note?: string;
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

async function pump(): Promise<void> {
  if (running) return;
  const id = queue.shift();
  if (!id) return;
  running = true;
  const started = Date.now();
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
    const s = statuses.get(id)!;
    s.notes = result.notes;
    s.cost_ms = Date.now() - started;
    setStage(id, 'done');
  } catch (error) {
    console.error(`job ${id}:`, error);
    const s = statuses.get(id);
    if (s) {
      s.error = isSeamsterlyError(error)
        ? { message: error.userMessage, action: error.userAction }
        : { message: 'Генерация не получилась.', action: 'Повторите — лимит не списан.' };
      setStage(id, 'error');
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

    // Всё остальное — только по инвайту.
    if (!invite) {
      return json(res, 401, {
        error: 'нужна инвайт-ссылка',
        action: 'откройте адрес, который вам прислали, целиком',
      });
    }

    if (req.method === 'GET' && url.pathname === '/app/api/me') {
      logEvent(invite.name, 'open', { org: invite.org });
      return json(res, 200, { name: invite.name, org: invite.org });
    }

    if (req.method === 'POST' && url.pathname === '/app/api/jobs') {
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
      writeFileSync(join(jobDir(id), 'answers.json'), body);
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
        if (!queue.includes(id) && statuses.get(id)?.stage === 'queued') {
          queue.push(id);
          void pump();
        }
        logEvent(invite.name, 'job_started', { id });
        return json(res, 200, { ok: true });
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

      if (req.method === 'GET' && rest === '/pdf') {
        const spec = specOf(id);
        if (!spec) return json(res, 404, { error: 'спека ещё не готова' });
        const pdfPath = join(dir, 'pack.pdf');
        if (existsSync(join(dir, 'pdf-stale.flag')) || !existsSync(pdfPath)) {
          const { renderPdf } = await import('@seamsterly/docgen');
          writeFileSync(pdfPath, await renderPdf(spec, { pro: true }));
          try {
            writeFileSync(join(dir, 'pdf-stale.flag'), '');
            const { unlinkSync } = await import('node:fs');
            unlinkSync(join(dir, 'pdf-stale.flag'));
          } catch {
            /* не мешает */
          }
        }
        logEvent(invite.name, 'pdf', { id });
        res.writeHead(200, {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${spec.style.article}.pdf"`,
        });
        return res.end(readFileSync(pdfPath));
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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`demo server on 127.0.0.1:${PORT} · data: ${DATA} · invites: ${invites().length}`);
  if (!ADMIN) console.log('ADMIN_TOKEN не задан — админ-просмотр выключен');
});
