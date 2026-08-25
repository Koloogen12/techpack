import { createHash } from 'node:crypto';
import type { StyleSpec } from './schema.js';

/**
 * Отпечаток содержимого StyleSpec.
 *
 * Требование продукта — «одинаковый вход → одинаковый StyleSpec» (PRD.md §4).
 * Буквально побайтовое равенство недостижимо: в meta лежит время генерации,
 * оно у двух прогонов разное по определению. Поэтому воспроизводимость
 * определяется по содержанию: паспорт изделия, якорные вводные, табель мер.
 *
 * Именно этот отпечаток сравнивают голден-тесты. Его расхождение при одинаковом
 * входе — баг детерминизма, а не шум.
 */
export function specFingerprint(spec: StyleSpec): string {
  const content = {
    spec_version: spec.spec_version,
    style: spec.style,
    base: spec.base,
    measurements: spec.measurements,
    assets: [...spec.assets].sort((a, b) => a.key.localeCompare(b.key)),
    // Из meta берём только то, что обязано воспроизводиться.
    // generated_at намеренно исключён.
    kb_versions: spec.meta.kb_versions,
    vision_cache_key: spec.meta.vision_cache_key ?? null,
    assumptions_count: spec.meta.assumptions_count,
  };
  return createHash('sha256').update(stableStringify(content)).digest('hex');
}

/**
 * JSON с детерминированным порядком ключей.
 * Без этого отпечаток зависел бы от порядка вставки полей в объект.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}
