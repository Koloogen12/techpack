import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { VISION_SCHEMA_VERSION, VisionReportSchema, type VisionReport } from './report.js';
import { PROMPT_VERSION } from './prompt.js';

/**
 * Контент-адресуемый кэш vision-этапа — механизм детерминизма (ADR-0003).
 *
 * Требование «одинаковый вход → одинаковый StyleSpec» нельзя выполнить через
 * параметры модели: на актуальных моделях Claude сэмплирование не настраивается,
 * параметры удалены из API. Поэтому недетерминированная стадия вызывается ровно
 * один раз на уникальный вход, а её результат становится частью входа для всех
 * последующих — детерминированных — стадий.
 *
 * Побочная выгода: бесплатный повтор генерации после ошибки рендера или сборки
 * не тратит токены, дорогая стадия уже посчитана.
 */

export interface CacheKeyInput {
  /** SHA-256 каждой фотографии. Порядок не важен: ключ сортируется. */
  photoHashes: readonly string[];
  /**
   * Категория входит в ключ ОТДЕЛЬНЫМ полем, а не только через отпечаток
   * ответов. От неё зависит промпт: у худи спрашивают про капюшон и карман,
   * у футболки — нет. Вызывающий не должен иметь возможности про это забыть.
   */
  category: string;
  /** Отпечаток остальных ответов мастера, влияющих на промпт. */
  answersFingerprint: string;
  /**
   * Отпечаток собранного промпта этой категории. Заменяет глобальную
   * PROMPT_VERSION: правка справочника худи не обязана ронять кэш футболок.
   */
  promptFingerprint?: string;
  /**
   * Ракурсы кадров в порядке снимков. Входят в ключ ОТДЕЛЬНО от хешей файлов:
   * те же самые фотографии, объявленные другими ракурсами, — это другой
   * промпт и другой разбор.
   */
  views: readonly (string | undefined)[];
  model: string;
}

/**
 * Ключ кэша.
 *
 * Смена промпта, модели или схемы отчёта меняет ключ. Это не побочный эффект,
 * а требование: любая такая правка обязана пройти через голден-сет.
 *
 * Отпечаток промпта берётся ПО КОНКРЕТНОЙ КАТЕГОРИИ, а не глобальной
 * версией: иначе добавление пятой категории обнуляло бы кэш всех четырёх
 * прежних — и каждая новая категория стоила бы платного перепрогона всего
 * голден-сета плюс холодного старта у всех, кто уже работает.
 */
export function cacheKey(input: CacheKeyInput): string {
  const parts = [
    ...[...input.photoHashes].sort(),
    // Ракурсы НЕ сортируются: важно, какой ракурс у какого снимка по порядку.
    input.views.map((v) => v ?? '-').join(','),
    input.category,
    input.answersFingerprint,
    input.promptFingerprint ?? PROMPT_VERSION,
    input.model,
    VISION_SCHEMA_VERSION,
  ];
  return createHash('sha256').update(parts.join(' ')).digest('hex');
}

export function hashPhoto(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface VisionCache {
  get(key: string): VisionReport | undefined;
  set(key: string, report: VisionReport): void;
}

/** Кэш в памяти: тесты и одиночные прогоны. */
export class MemoryVisionCache implements VisionCache {
  private readonly store = new Map<string, VisionReport>();

  get(key: string): VisionReport | undefined {
    return this.store.get(key);
  }

  set(key: string, report: VisionReport): void {
    this.store.set(key, report);
  }
}

/**
 * Файловый кэш.
 *
 * Часть контура данных: бэкапится вместе с остальным, живёт в РФ-контуре,
 * чистится по запросу пользователя на удаление данных.
 */
export class FileVisionCache implements VisionCache {
  constructor(private readonly dir: string) {}

  private path(key: string): string {
    // Двухуровневая раскладка: тысячи файлов в одном каталоге замедляют обход.
    return join(this.dir, key.slice(0, 2), `${key}.json`);
  }

  get(key: string): VisionReport | undefined {
    let raw: string;
    try {
      raw = readFileSync(this.path(key), 'utf8');
    } catch {
      return undefined;
    }
    const parsed = VisionReportSchema.safeParse(JSON.parse(raw));
    // Битая запись равна отсутствующей: лучше пересчитать, чем отравить документ.
    return parsed.success ? parsed.data : undefined;
  }

  set(key: string, report: VisionReport): void {
    const path = this.path(key);
    mkdirSync(dirname(path), { recursive: true });
    // Запись через временный файл и переименование: два параллельных прогона
    // одного входа не должны оставить после себя обрезанный JSON, который
    // читатель примет за повреждённую запись и пересчитает за деньги.
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(report, null, 2) + '\n');
    renameSync(temp, path);
  }
}
