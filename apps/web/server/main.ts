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
});
