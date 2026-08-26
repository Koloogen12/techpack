import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { CostLedger, SeamsterlyError, defined, type Logger } from '@seamsterly/core';
import {
  CATEGORY_LABEL_RU,
  FIT_INTENT_LABEL_RU,
  kb,
  type Category,
  type KnowledgeBase,
} from '@seamsterly/kb';
import {
  buildStyleSpec,
  photoRatiosFrom,
  type PatternPlacementInput,
  scaleAdvice,
  suggestViews,
  viewAdviceNotes,
  type StyleSpecInput,
} from '@seamsterly/assembly';
import { specFingerprint, type ColorwaySwatch, type StyleSpec } from '@seamsterly/stylespec';
import {
  FileVisionCache,
  analyzePhotos,
  defaultModel,
  type Photo,
  type PhotoFormat,
  type VisionReport,
} from '@seamsterly/vision';
import { PHOTO_VIEWS, type PhotoView } from '@seamsterly/kb';
import { chromium, type Browser } from 'playwright';
import {
  fitImage,
  renderPdf,
  renderRolePdfs,
  type DocImage,
  type DocVisuals,
  type ExportRole,
} from '@seamsterly/docgen';
import { FileRenderCache, visualize } from '@seamsterly/render';
import { readSwatch } from '@seamsterly/pattern';
import type { Locale } from '@seamsterly/i18n';
import { ArtworkLibrary } from '@seamsterly/library';
import { diffSpecs, VersionStore } from '@seamsterly/versions';
import {
  findTemplate,
  notePromotion,
  proposeTemplates,
  readTemplateSvg,
  renderChosenTemplate,
  templateLibraryExists,
} from '@seamsterly/templates';
import { messages } from '@seamsterly/i18n';
import { answersFingerprint, parseAnswers, type Answers } from './answers.js';

/** Кандидат в силуэт — то, что видит человек в микрошаге мастера. */
export interface TemplateCandidateView {
  id: string;
  /** Почему шаблон попал в список: читаемые причины из скоринга. */
  reasons: readonly string[];
  score: number;
  /** Путь к превью — мастер показывает картинку, терминал печатает путь. */
  preview: string | null;
}

/**
 * Пайплайн генерации техпака целиком.
 *
 * Одна недетерминированная стадия (разбор фотографий) и дальше только чистые
 * функции: сборка спеки, чертёж, документ. Поэтому повторный прогон того же
 * входа даёт тот же результат — не потому что модель стабильна, а потому что
 * её ответ закэширован по содержимому входа (ADR-0003).
 */

const FORMATS: Record<string, PhotoFormat> = {
  '.jpg': 'jpg',
  '.jpeg': 'jpeg',
  '.png': 'png',
  '.gif': 'gif',
  '.webp': 'webp',
};

export interface GenerateOptions {
  answersPath: string;
  photoPaths: readonly string[];
  outPath: string;
  /** Дополнительные выгрузки по ролям цеха. */
  roles?: readonly ExportRole[];
  /** Сохранить StyleSpec рядом с документом — вход для отладки и голден-сета. */
  writeSpec?: boolean;
  cacheDir?: string;
  /**
   * Разрешить обращение к сервису визуализации.
   *
   * По умолчанию выключено: это платный внешний вызов, а молча тратить
   * деньги пользователя нельзя. Кэш при этом читается всегда — повторная
   * сборка того же изделия получает картинку бесплатно.
   */
  render?: boolean;
  renderCacheDir?: string;
  /**
   * Где искать файл тайла раппорта. По умолчанию — библиотека бренда:
   * рисунок живёт там, а не рядом с конкретным паком.
   */
  tileDir?: string;
  /** Где лежат образцы полотна. По умолчанию рядом с артами бренда. */
  swatchDir?: string;
  /**
   * Каталог истории версий. Задан — пак сравнивается с прошлой версией,
   * получает лист изменений и сохраняется новой версией.
   *
   * Только по явной просьбе: концьерж пересобирает документ на ходу, и каждая
   * пересборка не должна превращаться в новую версию для фабрики.
   */
  versionsDir?: string;
  /**
   * Языки фабричного комплекта помимо русского.
   *
   * Отдельными файлами, а не листами внутри одного: фабрика печатает пак
   * и раскладывает по цеху, и лист на чужом языке в этой пачке просто
   * не прочтут.
   */
  langs?: readonly Locale[];
  /**
   * Сообщение о смене стадии. Нужно веб-очереди: человек на созвоне ждёт
   * десятки секунд, и «идёт генерация» без деталей читается как зависание.
   * Стадии настоящие, а не декоративные — то же деление, что в отчёте
   * себестоимости.
   */
  onStage?: (stage: 'vision' | 'assembly' | 'render' | 'docgen', detail?: string) => void;
  /**
   * Силуэт из библиотеки моделей вместо параметрического чертежа.
   *
   * «ask» — подобрать и спросить, какой ближе; идентификатор — взять
   * названный. Пусто — строим чертёж сами: он единственный, у которого
   * правка замера перестраивает геометрию, а выноски указывают на
   * размеченные точки.
   */
  template?: string;
  /**
   * Как задать вопрос про силуэт. Возвращает выбранный идентификатор или
   * null, если пользователь остался с параметрическим чертежом.
   *
   * Передаётся снаружи: конвейер не знает, кто его спрашивает — терминал,
   * мастер в браузере или тест.
   */
  askTemplate?: (candidates: readonly TemplateCandidateView[]) => Promise<string | null>;
  model?: string;
  logger?: Logger;
  kb?: KnowledgeBase;
  /** Момент генерации. Передаётся снаружи, чтобы прогон оставался чистым. */
  now?: Date;
}

export interface GenerateResult {
  spec: StyleSpec;
  /** Отпечаток содержимого. Совпадение при одинаковом входе — критерий приёмки. */
  fingerprint: string;
  pdfPath: string;
  rolePaths: { role: ExportRole; path: string }[];
  /** Фабричные комплекты на других языках. */
  langPaths: { locale: Locale; path: string }[];
  specPath: string | null;
  vision: { used: boolean; fromCache: boolean; cacheKey: string | null };
  /** Визуализация изделия. Её отсутствие документ не ломает. */
  visual: { used: boolean; fromCache: boolean; reason: string | null };
  notes: string[];
  /**
   * Силуэт из библиотеки, если чертёж собран из него.
   *
   * Исходники силуэта кладутся рядом с документом и уходят бренду вместе
   * с ним: лицензия датасета это разрешает, а техпак без исходного вектора
   * заставляет фабрику перерисовывать чертёж с растра.
   */
  template: { id: string; sources: string[] } | null;
  cost: { usd: number; ms: number; stages: readonly { stage: string; usd: number; ms: number }[] };
}

/**
 * Ракурс из имени файла.
 *
 * Явное объявление всегда сильнее, но в concierge-режиме файлы называем мы
 * сами, и `hoodie-back.png` не должен требовать отдельного флага. Угадывание
 * намеренно узкое: совпадение по целому слову, иначе `frontier.jpg` стал бы
 * видом спереди.
 */
const VIEW_ALIASES: Record<string, PhotoView> = {
  front: 'front_flat',
  перед: 'front_flat',
  back: 'back_flat',
  спинка: 'back_flat',
  neck: 'detail_neck',
  горловина: 'detail_neck',
  hem: 'detail_hem',
  низ: 'detail_hem',
  sleeve: 'detail_sleeve',
  рукав: 'detail_sleeve',
  inside: 'inside_out',
  изнанка: 'inside_out',
  form: 'on_form',
  фигура: 'on_form',
};

export function viewFromName(path: string): PhotoView | undefined {
  const words = basename(path)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u);
  for (const w of words) {
    const view = VIEW_ALIASES[w];
    if (view) return view;
  }
  return undefined;
}

/** Разбор `front:file.jpg`. Без префикса — угадывание по имени файла. */
export function parsePhotoArg(arg: string): { path: string; view?: PhotoView } {
  const at = arg.indexOf(':');
  const head = at > 0 ? arg.slice(0, at) : '';
  const rest = arg.slice(at + 1);

  // Двоеточие бывает не только в префиксе ракурса. Диск Windows — одна буква
  // перед ним; схема URL — две косые черты после. Ни то ни другое не должно
  // ни распознаваться как ракурс, ни падать с ошибкой про ракурс: первая
  // версия этой функции честно отвергала https как неизвестный ракурс.
  const looksLikePrefix = head.length > 1 && !rest.startsWith('//') && /^[a-zа-яё_]+$/i.test(head);

  if (looksLikePrefix) {
    if (PHOTO_VIEWS.includes(head as PhotoView)) return { path: rest, view: head as PhotoView };
    const alias = VIEW_ALIASES[head.toLowerCase()];
    if (alias) return { path: rest, view: alias };

    // Опечатка в названии ракурса, проглоченная молча, означает разбор
    // спинки по кадру переда. Лучше остановиться и сказать.
    throw new SeamsterlyError('PHOTO_UNUSABLE', `неизвестный ракурс: ${head}`, {
      userMessage: `Не знаем ракурс «${head}».`,
      userAction: `Доступны: ${PHOTO_VIEWS.join(', ')} — или пишите путь без префикса`,
      details: { view: head },
    });
  }

  const guessed = viewFromName(arg);
  return guessed ? { path: arg, view: guessed } : { path: arg };
}

export function readPhoto(path: string, view?: PhotoView): Photo {
  const format = FORMATS[extname(path).toLowerCase()];
  if (!format) {
    throw new SeamsterlyError('PHOTO_UNUSABLE', `неподдерживаемый формат файла: ${path}`, {
      userMessage: `Формат файла «${basename(path)}» мы не читаем.`,
      userAction: `Загрузите изображение в формате ${Object.keys(FORMATS).join(', ')}`,
      details: { path },
    });
  }
  return {
    bytes: readFileSync(path),
    format,
    label: basename(path),
    ...(view ? { view } : {}),
  };
}

/**
 * Чтение файла ответов.
 *
 * Отсутствующий файл и битый JSON — самые частые ошибки concierge-режима,
 * и отвечать на них системным ENOENT значит перекладывать разбор на человека.
 */
function readAnswers(path: string): Answers {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new SeamsterlyError('SPEC_INVALID', `файл ответов не найден: ${path}`, {
      userMessage: `Не нашли файл анкеты «${basename(path)}».`,
      userAction: 'Проверьте путь к файлу и повторите',
      details: { path },
      cause,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new SeamsterlyError('SPEC_INVALID', `файл ответов не является JSON: ${path}`, {
      userMessage: `Файл анкеты «${basename(path)}» повреждён: это не JSON.`,
      userAction: 'Проверьте файл в редакторе — скорее всего пропущена запятая или скобка',
      details: { path },
      cause,
    });
  }

  return parseAnswers(parsed);
}

const PHOTO_MIME: Record<PhotoFormat, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

/**
 * Картинки для страницы «Внешний вид».
 *
 * Снимки заказчика доходят до документа впервые: раньше фотография попадала
 * в разбор и на этом её след терялся, хотя knowledge-base/01 §1 требует её
 * в обзорном разделе. Без неё фабрике не с чем сверить готовое изделие.
 *
 * Больше трёх снимков на лист не влезает, а вес растёт линейно — берём первые.
 */
/**
 * Байты тайла раппорта.
 *
 * В спеке лежит ССЫЛКА на файл, а не его содержимое (`AssetRefSchema`).
 * Нет файла — превью просто не будет, и документ от этого не сломается.
 */
function readTile(spec: StyleSpec, dir: string): Uint8Array | null {
  const allover = spec.artwork?.placements.find((a) => a.kind === 'allover');
  if (!allover?.pattern) return null;
  try {
    return readFileSync(join(dir, allover.pattern.tile_file));
  } catch {
    return null;
  }
}

/**
 * Паспорта образцов полотна по колорвеям.
 *
 * Читаются ДО сборки спеки: цвет колорвея — часть спеки, а не украшение
 * документа, и по нему строится ключ кэша визуализации. Отдельный браузер
 * поднимается только когда образцы вообще есть.
 *
 * Отсутствующий или нечитаемый файл образца НЕ ломает пак: колорвей остаётся
 * с тем цветом, который бренд вписал руками. Документ важнее картинки —
 * то же правило, что у визуализации.
 */
async function readSwatches(
  answers: Answers,
  dir: string,
): Promise<{
  swatches: Map<string, ColorwaySwatch>;
  bytes: Map<string, { bytes: Uint8Array; mediaType: string }>;
  notes: string[];
}> {
  const swatches = new Map<string, ColorwaySwatch>();
  const bytes = new Map<string, { bytes: Uint8Array; mediaType: string }>();
  const notes: string[] = [];
  const wanted = (answers.colorways ?? []).filter((c) => c.swatch);
  if (!wanted.length) return { swatches, bytes, notes };

  const browser = await chromium.launch();
  try {
    for (const c of wanted) {
      const path = join(dir, c.swatch!);
      let file: Buffer;
      try {
        file = readFileSync(path);
      } catch {
        notes.push(
          `Образец полотна «${c.swatch}» для цвета «${c.name_ru}» не найден в ${dir}. ` +
            `Цвет остался таким, каким вы его вписали.`,
        );
        continue;
      }
      const mime = /\.jpe?g$/i.test(path) ? 'image/jpeg' : 'image/png';
      const reading = await readSwatch(`data:${mime};base64,${file.toString('base64')}`, browser);
      bytes.set(c.id, { bytes: file, mediaType: mime });
      swatches.set(c.id, {
        file_name: c.swatch!,
        key: createHash('sha256').update(file).digest('hex'),
        hex: reading.hex,
        lab: { l: reading.lab[0], a: reading.lab[1], b: reading.lab[2] },
        spread_delta_e: reading.spread_delta_e,
        uniform: reading.uniform,
        verdict_ru: reading.verdict_ru,
      });
      if (!reading.uniform) {
        notes.push(`Образец «${c.name_ru}»: ${reading.verdict_ru}`);
      }
    }
  } finally {
    await browser.close();
  }
  return { swatches, bytes, notes };
}

async function buildVisuals(
  browser: Browser,
  visual: Awaited<ReturnType<typeof visualize>>,
  photoPaths: readonly string[],
  spec?: StyleSpec,
  tileBytes?: Uint8Array | null,
  patternVisual?: Awaited<ReturnType<typeof visualize>>,
  swatchBytes?: ReadonlyMap<string, { bytes: Uint8Array; mediaType: string }>,
  colorwayVisuals?: ReadonlyMap<string, Awaited<ReturnType<typeof visualize>>>,
): Promise<DocVisuals> {
  const photos: DocImage[] = [];
  for (const path of photoPaths.slice(0, 3)) {
    const photo = readPhoto(path);
    const raw = `data:${PHOTO_MIME[photo.format]};base64,${Buffer.from(photo.bytes).toString('base64')}`;
    photos.push({ dataUri: await fitImage(browser, raw), label: `Снимок · ${basename(path)}` });
  }

  const allover = spec?.artwork?.placements.find((a) => a.kind === 'allover');
  const patternTile =
    tileBytes && allover
      ? {
          dataUri: `data:image/png;base64,${Buffer.from(tileBytes).toString('base64')}`,
          repeatCm: allover.size_cm.width.value,
        }
      : undefined;

  // Образцы полотна показываются КАК ЕСТЬ, только уменьшенные под лист:
  // это снимок того, что бренд держал в руках, и подкрашивать его значило бы
  // подменить единственный вещественный вход по цвету.
  const swatches: Record<string, DocImage> = {};
  for (const [id, file] of swatchBytes ?? []) {
    const raw = `data:${file.mediaType};base64,${Buffer.from(file.bytes).toString('base64')}`;
    swatches[id] = { dataUri: await fitImage(browser, raw) };
  }

  const colorwayRenders: Record<string, DocImage> = {};
  // Первый колорвей уже нарисован основной визуализацией: промпт по умолчанию
  // берёт именно его. Платить за ту же картинку второй раз не за что.
  const first = spec?.bom?.colorways[0];
  if (first && visual.ok) colorwayRenders[first.id] = { dataUri: visual.image.dataUri };
  for (const [id, result] of colorwayVisuals ?? []) {
    if (result.ok) colorwayRenders[id] = { dataUri: result.image.dataUri };
  }

  return {
    ...(visual.ok ? { render: { dataUri: visual.image.dataUri } } : {}),
    ...(photos.length ? { photos } : {}),
    ...(patternTile ? { patternTile } : {}),
    ...(patternVisual?.ok ? { patternRender: { dataUri: patternVisual.image.dataUri } } : {}),
    ...(Object.keys(swatches).length ? { swatches } : {}),
    ...(Object.keys(colorwayRenders).length ? { colorwayRenders } : {}),
  };
}

/**
 * Сколько колорвеев показывать фотореалистично.
 *
 * Каждый — отдельная платная генерация, и десять цветов капсулы превратили бы
 * сборку пака в десять ожиданий по полминуты. Ограничение НАЗЫВАЕТСЯ вслух
 * в примечаниях: молчаливая отсечка читается как «показано всё».
 */
const COLORWAY_RENDER_LIMIT = 3;

/**
 * Вход сборщика StyleSpec из анкеты и отчёта разбора.
 *
 * Вынесено из пайплайна, потому что собирать этот объект приходится и вне
 * генерации — в скриптах голден-набора и в демонстрации протокола. Пока
 * логика была inline, скрипты собирали спеку ЧУТЬ ИНАЧЕ: без класса полотна
 * и без колорвеев с фото. Спеки расходились, кэш промахивался, и понять,
 * почему, было нельзя, потому что разница жила в двух местах сразу.
 */
/**
 * Раппорты анкеты, разрешённые через библиотеку бренда.
 *
 * В анкете достаточно имени рисунка и шага. Паспорт — пиксели, отпечаток,
 * краски, вердикт по вектору — берётся из библиотеки, а не переписывается
 * руками: перенос десятка полей между паками однажды закончится опечаткой
 * в цифре, которую никто не заметит.
 */
function resolvePatterns(answers: Answers, library: ArtworkLibrary): PatternPlacementInput[] {
  return (answers.patterns ?? []).map((p) => {
    if (p.tile) {
      return {
        tile: p.tile,
        repeat_cm: p.repeat_cm,
        ...(p.color_count === undefined ? {} : { color_count: p.color_count }),
        ...(p.color_codes === undefined ? {} : { color_codes: p.color_codes }),
      };
    }

    const asset = library.get(p.asset!);
    return {
      tile: {
        file_name: asset.file,
        pixels: asset.pixels,
        // У арта, принесённого заказчиком, отпечатка входа нет: мы его
        // не генерировали и воспроизводить не будем. Паспорт при этом
        // требует шестнадцатеричную строку, поэтому подставляем отпечаток
        // самого файла — он тоже однозначно опознаёт рисунок.
        key: asset.key ?? fileFingerprint(library.filePath(asset)),
        seam_ratio: asset.seam?.ratio ?? 0,
        seamless: asset.seam?.seamless ?? true,
        mirrored: asset.seam?.mirrored ?? false,
        colors: asset.colors,
        vector_available: asset.vector_available,
        vector_verdict_ru: asset.vector_verdict_ru,
      },
      repeat_cm: p.repeat_cm,
      ...(p.color_count === undefined ? {} : { color_count: p.color_count }),
      ...(p.color_codes === undefined ? {} : { color_codes: p.color_codes }),
    };
  });
}

function fileFingerprint(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function specInputFrom(
  answers: Answers,
  report: VisionReport | null,
  options: {
    now: Date;
    visionCacheKey?: string;
    library?: ArtworkLibrary;
    swatches?: ReadonlyMap<string, ColorwaySwatch>;
  } = { now: new Date() },
): StyleSpecInput {
  // `patterns` из анкеты в спред НЕ идут: там они описаны ссылкой на
  // библиотеку либо неполным паспортом, а движку нужен полный. Разрешаются
  // ниже отдельным шагом.
  const { patterns: _patterns, colorways: _colorways, ...rest } = answers;

  return {
    ...defined(rest),
    ...(report ? { photo_ratios: photoRatiosFrom(report.proportions) } : {}),
    ...(report ? { visible_elements: report.visible_elements } : {}),
    ...(report ? { topstitching: report.topstitching } : {}),
    // Предмет известного размера в кадре: единственное, что снимает
    // монокулярную неоднозначность масштаба.
    ...(report ? { scale: report.scale_object } : {}),
    ...(report?.fabric.knit_class && report.fabric.knit_class !== 'unknown'
      ? { fabric_class: report.fabric.knit_class, fabric_confidence: report.fabric.confidence }
      : {}),
    // Колорвеи: из анкеты, если бренд их назвал, иначе с фотографий.
    // Паспорт образца подмешивается сюда же — цвет колорвея часть спеки,
    // а не украшение документа.
    ...(answers.colorways?.length
      ? {
          colorways: answers.colorways.map((c) =>
            defined({
              id: c.id,
              name_ru: c.name_ru,
              hex_approx: c.hex_approx,
              swatch: options.swatches?.get(c.id) ?? null,
              book_code: c.book_code ?? null,
              book_source: c.book_code ? ('brand' as const) : null,
            }),
          ),
        }
      : report?.colorways.length
        ? {
            colorways: report.colorways.map((c, i) =>
              defined({ id: `c${i + 1}`, name_ru: c.name_ru, hex_approx: c.hex_approx }),
            ),
          }
        : {}),
    // Раппорты разрешаются здесь же: и пайплайн, и скрипты голден-набора
    // должны видеть одинаковую спеку, а не каждый свою.
    ...(answers.patterns?.length
      ? { patterns: resolvePatterns(answers, options.library ?? new ArtworkLibrary()) }
      : {}),
    generated_at: options.now,
    ...(options.visionCacheKey ? { vision_cache_key: options.visionCacheKey } : {}),
  };
}

export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const ledger = new CostLedger();
  const base = options.kb ?? kb();
  const answers = readAnswers(options.answersPath);

  // --- 1. Разбор фотографий (единственная недетерминированная стадия) ----------
  let report: VisionReport | null = null;
  let cacheKey: string | null = null;
  let fromCache = false;

  const shots = options.photoPaths.map(parsePhotoArg);

  if (shots.length > 0) {
    options.onStage?.('vision', `снимков: ${shots.length}`);
    const result = await analyzePhotos({
      photos: shots.map((s) => readPhoto(s.path, s.view)),
      category: answers.category,
      answersFingerprint: answersFingerprint(answers),
      model: options.model ?? defaultModel(),
      cache: new FileVisionCache(options.cacheDir ?? '.cache/vision'),
      kb: base,
      ledger,
      ...(options.logger ? { logger: options.logger } : {}),
    });
    report = result.report;
    cacheKey = result.cacheKey;
    fromCache = result.fromCache;
  }

  const gate = categoryGate(answers, report);
  if (gate) throw gate;

  // Образцы полотна читаются до сборки: цвет колорвея — часть спеки.
  const swatchResult = await readSwatches(answers, options.swatchDir ?? 'brand-library/swatches');

  // --- 2. Сборка StyleSpec (детерминированная) --------------------------------
  options.onStage?.('assembly');
  const assemblyStart = performance.now();
  const { spec, notes } = buildStyleSpec(
    specInputFrom(answers, report, {
      now: options.now ?? new Date(),
      ...(cacheKey ? { visionCacheKey: cacheKey } : {}),
      swatches: swatchResult.swatches,
    }),
    base,
  );
  ledger.recordFree('assembly', Math.round(performance.now() - assemblyStart));

  notes.push(...swatchResult.notes);

  if (report) {
    notes.push(...reconcile(answers, report, base));
    notes.push(...visionNotes(report));
    // Совет по досъёмке считается ПО ФАКТУ собранного документа: какие точки
    // остались слабыми и какой недостающий кадр их закроет. Это единственный
    // способ поднять точность, который не стоит человеку ни денег, ни ожидания.
    notes.push(
      ...viewAdviceNotes(
        suggestViews(
          spec,
          shots.map((s) => s.view),
          base,
        ).slice(0, 2),
      ),
    );
    notes.push(
      ...scaleAdvice(
        spec.measurements.points.some((p) => p.base.confidence === 'measured_by_scale'),
        base,
      ),
    );
  }

  // --- 3. Визуализация и документ ---------------------------------------------
  // Один браузер на весь прогон: его запуск занимает секунды, а выгрузок
  // по ролям может быть пять. Раньше поднималось по браузеру на каждую.
  //
  // Картинка генерируется ПАРАЛЛЕЛЬНО запуску браузера: сервис отвечает
  // десятками секунд, и ждать его последовательно значит дарить эти секунды.
  mkdirSync(dirname(options.outPath), { recursive: true });

  const renderCache = new FileRenderCache(options.renderCacheDir ?? '.cache/render');
  const visualOptions = {
    cache: renderCache,
    offline: options.render !== true,
    base,
    ledger,
    ...(options.logger ? { logger: options.logger } : {}),
  };

  // Тайл раппорта нужен обеим страницам: размерно точной раскладке
  // на схеме нанесения и фотореалистичному превью. Читается один раз.
  const tileBytes = readTile(spec, options.tileDir ?? 'brand-library/artwork');

  // Опорное изображение по колорвею: образец полотна, если бренд его прислал.
  // Цвет с картинки точнее и названия, и hex — hex это цвет на экране,
  // а не цвет ткани.
  const swatchRef = (
    id: string | undefined,
  ): { references: [{ bytes: Uint8Array; mediaType: string }]; swatchReference: true } | object => {
    const file = id ? swatchResult.bytes.get(id) : undefined;
    return file ? { references: [file], swatchReference: true as const } : {};
  };

  const colorways = spec.bom?.colorways ?? [];
  // Первый колорвей рисует основная визуализация — промпт по умолчанию берёт
  // именно его. Остальные идут отдельными вызовами, и их число ограничено.
  const extraColorways = colorways.slice(1, COLORWAY_RENDER_LIMIT);
  if (colorways.length > COLORWAY_RENDER_LIMIT) {
    notes.push(
      `Колорвеев ${colorways.length}, фотореалистично показаны первые ` +
        `${COLORWAY_RENDER_LIMIT}: каждая визуализация — отдельная генерация. ` +
        `Чертёж в цвете на листе колорвеев построен для всех.`,
    );
  }

  options.onStage?.('render');
  const [browser, visual, patternVisual, ...extraVisuals] = await Promise.all([
    chromium.launch(),
    visualize(spec, { ...visualOptions, ...swatchRef(colorways[0]?.id) }),
    // Вторая картинка — то же изделие, но в раппорте. Отдельный вызов,
    // а не вариант первого: у них разные ключи кэша и разная судьба
    // в ролевых выгрузках.
    tileBytes
      ? visualize(spec, {
          ...visualOptions,
          references: [{ bytes: tileBytes, mediaType: 'image/png' }],
        })
      : Promise.resolve<Awaited<ReturnType<typeof visualize>>>({
          ok: false,
          reason: 'no_tile',
          userMessage: 'Раппорта в документе нет.',
        }),
    ...extraColorways.map((c) =>
      visualize(spec, { ...visualOptions, colorwayId: c.id, ...swatchRef(c.id) }),
    ),
  ]);

  const colorwayVisuals = new Map(extraColorways.map((c, i) => [c.id, extraVisuals[i]!]));

  // --- История версий -------------------------------------------------------
  // Прошлая версия НЕ переписывается: спор с фабрикой разрешается сверкой
  // с тем файлом, который ей прислали (ADR-0001 §4).
  let changes:
    { from_version: number; to_version: number; diff: ReturnType<typeof diffSpecs> } | undefined;
  let versionNote: string | null = null;
  if (options.versionsDir) {
    const store = new VersionStore(options.versionsDir);
    const previous = store.latest(spec.style.article);
    const entry = store.save(
      spec.style.article,
      spec,
      previous ? 'пересборка документа' : 'первая сборка',
    );
    if (previous && entry) {
      changes = {
        from_version: previous.entry.n,
        to_version: entry.n,
        diff: diffSpecs(previous.spec, spec),
      };
      versionNote = `Версия ${entry.n}: ${changes.diff.points.length} изменений против версии ${previous.entry.n}.`;
    } else if (previous) {
      versionNote = `Содержание совпало с версией ${previous.entry.n} — новая версия не создана.`;
    } else if (entry) {
      versionNote = `Версия ${entry.n} — первая.`;
    }
    if (versionNote) notes.push(versionNote);
  }

  const rolePaths: { role: ExportRole; path: string }[] = [];
  const langPaths: { locale: Locale; path: string }[] = [];
  let usedTemplate: { id: string; sources: string[] } | null = null;

  // Отсчёт сборки документа начинается ПОСЛЕ ожидания картинки. Иначе
  // ожидание стороннего сервиса записывается в docgen, суммарное время
  // стадий превышает время прогона, и отчёт по себестоимости врёт вдвое.
  const renderStart = performance.now();
  options.onStage?.('docgen');

  try {
    const built = await buildVisuals(
      browser,
      visual,
      shots.map((s) => s.path),
      spec,
      tileBytes,
      patternVisual,
      swatchResult.bytes,
      colorwayVisuals,
    );
    // Силуэт из библиотеки подбирается ПОСЛЕ сборки спеки: масштаб ему
    // задаёт табель мер, а не наоборот. Отчёт зрения идёт следом только
    // как источник деталей — карман и рукав в табеле не записаны.
    const library = await chooseLibraryFlat(spec, options, report ?? undefined, notes);
    if (library) usedTemplate = shipTemplateSources(library.templateId, options.outPath);
    const visuals: DocVisuals = { ...built, ...(library ? { libraryFlats: library } : {}) };
    if (!visual.ok && options.render === true) notes.push(`Визуализация: ${visual.userMessage}`);

    const docOptions = { pro: true, browser, visuals, ...(changes ? { changes } : {}) };
    writeFileSync(options.outPath, await renderPdf(spec, docOptions));

    // Фабричные комплекты на других языках.
    for (const locale of new Set(options.langs ?? [])) {
      if (locale === 'ru') continue;
      const path = options.outPath.replace(/\.pdf$/i, `--${locale}.pdf`);
      writeFileSync(path, await renderPdf(spec, { ...docOptions, locale }));
      langPaths.push({ locale, path });
    }

    if (options.roles?.length) {
      const stem = options.outPath.replace(/\.pdf$/i, '');
      // Повторы ролей отбрасываем: два одинаковых файла никому не нужны.
      const roles = [...new Set(options.roles)];
      for (const { role, pdf } of await renderRolePdfs(spec, roles, browser, visuals, changes)) {
        const path = `${stem}--${role}.pdf`;
        writeFileSync(path, pdf);
        rolePaths.push({ role, path });
      }
    }
  } finally {
    await browser.close();
  }
  ledger.recordFree('docgen', Math.round(performance.now() - renderStart));

  let specPath: string | null = null;
  if (options.writeSpec) {
    specPath = join(
      dirname(options.outPath),
      `${basename(options.outPath, '.pdf')}.stylespec.json`,
    );
    writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n');
  }

  // Отмечаем в библиотеке, что рисунок ушёл в этот пак. Правка арта
  // после этого тронет все перечисленные изделия, и человек должен
  // увидеть их список раньше, чем нажмёт «перегенерировать».
  for (const p of answers.patterns ?? []) {
    if (p.asset) {
      try {
        new ArtworkLibrary().markUsed(p.asset, spec.style.article);
      } catch {
        // Библиотека недоступна — документ от этого не страдает.
      }
    }
  }

  return {
    spec,
    fingerprint: specFingerprint(spec),
    pdfPath: options.outPath,
    rolePaths,
    specPath,
    langPaths,
    vision: { used: report !== null, fromCache, cacheKey },
    visual: {
      used: visual.ok,
      fromCache: visual.ok ? visual.image.cached : false,
      reason: visual.ok ? null : visual.reason,
    },
    notes,
    template: usedTemplate,
    cost: ledger.summary(),
  };
}

/**
 * Категорийный гейт.
 *
 * Если фотографии показывают изделие вне трикотажного ядра, мы честно
 * отказываемся вместо того, чтобы выдать документ похуже (ux/00, слабость №18).
 * Отказ — продуктовое решение, а не ошибка: плохой техпак стоит фабрике партии.
 */
function categoryGate(answers: Answers, report: VisionReport | null): SeamsterlyError | null {
  if (!report) return null;
  if (report.category.value !== 'other') return null;
  // Низкая уверенность модели в «это другое» — повод довериться человеку.
  if (report.category.confidence === 'low') return null;

  return new SeamsterlyError(
    'CATEGORY_UNSUPPORTED',
    `vision определил категорию как other: ${report.category.other_description}`,
    {
      // Подстановка идёт в кавычках и в именительном падеже — так фраза
      // остаётся грамотной при любой категории, без склонения в шаблоне.
      userMessage:
        `Категория на фото не совпадает с указанной. Вы выбрали ` +
        `«${CATEGORY_LABEL_RU[answers.category]}», но снимок показывает другое изделие. ` +
        `Мы делаем техпаки только для трикотажного ядра: футболка, лонгслив, свитшот, ` +
        `худи — для остального документ вышел бы хуже, чем нужно фабрике. ` +
        `Что увидела модель: ${report.category.other_description}`,
      userAction: 'Загрузите фото изделия подходящей категории или запишитесь в лист ожидания',
      details: { detected: report.category.other_description },
    },
  );
}

/**
 * Сверка того, что видно на фото, с тем, что указал пользователь.
 *
 * Мастер в интерфейсе показывает автоопределение как подтверждение:
 * «Похоже, это худи — верно?» (ux/02, Э3 шаг 2). В concierge-режиме экрана
 * нет, поэтому расхождение обязано попасть в отчёт словами.
 *
 * Молчать здесь опаснее всего: пользователь получит документ на футболку
 * по фотографии худи и заметит это на фабрике.
 */
function reconcile(answers: Answers, report: VisionReport, base: KnowledgeBase): string[] {
  const notes: string[] = [];
  const label = (c: string): string => CATEGORY_LABEL_RU[c as Category] ?? c;

  if (
    report.category.value !== 'other' &&
    report.category.value !== answers.category &&
    report.category.confidence !== 'low'
  ) {
    notes.push(
      `Расхождение по категории: вы указали «${label(answers.category)}», а на фото ` +
        `похоже на «${label(report.category.value)}» (уверенность ${report.category.confidence}). ` +
        `Документ собран по вашему ответу. Если ошиблись — поменяйте категорию и повторите: ` +
        `набор точек измерения и узлов у категорий разный.`,
    );
  }

  if (!report.fabric.is_knit && answers.fabric_kind === 'knit') {
    notes.push(
      'Расхождение по материалу: вы указали трикотаж, а на фото похоже на ткань. ' +
        'От этого зависят допуски, узлы обработки и градация — проверьте по образцу.',
    );
  }

  if (report.silhouette.value !== answers.fit_intent && report.silhouette.confidence === 'high') {
    notes.push(
      `Расхождение по посадке: вы указали «${FIT_INTENT_LABEL_RU[answers.fit_intent]}», ` +
        `а на фото читается «${FIT_INTENT_LABEL_RU[report.silhouette.value]}». Посадка задаёт ` +
        `прибавку и ширину всего изделия — если правы вы, ничего делать не нужно.`,
    );
  }

  // Наблюдения по признакам, которых нет в нашей карте видимости, — это
  // подсказка, чего справочнику не хватает. Она уходит в отчёт, а не в никуда.
  const known = new Set(base.visibilityMap().not_visible.map((f) => f.key));
  const unknown = report.not_visible.filter((f) => !known.has(f.key)).map((f) => f.key);
  if (unknown.length) {
    notes.push(
      `Модель отметила как невидимые признаки, которых нет в нашем справочнике: ` +
        `${unknown.join(', ')}. Это кандидаты в карту видимости.`,
    );
  }

  return notes;
}

/** Замечания vision-этапа, которые обязан увидеть человек. */
function visionNotes(report: VisionReport): string[] {
  const notes: string[] = [];

  if (report.photo_quality_notes.length) {
    notes.push(
      `Замечания к съёмке (${report.photo_quality_notes.length}): ` +
        report.photo_quality_notes.join(' · '),
    );
  }

  const weak = report.proportions.filter((p) => p.confidence === 'low');
  if (weak.length) {
    notes.push(
      `Пропорции с низкой уверенностью: ${weak.map((p) => p.pom_code).join(', ')}. ` +
        `Эти замеры стоит подтвердить по образцу.`,
    );
  }

  if (report.not_visible.length) {
    notes.push(
      `Не видно на снимках: ${report.not_visible.length} параметров — они попали в документ ` +
        `предположениями с пометкой «уточнить».`,
    );
  }

  return notes;
}

/**
 * Выбор библиотечного силуэта для листа чертежа.
 *
 * Возвращает null во всех спорных случаях — и это правильный ответ по
 * умолчанию. Параметрический чертёж строится по табелю и несёт выноски;
 * библиотечный только масштабируется. Подменять первое вторым можно лишь
 * когда об этом попросили и когда подмена не искажает пропорции.
 */
async function chooseLibraryFlat(
  spec: StyleSpec,
  options: GenerateOptions,
  report: VisionReport | undefined,
  notes: string[],
): Promise<DocVisuals['libraryFlats']> {
  if (!options.template) return undefined;
  if (!templateLibraryExists()) {
    notes.push('Библиотека силуэтов не собрана — чертёж построен параметрически.');
    return undefined;
  }

  const t = messages('ru');
  const point = (code: string, fallback: number): number =>
    spec.measurements.points.find((p) => p.code === code)?.base.value ?? fallback;
  const chestFlatCm = point('T03', 51);
  const lengthCm = point('T01', 70);

  let id = options.template === 'ask' ? null : options.template;

  if (!id) {
    const choice = proposeTemplates(spec, report ? { report } : {});
    if (choice.candidates.length === 0) {
      notes.push('Библиотека не предложила силуэта — чертёж построен параметрически.');
      return undefined;
    }
    // Уверенный подбор берём молча только если спрашивать некому: иначе
    // вопрос стоит одного клика, а ошибка — целого техпака.
    if (!options.askTemplate) {
      id = choice.confident ? choice.candidates[0]!.entry.id : null;
      if (!id) notes.push('Силуэт из библиотеки не выбран однозначно — чертёж построен параметрически.');
    } else {
      id = await options.askTemplate(
        choice.candidates.map((c) => ({
          id: c.entry.id,
          reasons: c.reasons,
          score: c.score,
          preview: c.entry.preview,
        })),
      );
    }
  }
  if (!id) return undefined;

  const rendered = renderChosenTemplate(id, {
    chestFlatCm,
    lengthCm,
    disclaimer: t.flats_library_disclaimer,
    viewLabels: { front: t.view_front, back: t.view_back },
  });
  if (!rendered) {
    notes.push(
      `Силуэт «${id}» не подошёл по пропорциям к табелю мер — чертёж построен параметрически.`,
    );
    return undefined;
  }

  // Отметка о выборе — очередь на разметку контрольных точек: силуэт,
  // который выбирают чаще прочих, заслуживает переезда в мастера.
  notePromotion(rendered.templateId);
  return {
    front: rendered.front,
    ...(rendered.back ? { back: rendered.back } : {}),
    templateId: rendered.templateId,
  };
}

/**
 * Исходники силуэта — рядом с документом.
 *
 * Лицензия датасета разрешает отдавать бренду сам вектор, и это не мелочь:
 * техпак без исходного чертежа заставляет фабрику обводить растр, теряя
 * ровно ту точность, ради которой пак и собирался. Копия кладётся в тот же
 * каталог, что и PDF, — значит уходит вместе с ним.
 */
function shipTemplateSources(
  templateId: string,
  outPath: string,
): { id: string; sources: string[] } | null {
  const entry = findTemplate(templateId);
  if (!entry) return null;
  const dir = dirname(outPath);
  const sources: string[] = [];
  for (const view of ['front', 'back'] as const) {
    const svg = readTemplateSvg(entry, view);
    if (!svg) continue;
    const path = join(dir, `flat-${view}.svg`);
    writeFileSync(path, svg);
    sources.push(path);
  }
  return sources.length ? { id: templateId, sources } : null;
}
