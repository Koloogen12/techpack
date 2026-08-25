import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { CostLedger, SpecFormError, type Logger } from '@specform/core';
import {
  CATEGORY_LABEL_RU,
  FIT_INTENT_LABEL_RU,
  kb,
  type Category,
  type KnowledgeBase,
} from '@specform/kb';
import { buildStyleSpec, photoRatiosFrom } from '@specform/assembly';
import { specFingerprint, type StyleSpec } from '@specform/stylespec';
import {
  FileVisionCache,
  analyzePhotos,
  defaultModel,
  type Photo,
  type PhotoFormat,
  type VisionReport,
} from '@specform/vision';
import { chromium } from 'playwright';
import { renderPdf, renderRolePdfs, type ExportRole } from '@specform/docgen';
import { answersFingerprint, parseAnswers, type Answers } from './answers.js';

/**
 * Пайплайн генерации техпака целиком.
 *
 * Одна недетерминированная стадия (разбор фотографий) и дальше только чистые
 * функции: сборка спеки, чертёж, документ. Поэтому повторный прогон того же
 * входа даёт тот же результат — не потому что модель стабильна, а потому что
 * её ответ закэширован по содержимому входа (ADR-0003).
 */

/**
 * Убирает ключи со значением undefined.
 *
 * Нужно из-за exactOptionalPropertyTypes: в этом режиме «поля нет» и «поле
 * равно undefined» — разные вещи, и разложить объект с необязательными полями
 * в тип с необязательными полями напрямую нельзя. Правило строгое намеренно:
 * оно ловит опечатки в именах полей, а не только этот случай.
 */
type Defined<T> = { [K in keyof T]: Exclude<T[K], undefined> };

function defined<T extends object>(o: T): Defined<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Defined<T>;
}

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
  specPath: string | null;
  vision: { used: boolean; fromCache: boolean; cacheKey: string | null };
  notes: string[];
  cost: { usd: number; ms: number; stages: readonly { stage: string; usd: number; ms: number }[] };
}

export function readPhoto(path: string): Photo {
  const format = FORMATS[extname(path).toLowerCase()];
  if (!format) {
    throw new SpecFormError('PHOTO_UNUSABLE', `неподдерживаемый формат файла: ${path}`, {
      userMessage: `Формат файла «${basename(path)}» мы не читаем.`,
      userAction: `Загрузите изображение в формате ${Object.keys(FORMATS).join(', ')}`,
      details: { path },
    });
  }
  return { bytes: readFileSync(path), format, label: basename(path) };
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
    throw new SpecFormError('SPEC_INVALID', `файл ответов не найден: ${path}`, {
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
    throw new SpecFormError('SPEC_INVALID', `файл ответов не является JSON: ${path}`, {
      userMessage: `Файл анкеты «${basename(path)}» повреждён: это не JSON.`,
      userAction: 'Проверьте файл в редакторе — скорее всего пропущена запятая или скобка',
      details: { path },
      cause,
    });
  }

  return parseAnswers(parsed);
}

export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const ledger = new CostLedger();
  const base = options.kb ?? kb();
  const answers = readAnswers(options.answersPath);

  // --- 1. Разбор фотографий (единственная недетерминированная стадия) ----------
  let report: VisionReport | null = null;
  let cacheKey: string | null = null;
  let fromCache = false;

  if (options.photoPaths.length > 0) {
    const result = await analyzePhotos({
      photos: options.photoPaths.map(readPhoto),
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

  // --- 2. Сборка StyleSpec (детерминированная) --------------------------------
  const assemblyStart = performance.now();
  const { spec, notes } = buildStyleSpec(
    {
      ...defined(answers),
      ...(report ? { photo_ratios: photoRatiosFrom(report.proportions) } : {}),
      ...(report ? { visible_elements: report.visible_elements } : {}),
      ...(report ? { topstitching: report.topstitching } : {}),
      ...(report?.fabric.knit_class && report.fabric.knit_class !== 'unknown'
        ? { fabric_class: report.fabric.knit_class, fabric_confidence: report.fabric.confidence }
        : {}),
      ...(report?.colorways.length && !answers.colorways
        ? {
            colorways: report.colorways.map((c, i) =>
              defined({ id: `c${i + 1}`, name_ru: c.name_ru, hex_approx: c.hex_approx }),
            ),
          }
        : {}),
      generated_at: options.now ?? new Date(),
      ...(cacheKey ? { vision_cache_key: cacheKey } : {}),
    },
    base,
  );
  ledger.recordFree('assembly', Math.round(performance.now() - assemblyStart));

  if (report) {
    notes.push(...reconcile(answers, report, base));
    notes.push(...visionNotes(report));
  }

  // --- 3. Документ -------------------------------------------------------------
  // Один браузер на весь прогон: его запуск занимает секунды, а выгрузок
  // по ролям может быть пять. Раньше поднималось по браузеру на каждую.
  const renderStart = performance.now();
  mkdirSync(dirname(options.outPath), { recursive: true });
  const browser = await chromium.launch();
  const rolePaths: { role: ExportRole; path: string }[] = [];

  try {
    writeFileSync(options.outPath, await renderPdf(spec, { pro: true, browser }));

    if (options.roles?.length) {
      const stem = options.outPath.replace(/\.pdf$/i, '');
      // Повторы ролей отбрасываем: два одинаковых файла никому не нужны.
      const roles = [...new Set(options.roles)];
      for (const { role, pdf } of await renderRolePdfs(spec, roles, browser)) {
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

  return {
    spec,
    fingerprint: specFingerprint(spec),
    pdfPath: options.outPath,
    rolePaths,
    specPath,
    vision: { used: report !== null, fromCache, cacheKey },
    notes,
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
function categoryGate(answers: Answers, report: VisionReport | null): SpecFormError | null {
  if (!report) return null;
  if (report.category.value !== 'other') return null;
  // Низкая уверенность модели в «это другое» — повод довериться человеку.
  if (report.category.confidence === 'low') return null;

  return new SpecFormError(
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
