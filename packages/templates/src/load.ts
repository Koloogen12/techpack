import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TemplateManifestSchema, type TemplateEntry, type TemplateManifest } from './manifest.js';

/**
 * Доступ к библиотеке шаблонов.
 *
 * Пути в манифесте записаны от корня репозитория, а корень вычисляется от
 * модуля, а не от рабочего каталога: библиотеку читают и CLI, и сервер, и
 * тесты — у всех троих свой cwd, и полагаться на него значило бы работать
 * через раз.
 */

const ROOT = new URL('../../../', import.meta.url).pathname;
const MANIFEST_PATH = join(ROOT, 'packages/kb/data/templates/template_manifest.json');

let cached: TemplateManifest | null = null;

export function templateLibraryExists(): boolean {
  return existsSync(MANIFEST_PATH);
}

/**
 * Манифест целиком.
 *
 * Читается один раз за процесс: файл на несколько мегабайт, а меняется он
 * только при переносе датасета, которого в работающем сервисе не бывает.
 */
export function loadTemplateManifest(): TemplateManifest {
  if (cached) return cached;
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`библиотека шаблонов не собрана: нет ${MANIFEST_PATH}`);
  }
  cached = TemplateManifestSchema.parse(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')));
  return cached;
}

/** Только разобранные шаблоны — те, у которых есть признаки для подбора. */
export function catalogedEntries(): TemplateEntry[] {
  return loadTemplateManifest().entries.filter((e) => e.traits);
}

export function findTemplate(id: string): TemplateEntry | null {
  return loadTemplateManifest().entries.find((e) => e.id === id) ?? null;
}

export function readTemplateSvg(entry: TemplateEntry, view: 'front' | 'back'): string | null {
  const rel = view === 'front' ? entry.svg_front : entry.svg_back;
  if (!rel) return null;
  const path = rel.startsWith('/') ? rel : join(ROOT, rel);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/**
 * Отметка о выборе шаблона.
 *
 * Счётчик — очередь на повышение: силуэт, который выбирают чаще прочих,
 * заслуживает ручной разметки контрольных точек и переезда в мастера, где
 * он начнёт деформироваться под замеры, а не только масштабироваться.
 * Запись в манифест, а не в базу: очередь читает человек за разметкой,
 * и ей место рядом с самими шаблонами.
 */
export function notePromotion(id: string): void {
  const manifest = loadTemplateManifest();
  const entry = manifest.entries.find((e) => e.id === id);
  if (!entry) return;
  entry.promotion_score = (entry.promotion_score ?? 0) + 1;
  try {
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  } catch {
    // Счётчик — телеметрия для очереди на разметку, а не часть документа.
    // Файловая система только для чтения не повод ронять генерацию техпака.
  }
}

/** Сбросить кэш — нужен тестам и после переноса датасета. */
export function resetTemplateCache(): void {
  cached = null;
}
