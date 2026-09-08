#!/usr/bin/env tsx
/**
 * Демо-сервер Seamster: инвайты, очередь генерации, живой документ.
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
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  statSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { isSeamsterError } from '@seamster/core';
import { applyDecision, editMeasurement, openDecisions } from '@seamster/fit';
import { flatDefaults, parseSketchEdits, type SketchEdits } from '@seamster/flats';
import { kb } from '@seamster/kb';
import { parseStyleSpec, type StyleSpec } from '@seamster/stylespec';
import type { DocImage, DocVisuals } from '@seamster/docgen';
import { messages } from '@seamster/i18n';
import { archiveSketch, generate, redrawSketch } from '../../cli/src/generate.js';
import { parseAnswers } from '../../cli/src/answers.js';
import { FREE_PER_MONTH, Limits } from './limits.js';
import { Notifications } from './notify.js';
import { Referrals, refCode } from './referrals.js';
import { tgDocument, tgNotify, tgTrace, telegramReady } from './telegram.js';
import { buildRfq } from './rfq.js';
import { findTemplate } from '@seamster/templates';
import {
  candidatesFor,
  composeViews,
  ensureJobTemplate,
  readJobTemplate,
  renderJobTemplate,
  replaceJobTemplate,
  writeJobTemplate,
} from './templates.js';

const PORT = Number(process.env.PORT ?? 8131);
/**
 * Адрес прослушивания. По умолчанию только петля: на машине разработчика
 * кабинет не должен торчать в локальную сеть. В контейнере наоборот — Caddy
 * стучится из соседнего контейнера, и петля даёт ровно 502.
 */
const HOST = process.env.HOST ?? '127.0.0.1';
const DATA = process.env.DATA_DIR ?? 'data';
const ADMIN = process.env.ADMIN_TOKEN ?? '';
const MAX_PHOTO = 12 * 1024 * 1024;
/** Адрес, по которому кабинет виден снаружи — из него собираются ссылки. */
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? 'https://seamster.pro';
const MAX_PHOTOS = 6;
/** Перерисовка эскиза — платный вызов модели; чаще минуты её не зовут. */
const redrawAt = new Map<string, number>();

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
/**
 * Работы в исполнении. Разбор фото ждёт сеть, а не процессор, поэтому люди не
 * обязаны стоять друг за другом: раньше один флаг на весь сервер отвечал
 * «одна генерация уже идёт» любому, пока шла чужая.
 */
const active = new Set<string>();
const MAX_CONCURRENT = 3;

/** Сколько работ этого человека уже стоит в очереди или исполняется. */
function activeFor(token: string): number {
  return [...queue, ...active].filter((id) => ownerOf(id)?.token === token).length;
}

/** Имя пака из анкеты — для журнала и уведомлений; без анкеты — идентификатор. */
function jobName(dir: string): string {
  try {
    const a = JSON.parse(readFileSync(join(dir, 'answers.json'), 'utf8')) as { name?: string };
    return a.name?.trim() || dir.split('/').pop() || 'пак';
  } catch {
    return dir.split('/').pop() || 'пак';
  }
}

/** Каталоги работ этого человека — по owner.txt. */
function ownedJobDirs(token: string): string[] {
  const root = join(DATA, 'jobs');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((id) => {
    try {
      return readFileSync(join(root, id, 'owner.txt'), 'utf8').trim() === token;
    } catch {
      return false;
    }
  });
}

function photoCount(dir: string): number {
  try {
    return (JSON.parse(readFileSync(join(dir, 'photos.json'), 'utf8')) as string[]).length;
  } catch {
    return 0;
  }
}

/** Снимки работы по порядку загрузки — с номером и объявленным ракурсом. */
function photoList(dir: string): { n: number; name: string; view: string | null }[] {
  try {
    return (JSON.parse(readFileSync(join(dir, 'photos.json'), 'utf8')) as string[]).map(
      (name, i) => ({ n: i + 1, name, view: /^photo-\d+-(.+)\.[a-z]+$/.exec(name)?.[1] ?? null }),
    );
  } catch {
    return [];
  }
}

function mimeByName(name: string): string {
  const ext = name.split('.').pop() ?? 'jpg';
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
}

/** Копия снимка в размере листа — её кладёт генератор рядом с документом. */
function referencePath(dir: string, n: number): { path: string; type: string } | null {
  for (const ext of ['jpg', 'png', 'webp'] as const) {
    const path = join(dir, `reference-${n}.${ext}`);
    if (existsSync(path)) return { path, type: mimeByName(path) };
  }
  return null;
}

/** Исходник тяжелее этого на лист не идёт: предпросмотр открывался бы минуту. */
const MAX_INLINE_PHOTO = 1.5 * 1024 * 1024;

/**
 * Снимки заказчика для документа.
 *
 * Исходник с телефона весит пять мегабайт и в base64 попал бы в КАЖДЫЙ
 * предпросмотр: кабинет открывает документ — и тянет двадцать. Поэтому
 * берутся копии в размере листа, снятые при сборке; старым работам без
 * копий достаётся исходник, если он не тяжелее полутора мегабайт, иначе
 * снимок на лист не идёт.
 *
 * Плоские виды — первыми: колонка референса на листе чертежа берёт два
 * первых, и это должны быть перед и спинка, а не деталь горловины. Подписи
 * на языке комплекта — фабрика читает «Back», а не «Спинка».
 */
function jobPhotos(dir: string, locale: 'ru' | 'en' | 'zh'): DocImage[] {
  const t = messages(locale);
  const label: Record<string, string> = { front_flat: t.view_front, back_flat: t.view_back };
  const rank = (view: string | null): number =>
    view === 'front_flat' ? 0 : view === 'back_flat' ? 1 : 2;
  return photoList(dir)
    .sort((a, b) => rank(a.view) - rank(b.view) || a.n - b.n)
    .slice(0, 3)
    .flatMap((p) => {
      const original = join(dir, p.name);
      const found =
        referencePath(dir, p.n) ??
        (existsSync(original) && statSync(original).size <= MAX_INLINE_PHOTO
          ? { path: original, type: mimeByName(p.name) }
          : null);
      if (!found) return [];
      return [
        {
          dataUri: `data:${found.type};base64,${readFileSync(found.path).toString('base64')}`,
          label: label[p.view ?? ''] ?? `${t.reference_photo} ${p.n}`,
        },
      ];
    });
}

/**
 * Файл эскиза работы — с типом, а не с угаданным расширением.
 *
 * Модель отдаёт то JPEG, то PNG, и имя файла отражает содержимое. Искать
 * его в трёх местах по-разному значило бы завести три разных ответа на
 * вопрос «есть ли у работы эскиз».
 */
/**
 * Картинки работы для документа — одним ответом на всех.
 *
 * Экран и выгрузка обязаны показывать ОДИН документ. Пока превью собирало
 * его без визуалов, а PDF с ними, кабинет показывал параметрический чертёж
 * там, где в файле стоял силуэт: две сборки разошлись ровно потому, что их
 * было две.
 */
function jobVisuals(dir: string, spec: StyleSpec, locale: 'ru' | 'en' | 'zh'): DocVisuals | null {
  const chosen = readJobTemplate(dir);
  // Набор видов строится на язык выгрузки: плашка вшита в SVG, и русская
  // оговорка в китайском комплекте бесполезна.
  const library = chosen.id ? renderJobTemplate(spec, chosen.id, locale) : null;
  // Картинки переживают пересборку: они сняты один раз и лежат файлами
  // рядом со спекой. Раньше жили только внутри первого PDF, и правка
  // любого замера роняла их из документа молча.
  const renderPath = join(dir, 'render.png');
  const render = existsSync(renderPath)
    ? { dataUri: `data:image/png;base64,${readFileSync(renderPath).toString('base64')}` }
    : null;
  const found = sketchPath(dir);
  const sketch = found
    ? { dataUri: `data:${found.type};base64,${readFileSync(found.path).toString('base64')}` }
    : null;
  const sketchViews: Partial<Record<SketchView, DocImage>> = {};
  for (const view of sketchViewsOf(dir)) {
    const f = sketchPath(dir, view);
    if (f)
      sketchViews[view] = {
        dataUri: `data:${f.type};base64,${readFileSync(f.path).toString('base64')}`,
      };
  }
  // Снимки заказчика — тоже здесь: они стоят на странице внешнего вида
  // и колонкой референса рядом с эскизом. Первый PDF их нёс, а пересборка
  // после правки замера теряла: две сборки — два документа.
  const photos = jobPhotos(dir, locale);
  if (!library && !render && !sketch && photos.length === 0) return null;
  const sketchEdits = sketchEditsOf(dir);
  const sketchBoxes = sketchBoxesOf(dir);
  // Заливки на эскизе: цвет колорвеев и раппорт — файлы рядом с листом.
  const sketchColorways: Record<string, DocImage> = {};
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    const m = /^sketch-colorway-([A-Za-z0-9_-]+)\.jpg$/.exec(name);
    if (m)
      sketchColorways[m[1]!] = {
        dataUri: `data:image/jpeg;base64,${readFileSync(join(dir, name)).toString('base64')}`,
      };
  }
  const patternPath = join(dir, 'sketch-pattern.jpg');
  const sketchPattern = existsSync(patternPath)
    ? { dataUri: `data:image/jpeg;base64,${readFileSync(patternPath).toString('base64')}` }
    : null;
  return {
    ...(library ? { libraryFlats: { [locale]: library } } : {}),
    ...(render ? { render } : {}),
    ...(sketch ? { sketch } : {}),
    ...(Object.keys(sketchViews).length ? { sketchViews } : {}),
    ...(sketchBoxes.length ? { sketchBoxes } : {}),
    ...(sketchEdits ? { sketchEdits } : {}),
    ...(Object.keys(sketchColorways).length ? { sketchColorways } : {}),
    ...(sketchPattern ? { sketchPattern } : {}),
    ...(photos.length ? { photos } : {}),
  };
}

/**
 * Очередь открытых решений работы.
 *
 * Собирается из спеки и того, чего спека не хранит: примечаний сборки
 * (расхождения фото и анкеты), ракурсов присланных фото и списка решений,
 * снятых с повестки человеком. Последний живёт файлом рядом со спекой —
 * это единственное, что нельзя вывести заново.
 */
function decisionsOf(dir: string, spec: StyleSpec) {
  const status = existsSync(join(dir, 'status.json'))
    ? (JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8')) as JobStatus)
    : null;
  const photoViews = photoList(dir)
    .map((p) => p.view)
    .filter((v): v is string => v !== null);
  return openDecisions(spec, {
    notes: status?.notes ?? [],
    resolved: resolvedDecisions(dir),
    photoViews,
  });
}

function resolvedDecisions(dir: string): string[] {
  const path = join(dir, 'decisions.json');
  if (!existsSync(path)) return [];
  try {
    return (JSON.parse(readFileSync(path, 'utf8')) as { resolved: { id: string }[] }).resolved.map(
      (r) => r.id,
    );
  } catch {
    return [];
  }
}

/**
 * Гейт наружу: ссылка фабрике и просчёт.
 *
 * Держат две вещи: пустые реквизиты маркировки (партию нельзя продать) и
 * неснятые расхождения фото с анкетой (документ может описывать не ту
 * вещь). Предположения не держат — они помечены в документе и фабрика
 * видит их как ориентир; требовать подтвердить каждое до отправки значило
 * бы поставить гейт, который нельзя пройти по фотографии.
 */
function exportGate(dir: string, spec: StyleSpec) {
  const { summary, decisions } = decisionsOf(dir, spec);
  if (summary.ready) return null;
  const gaps = decisions
    .filter((d) => d.blocking && d.kind === 'needs_input')
    .map((d) => ({
      id: d.id.replace(/^input:/, ''),
      label_ru: d.title_ru,
      action_ru: d.detail_ru,
    }));
  const conflicts = decisions.filter((d) => d.blocking && d.kind === 'conflict');
  const parts: string[] = [];
  if (gaps.length)
    parts.push(
      `не заполнено ${gaps.length} ${gaps.length === 1 ? 'обязательный реквизит' : 'обязательных реквизита'} маркировки`,
    );
  if (conflicts.length)
    parts.push(
      `не снято ${conflicts.length} ${conflicts.length === 1 ? 'расхождение' : 'расхождения'} фото с анкетой`,
    );
  return {
    error: `Документ не готов к отправке: ${parts.join(' и ')}.`,
    action: conflicts.length
      ? 'Откройте очередь решений и снимите расхождения — это одна кнопка на каждое.'
      : 'Заполните профиль бренда — это одна форма, и она нужна один раз.',
    gaps,
    decisions: conflicts.map((d) => d.id),
  };
}

const SKETCH_VIEWS = ['front', 'side', 'back'] as const;
type SketchView = (typeof SKETCH_VIEWS)[number];

/** Лист эскиза целиком или один вырезанный из него вид. */
function sketchPath(dir: string, view?: SketchView): { path: string; type: string } | null {
  const stem = view ? `sketch-${view}` : 'sketch';
  for (const [ext, type] of [
    ['png', 'image/png'],
    ['jpg', 'image/jpeg'],
  ] as const) {
    const path = join(dir, `${stem}.${ext}`);
    if (existsSync(path)) return { path, type };
  }
  return null;
}

/** Границы видов на листе эскиза — их пишет генератор рядом с вырезками. */
function sketchBoxesOf(
  dir: string,
): { view: SketchView; x0: number; y0: number; x1: number; y1: number }[] {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'sketch-views.json'), 'utf8')) as {
      boxes?: { view: SketchView; x0: number; y0: number; x1: number; y1: number }[];
    };
    return raw.boxes ?? [];
  } catch {
    return [];
  }
}

/**
 * Слой правок поверх эскиза и его история.
 *
 * Правки — вектор в долях листа, а не запечённые пиксели (ADR-0010 и разбор
 * референса): их можно снять и подвинуть в любой момент. Каждое сохранение
 * кладёт прошлую версию в историю, откуда её можно вернуть.
 */
function sketchEditsOf(dir: string): SketchEdits | null {
  try {
    return parseSketchEdits(JSON.parse(readFileSync(join(dir, 'sketch-edits.json'), 'utf8')));
  } catch {
    return null;
  }
}

const EDITS_HISTORY_MAX = 20;

function editsHistoryOf(dir: string): { saved_at: string; strokes: number }[] {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'sketch-edits.history.json'), 'utf8')) as {
      saved_at: string;
      edits: SketchEdits;
    }[];
    return raw.map((h) => ({ saved_at: h.saved_at, strokes: h.edits.strokes.length }));
  } catch {
    return [];
  }
}

function saveSketchEdits(dir: string, edits: SketchEdits): SketchEdits {
  const path = join(dir, 'sketch-edits.json');
  const histPath = join(dir, 'sketch-edits.history.json');
  const previous = sketchEditsOf(dir);
  if (previous) {
    let hist: { saved_at: string; edits: SketchEdits }[] = [];
    try {
      hist = JSON.parse(readFileSync(histPath, 'utf8')) as typeof hist;
    } catch {
      hist = [];
    }
    hist.unshift({ saved_at: previous.saved_at ?? new Date().toISOString(), edits: previous });
    writeFileSync(histPath, JSON.stringify(hist.slice(0, EDITS_HISTORY_MAX)));
  }
  const stamped: SketchEdits = { ...edits, saved_at: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(stamped));
  return stamped;
}

/** Версии листа эскиза: перерисовки уходят в историю, откуда возвращаются. */
function sketchHistoryOf(dir: string): { at: string; views: SketchView[] }[] {
  const root = join(dir, 'sketch-history');
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .sort()
    .reverse()
    .map((name) => ({
      at: name,
      views: SKETCH_VIEWS.filter(
        (v) =>
          existsSync(join(root, name, `sketch-${v}.jpg`)) ||
          existsSync(join(root, name, `sketch-${v}.png`)),
      ),
    }));
}

/** Вернуть лист из истории; текущий уходит в историю на его место. */
function restoreSketch(dir: string, at: string): boolean {
  if (!/^[0-9TZ-]{10,40}$/.test(at)) return false;
  const src = join(dir, 'sketch-history', at);
  if (!existsSync(src)) return false;
  const names = readdirSync(src);
  archiveSketch(dir);
  for (const n of names) renameSync(join(src, n), join(dir, n));
  rmSync(src, { recursive: true, force: true });
  return true;
}

/**
 * Какие виды вырезаны из эскиза.
 *
 * Их показывают порознь кабинет (чип «Перед»), обложка и лист на просчёт —
 * раньше эти места брали библиотечный силуэт, и рядом с эскизом он читался
 * как другая вещь (ADR-0010).
 */
function sketchViewsOf(dir: string): SketchView[] {
  return SKETCH_VIEWS.filter((v) => sketchPath(dir, v) !== null);
}

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
  if (active.size >= MAX_CONCURRENT) return;
  const id = queue.shift();
  if (!id) return;
  active.add(id);
  // Следующая работа стартует сразу, не дожидаясь этой.
  void pump();
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
      ...(result.template?.illustrative !== undefined
        ? { illustrative: result.template.illustrative }
        : {}),
      ...(result.template?.drift !== undefined ? { drift: result.template.drift } : {}),
    });
    const s = statuses.get(id)!;
    s.notes = result.notes;
    s.cost_ms = Date.now() - started;
    setStage(id, 'done');

    // Списываем ТОЛЬКО здесь: пак собран, значит человек получил ценность.
    const sec = Math.round((Date.now() - started) / 1000);
    const assumptions = result.spec.meta.assumptions_count ?? 0;
    if (owner) {
      const view = limits.charge(owner.token, monthlyOf(owner), new Date(), {
        job: id,
        name: result.spec.style.name,
      });
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
      s.error = isSeamsterError(error)
        ? { message: error.userMessage, action: error.userAction }
        : { message: 'Генерация не получилась.', action: 'Повторите — лимит не списан.' };
      setStage(id, 'error');
      if (owner) {
        // Строка в журнале: «ошибка — не списано». Остаток человек и так видит,
        // а вот что за сбой ему ничего не стоил — только отсюда.
        limits.noteFailure(owner.token, { job: id, name: jobName(jobDir(id)) });
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
    active.delete(id);
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
        // Кабинет собирается в один index.html и обновляется каждой выкаткой.
        // Без этого заголовка браузер держит прошлую сборку эвристически:
        // человек видит старый чертёж и старые кнопки, а мы думаем, что
        // правка доехала. no-cache не запрещает кэш — он требует проверять.
        res.writeHead(200, {
          'content-type': types[ext] ?? 'application/octet-stream',
          'cache-control': 'no-cache, must-revalidate',
        });
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
          text: 'Проверка связи — канал Seamster работает.',
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
      const { renderHtml } = await import('@seamster/docgen');
      // Язык ссылки. Ради этого она и задумана: документ открывает фабрика,
      // и русский текст на её экране означает переписку вместо чтения.
      const shareLocale = (['en', 'zh'] as const).find((l) => l === url.searchParams.get('locale'));
      // Силуэт из библиотеки — тот же, что в PDF: страница по ссылке и
      // выгрузка не должны показывать разные изделия.
      const shareTemplate = id ? readJobTemplate(jobDir(id)) : { id: null };
      const shareLibrary = shareTemplate.id
        ? renderJobTemplate(spec, shareTemplate.id, shareLocale ?? 'ru')
        : null;
      logEvent('фабрика', 'share_open', { id, ...(shareLocale ? { locale: shareLocale } : {}) });
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'x-robots-tag': 'noindex, nofollow',
      });
      return res.end(
        renderHtml(spec, {
          pro: true,
          ...(shareLocale ? { locale: shareLocale } : {}),
          ...(shareLibrary
            ? {
                visuals: {
                  libraryFlats: {
                    [shareLocale ?? 'ru']: {
                      front: shareLibrary.front,
                      ...(shareLibrary.back ? { back: shareLibrary.back } : {}),
                      templateId: shareLibrary.templateId,
                      missing: shareLibrary.missing,
                    },
                  },
                },
              }
            : {}),
        }),
      );
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
        const view = limits.grant(inviter.token, 1, new Date(), `за приглашение: ${claim.name}`);
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

    // Приватность и данные: забрать всё своё одним архивом.
    if (req.method === 'GET' && url.pathname === '/app/api/me/export') {
      const ids = ownedJobDirs(invite.token);
      const profile = join('profiles', `${invite.token}.json`);
      const items = ids.map((id) => join('jobs', id));
      if (existsSync(join(DATA, profile))) items.push(profile);
      if (items.length === 0)
        return json(res, 404, { error: 'Данных пока нет — нечего скачивать.' });
      logEvent(invite.name, 'export_data', { jobs: ids.length });
      const stamp = new Date().toISOString().slice(0, 10);
      res.writeHead(200, {
        'content-type': 'application/gzip',
        'content-disposition': `attachment; filename="seamster-data-${stamp}.tar.gz"`,
      });
      const { spawn } = await import('node:child_process');
      const tar = spawn('tar', ['-cz', '-C', DATA, ...items]);
      tar.stdout.pipe(res);
      tar.on('error', () => res.end());
      return;
    }

    // Удалить всё своё: паки, снимки, профиль. Квота остаётся — иначе удаление
    // становилось бы способом обнулить месячный лимит.
    if (req.method === 'POST' && url.pathname === '/app/api/me/delete') {
      const body = await readBody(req, 4096);
      const { confirm } = body ? (JSON.parse(body.toString('utf8')) as { confirm?: string }) : {};
      if (confirm !== 'удалить')
        return json(res, 400, { error: 'Подтвердите удаление словом «удалить».' });
      const ids = ownedJobDirs(invite.token);
      for (const id of ids) {
        rmSync(join(DATA, 'jobs', id), { recursive: true, force: true });
        statuses.delete(id);
      }
      rmSync(join(DATA, 'profiles', `${invite.token}.json`), { force: true });
      logEvent(invite.name, 'delete_all', { jobs: ids.length });
      tgNotify(`🗑 Удалил все данные — ${invite.name}`, [`${invite.org}`, `паков: ${ids.length}`]);
      return json(res, 200, { ok: true, deleted: ids.length });
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

    // Быстрый взгляд на первый снимок — до анкеты. Ответ заполняет вопросы
    // второго шага, человек их подтверждает. Стоит копейки, живёт секунды,
    // сантиметров не содержит: пропорции остаются полному разбору.
    if (req.method === 'POST' && url.pathname === '/app/api/quicklook') {
      const body = await readBody(req, MAX_PHOTO);
      if (!body || body.length < 1024)
        return json(res, 413, { error: 'файл пустой или слишком большой' });
      const ct = String(req.headers['content-type'] ?? '');
      const format = ct.includes('png')
        ? 'png'
        : ct.includes('webp')
          ? 'webp'
          : ct.includes('gif')
            ? 'gif'
            : 'jpg';
      try {
        const { quickLook } = await import('@seamster/vision');
        const { look, fromCache, ms } = await quickLook({
          photo: { bytes: body, format },
          cacheDir: join(DATA, 'cache', 'quicklook'),
        });
        logEvent(invite.name, 'quicklook', {
          category: look.category.value,
          source: look.source.value,
          ms,
          cached: fromCache,
        });
        return json(res, 200, { ...look, ms, cached: fromCache });
      } catch (error) {
        console.error('quicklook:', error);
        return json(res, 502, {
          error: 'Снимок не разобрался — заполните анкету вручную.',
          action: 'Это ничего не стоит: генерация не списана.',
        });
      }
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
      const gate = limits.check(invite.token, activeFor(invite.token), monthlyOf(invite));
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
          error: isSeamsterError(e) ? e.userMessage : 'анкета не разобралась',
          detail: isSeamsterError(e) ? e.userAction : String(e),
        });
      }
      const id = randomBytes(8).toString('hex');
      mkdirSync(jobDir(id), { recursive: true });
      // Юрданные из библиотеки бренда каскадом уходят в ярлыки.
      let enriched = body.toString('utf8');
      const profilePath = join(DATA, 'profiles', `${invite.token}.json`);
      if (existsSync(profilePath)) {
        try {
          // Профиль хранится в форме кабинета; страна и товарный знак лежат
          // рядом с юрлицом. Раньше они не доезжали до анкеты, и обязательные
          // реквизиты ярлыка оставались пустыми даже у заполненного профиля —
          // то есть гейт отправки было нечем пройти.
          const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as {
            legal?: { company?: string; inn?: string; address?: string };
            country?: string;
            trademark?: string;
            contact?: { name?: string; phone?: string; email?: string };
          };
          const parsed = JSON.parse(enriched) as Record<string, unknown>;
          if (profile.legal?.company && !parsed.brand_profile) {
            parsed.brand_profile = {
              company_name: profile.legal.company,
              ...(profile.legal.inn ? { inn: profile.legal.inn } : {}),
              ...(profile.legal.address ? { address: profile.legal.address } : {}),
              ...(profile.country ? { country: profile.country } : {}),
              ...(profile.trademark ? { trademark: profile.trademark } : {}),
              ...(profile.contact?.name ? { contact_name: profile.contact.name } : {}),
              ...(profile.contact?.phone ? { contact_phone: profile.contact.phone } : {}),
              ...(profile.contact?.email ? { contact_email: profile.contact.email } : {}),
            };
            if (!parsed.brand) parsed.brand = profile.trademark ?? profile.legal.company;
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
        // Без снимка разбор пропускается молча, и документ собирается из одних
        // типовых значений — с нулём оценок по фото и видом настоящего техпака.
        // Кабинет так не даёт, но API обязан быть не слабее кабинета.
        if (photoCount(dir) === 0) {
          logEvent(invite.name, 'start_rejected', { id, reason: 'no_photo' });
          return json(res, 400, {
            error: 'Без фотографии изделия техпак не собрать.',
            action: 'Добавьте хотя бы один снимок и запустите снова.',
          });
        }
        // Вторая проверка не дублирует первую: между созданием джобы и
        // стартом человек мог открыть вкладку второй раз или добить квоту.
        const gate = limits.check(invite.token, activeFor(invite.token), monthlyOf(invite));
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
        // Просчёт уходит фабрикам от имени бренда — тот же гейт, что у ссылки.
        const quoteSpec = specOf(id);
        if (quoteSpec) {
          const held = exportGate(dir, quoteSpec);
          if (held) {
            logEvent(invite.name, 'quote_blocked', {
              id,
              gaps: held.gaps.map((g) => g.id),
              decisions: held.decisions,
            });
            return json(res, 409, held);
          }
        }
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
        res.writeHead(200, {
          'content-type': mimeByName(name),
          'cache-control': 'private, max-age=86400',
        });
        return res.end(readFileSync(join(dir, name)));
      }

      // HTML-предпросмотр документа: превью первой страницы в экспорте
      // и read-only «ссылка для фабрики». Тот же renderHtml, что печатает PDF.
      if (req.method === 'GET' && rest === '/preview') {
        const spec = specOf(id);
        if (!spec) return json(res, 404, { error: 'спека ещё не готова' });
        const { renderHtml } = await import('@seamster/docgen');
        const locale = (['ru', 'en', 'zh'] as const).find(
          (l) => l === url.searchParams.get('locale'),
        );
        const previewVisuals = jobVisuals(dir, spec, locale ?? 'ru');
        let html = renderHtml(spec, {
          pro: true,
          ...(locale ? { locale } : {}),
          ...(previewVisuals ? { visuals: previewVisuals } : {}),
        });
        // Режим врезки: кабинет показывает документ в маленьком окне превью,
        // и без вписывания человек видит левый верхний угол первой страницы.
        // Показываем ровно первый лист, вписанный по ширине окна.
        if (url.searchParams.get('frame') === '1') {
          html +=
            `<style>html,body{margin:0;overflow:hidden;background:#fff}</style>` +
            `<script>addEventListener('load',function(){` +
            `var p=document.querySelectorAll('.page');if(!p.length)return;` +
            `for(var i=1;i<p.length;i++)p[i].style.display='none';` +
            `document.body.style.zoom=innerWidth/p[0].offsetWidth;});</script>`;
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(html);
      }

      // Ссылка для фабрики: отдельный токен, живёт в каталоге джобы.
      // Идемпотентно — повторный запрос возвращает тот же токен.
      if (req.method === 'POST' && rest === '/share') {
        // Ссылка уходит фабрике от имени бренда. Документ без страны
        // изготовления, юрлица и товарного знака запускает партию, которую
        // нельзя продать в ЕАЭС: наружу такой документ не выпускаем.
        const shareSpec = specOf(id);
        if (shareSpec) {
          const held = exportGate(dir, shareSpec);
          if (held) {
            logEvent(invite.name, 'share_blocked', {
              id,
              gaps: held.gaps.map((g) => g.id),
              decisions: held.decisions,
            });
            return json(res, 409, held);
          }
        }
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
      // Визуализация изделия. Лежит файлом в джобе: раньше она жила только
      // внутри первого PDF как data-URI, и любая правка замера пересобирала
      // документ уже без картинки — молча.
      // Что уже выгружено по этой работе. Прототип показывал два файла с
      // датами из макета — 16 и 15 июля; человек видел «скачать снова» для
      // файлов, которых никогда не было.
      // Готовность к отправке: чего не хватает, чтобы документ можно было
      // отдать фабрике. Считается по реквизитам, которые заполняет бренд.
      if (req.method === 'GET' && rest === '/readiness') {
        const spec = specOf(id);
        if (!spec) return json(res, 404, { error: 'спека ещё не готова' });
        const { readiness } = await import('@seamster/docgen');
        return json(res, 200, readiness(spec));
      }

      // Очередь открытых решений: всё, что требует слова человека, одним
      // списком с тремя действиями. Считается заново на каждый запрос —
      // это проекция спеки, и хранить её значило бы дать ей разойтись.
      if (req.method === 'GET' && rest === '/decisions') {
        const spec = specOf(id);
        if (!spec) return json(res, 404, { error: 'спека ещё не готова' });
        return json(res, 200, decisionsOf(dir, spec));
      }

      if (req.method === 'POST' && rest === '/decisions') {
        const body = await readBody(req, 4096);
        if (!body) return json(res, 413, { error: 'слишком большой запрос' });
        const {
          id: decisionId,
          action,
          value,
        } = JSON.parse(body.toString('utf8')) as {
          id: string;
          action: 'confirm' | 'edit' | 'dismiss';
          value?: string | number;
        };
        const spec = specOf(id);
        if (!spec) return json(res, 404, { error: 'спека ещё не готова' });
        if (!['confirm', 'edit', 'dismiss'].includes(action))
          return json(res, 400, { error: 'неизвестное действие' });
        // Действие сверяется с тем, что очередь ПРЕДЛОЖИЛА для этого решения:
        // «подтвердить» масштаб, у которого есть только «оставлю как есть»,
        // снял бы его с повестки под чужим именем, и журнал соврал бы.
        const offered = decisionsOf(dir, spec).decisions.find((d) => d.id === decisionId);
        if (!offered) return json(res, 404, { error: 'такого решения в очереди нет' });
        if (!offered.actions.includes(action))
          return json(res, 422, {
            error: `для «${offered.title_ru}» доступно: ${offered.actions.join(', ') || 'только профиль бренда'}`,
          });
        const result = applyDecision(spec, decisionId, action, value);
        if (result.rejected) {
          logEvent(invite.name, 'decision_rejected', {
            id,
            decision: decisionId,
            action,
            reason: result.rejected,
          });
          return json(res, 422, { error: result.rejected });
        }
        if (result.resolved) {
          // Снятое с повестки в спеке не выразить — запоминаем рядом с ней.
          const path = join(dir, 'decisions.json');
          const current = existsSync(path)
            ? (JSON.parse(readFileSync(path, 'utf8')) as {
                resolved: { id: string; action: string; at: string }[];
              })
            : { resolved: [] };
          if (!current.resolved.some((r) => r.id === result.resolved))
            current.resolved.push({ id: result.resolved, action, at: new Date().toISOString() });
          writeFileSync(path, JSON.stringify(current, null, 2));
        } else if (result.spec !== spec) {
          writeFileSync(join(dir, 'spec.json'), JSON.stringify(result.spec, null, 2));
          // PDF устарел: следующая выгрузка пересоберёт его из новой спеки.
          writeFileSync(join(dir, 'pdf-stale.flag'), '1');
        }
        logEvent(invite.name, 'decision', {
          id,
          decision: decisionId,
          action,
          changed: result.changed_ru,
        });
        // Спека отдаётся той же формой, что и после правки замера: кабинет
        // кладёт её в кэш и перерисовывает таблицу тем же кодом.
        return json(res, 200, {
          ...decisionsOf(dir, result.spec),
          changed_ru: result.changed_ru,
          ...(result.spec !== spec ? (specPayload(result.spec) as object) : {}),
        });
      }

      if (req.method === 'GET' && rest === '/files') {
        const known: [string, string][] = [
          ['pack.pdf', 'PDF полный'],
          ['rfq.pdf', 'Лист на просчёт'],
          ['flat-front.svg', 'Чертёж · перед'],
          ['flat-back.svg', 'Чертёж · спинка'],
          ['render.png', 'Визуализация'],
          ['sketch.png', 'Технический эскиз'],
          ['sketch.jpg', 'Технический эскиз'],
        ];
        const files = known
          .filter(([name]) => existsSync(join(dir, name)))
          .map(([name, label]) => {
            const st = statSync(join(dir, name));
            return { name, label, size: st.size, at: new Date(st.mtimeMs).toISOString() };
          });
        // Снимки — отдельным списком: это не выгрузки, а вход. Кабинету
        // нужны их номера и ракурсы, чтобы поставить нужный рядом с рисунком.
        return json(res, 200, {
          files,
          photos: photoList(dir).map(({ n, view }) => ({ n, view })),
          sketch_views: sketchViewsOf(dir),
          sketch_boxes: sketchBoxesOf(dir),
          sketch_edits: sketchEditsOf(dir)?.saved_at ?? null,
          sketch_versions: sketchHistoryOf(dir).length,
        });
      }

      if (req.method === 'GET' && rest === '/render') {
        const path = join(dir, 'render.png');
        if (!existsSync(path)) return json(res, 404, { error: 'визуализации нет' });
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-cache' });
        return res.end(readFileSync(path));
      }

      // Перерисовка эскиза по текущим снимкам и узлам. Долгий вызов — до
      // минуты, — поэтому чаще минуты на одну работу его не пускаем.
      if (req.method === 'POST' && rest === '/sketch/redraw') {
        const spec = specOf(id);
        if (!spec) return json(res, 404, { error: 'спека ещё не готова' });
        const photos = photoList(dir);
        if (photos.length === 0)
          return json(res, 400, {
            error: 'Без снимка эскиз не перерисовать.',
            action: 'Добавьте фотографию изделия.',
          });
        if (Date.now() - (redrawAt.get(id) ?? 0) < 60_000)
          return json(res, 429, {
            error: 'Эскиз только что перерисовывали.',
            action: 'Подождите минуту и попробуйте снова.',
          });
        redrawAt.set(id, Date.now());
        const result = await redrawSketch({
          dir,
          spec,
          photoPaths: photos.map((p) => join(dir, p.name)),
          cacheDir: join(DATA, 'cache', 'vision'),
          renderCacheDir: join(DATA, 'cache', 'render'),
        });
        logEvent(invite.name, 'sketch_redraw', {
          id,
          ok: result.ok,
          ...(result.ok ? {} : { reason: result.reason }),
        });
        if (!result.ok)
          return json(res, 200, {
            ok: false,
            error: result.userMessage,
            action: 'Прошлый рисунок оставлен. Уточните узлы или снимки и попробуйте снова.',
          });
        return json(res, 200, { ok: true, views: result.views, history: sketchHistoryOf(dir) });
      }
      if (req.method === 'GET' && rest === '/sketch/history')
        return json(res, 200, { history: sketchHistoryOf(dir) });
      if (req.method === 'POST' && rest === '/sketch/rollback') {
        const body = await readBody(req, 4096);
        const { at } = body ? (JSON.parse(body.toString('utf8')) as { at?: string }) : {};
        if (typeof at !== 'string' || !restoreSketch(dir, at))
          return json(res, 404, { error: 'такой версии рисунка нет' });
        logEvent(invite.name, 'sketch_rollback', { id, at });
        return json(res, 200, { ok: true, history: sketchHistoryOf(dir) });
      }

      // Слой правок поверх эскиза: вектор, история, откат.
      if (rest === '/sketch-edits') {
        if (req.method === 'GET')
          return json(res, 200, { edits: sketchEditsOf(dir), history: editsHistoryOf(dir) });
        if (req.method === 'PUT') {
          if (!sketchPath(dir)) return json(res, 404, { error: 'у этой работы нет эскиза' });
          const body = await readBody(req, 2 * 1024 * 1024);
          if (!body) return json(res, 413, { error: 'слишком большой слой правок' });
          let edits: SketchEdits;
          try {
            edits = parseSketchEdits(JSON.parse(body.toString('utf8')));
          } catch (e) {
            return json(res, 400, { error: e instanceof Error ? e.message : 'слой не разобран' });
          }
          const saved = saveSketchEdits(dir, edits);
          logEvent(invite.name, 'sketch_edits', { id, strokes: saved.strokes.length });
          return json(res, 200, { ok: true, edits: saved, history: editsHistoryOf(dir) });
        }
      }
      if (req.method === 'POST' && rest === '/sketch-edits/rollback') {
        const body = await readBody(req, 4096);
        const { index } = body
          ? (JSON.parse(body.toString('utf8')) as { index?: number })
          : { index: undefined };
        let hist: { saved_at: string; edits: SketchEdits }[] = [];
        try {
          hist = JSON.parse(
            readFileSync(join(dir, 'sketch-edits.history.json'), 'utf8'),
          ) as typeof hist;
        } catch {
          hist = [];
        }
        const target = typeof index === 'number' ? hist[index] : undefined;
        if (!target) return json(res, 404, { error: 'такой версии правок нет' });
        const saved = saveSketchEdits(dir, target.edits);
        return json(res, 200, { ok: true, edits: saved, history: editsHistoryOf(dir) });
      }

      if (req.method === 'GET' && rest === '/sketch') {
        // Отдельный вид — вырезка того же листа: кабинет по чипу «Перед»
        // показывает эту вещь, а не библиотечный силуэт похожей.
        const wanted = url.searchParams.get('view');
        const view = SKETCH_VIEWS.find((v) => v === wanted);
        if (wanted && !view) return json(res, 400, { error: 'неизвестный вид эскиза' });
        const found = sketchPath(dir, view);
        if (!found)
          return json(res, 404, { error: view ? 'этого вида у эскиза нет' : 'эскиза нет' });
        res.writeHead(200, { 'content-type': found.type, 'cache-control': 'no-cache' });
        return res.end(readFileSync(found.path));
      }

      if (req.method === 'GET' && rest === '/flat') {
        const spec = specOf(id);
        if (!spec) return json(res, 404, { error: 'спека ещё не готова' });
        // Силуэт есть у любой работы: старым он подбирается здесь и сейчас.
        // Параметрический мастер человеку не показывается.
        const current = ensureJobTemplate(dir, spec);
        if (!current.id)
          return json(res, 404, { error: 'в библиотеке нет силуэта для этой категории' });
        const rendered = renderJobTemplate(spec, current.id);
        if (!rendered) return json(res, 404, { error: 'силуэт не отрисовался' });
        const view = url.searchParams.get('view') ?? 'front';
        if (view !== 'front' && view !== 'back' && view !== 'all') {
          return json(res, 404, { error: 'такого вида нет: есть перед, спинка и оба вместе' });
        }
        const svg =
          view === 'all'
            ? composeViews(rendered.front, rendered.back)
            : view === 'back'
              ? rendered.back?.svg
              : rendered.front.svg;
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
        const { pomCsv } = await import('@seamster/docgen');
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
        const mtime = (name: string): number =>
          existsSync(join(dir, name)) ? statSync(join(dir, name)).mtimeMs : 0;
        // Перерисованный эскиз и слой правок тоже устаревают PDF: документ
        // обязан печатать тот рисунок, что человек видит в кабинете.
        const sourceM = Math.max(
          mtime('spec.json'),
          mtime('template.json'),
          mtime('sketch.jpg'),
          mtime('sketch.png'),
          mtime('sketch-edits.json'),
        );
        if (!existsSync(pdfPath) || statSync(pdfPath).mtimeMs < sourceM) {
          const { renderPdf, roleProfile } = await import('@seamster/docgen');
          const profile = role ? roleProfile(role) : null;
          const visuals = jobVisuals(dir, spec, locale ?? 'ru');
          writeFileSync(
            pdfPath,
            await renderPdf(spec, {
              ...(profile
                ? { sections: profile.sections, pro: profile.pro, roleLabel: profile.label_ru }
                : { pro: true }),
              ...(locale ? { locale } : {}),
              ...(visuals ? { visuals } : {}),
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
    `<meta name="robots" content="noindex,nofollow"><title>Seamster · созвоны</title>` +
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

/**
 * Работы, застигнутые перезапуском посреди разбора. Их статус на диске застыл
 * на «vision» или «render», а человек ждёт готовности, которая не наступит.
 * Такие работы возвращаются в очередь: разбор фото повторится из кэша даром.
 * Созданные, но не запущенные («queued» без истории) не трогаются — старт
 * остаётся за человеком.
 */
function recoverUnfinished(): number {
  const inFlight = new Set<Stage>(['vision', 'assembly', 'render', 'docgen']);
  let n = 0;
  for (const entry of readdirSync(join(DATA, 'jobs'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    if (existsSync(join(jobDir(id), 'deleted.flag'))) continue;
    let s: JobStatus;
    try {
      s = JSON.parse(readFileSync(join(jobDir(id), 'status.json'), 'utf8')) as JobStatus;
    } catch {
      continue;
    }
    if (!inFlight.has(s.stage)) continue;
    statuses.set(id, s);
    setStage(id, 'queued', 'возвращена в очередь после перезапуска');
    queue.push(id);
    n++;
  }
  if (n) void pump();
  return n;
}

server.listen(PORT, HOST, () => {
  const recovered = recoverUnfinished();
  if (recovered) console.log(`возвращено в очередь после перезапуска: ${recovered}`);
  console.log(`demo server on ${HOST}:${PORT} · data: ${DATA} · invites: ${invites().length}`);
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
