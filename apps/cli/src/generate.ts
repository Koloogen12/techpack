import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { CostLedger, SpecFormError, type Logger } from '@specform/core';
import { kb, type KnowledgeBase } from '@specform/kb';
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

export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const ledger = new CostLedger();
  const base = options.kb ?? kb();
  const answers = parseAnswers(JSON.parse(readFileSync(options.answersPath, 'utf8')));

  // --- 1. Разбор фотографий (единственная недетерминированная стадия) ----------
  let report: VisionReport | null = null;
  let cacheKey: string | null = null;
  let fromCache = false;

  if (options.photoPaths.length > 0) {
    const result = await analyzePhotos({
      photos: options.photoPaths.map(readPhoto),
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

  if (report) notes.push(...visionNotes(report));

  // --- 3. Документ -------------------------------------------------------------
  const renderStart = performance.now();
  mkdirSync(dirname(options.outPath), { recursive: true });
  writeFileSync(options.outPath, await renderPdf(spec, { pro: true }));

  const rolePaths: { role: ExportRole; path: string }[] = [];
  if (options.roles?.length) {
    const stem = options.outPath.replace(/\.pdf$/i, '');
    for (const { role, pdf } of await renderRolePdfs(spec, options.roles)) {
      const path = `${stem}--${role}.pdf`;
      writeFileSync(path, pdf);
      rolePaths.push({ role, path });
    }
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
      userMessage:
        `Похоже, на фото не ${answers.category}. ${report.category.other_description} ` +
        `Пока мы делаем техпаки только для трикотажного ядра: футболка, лонгслив, свитшот, худи. ` +
        `Для остального результат был бы хуже, чем нужно фабрике.`,
      userAction: 'Загрузите фото изделия подходящей категории или запишитесь в лист ожидания',
      details: { detected: report.category.other_description },
    },
  );
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
