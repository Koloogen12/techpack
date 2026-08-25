import { SpecFormError } from '@specform/core';
import { SPEC_VERSION, StyleSpecSchema, type StyleSpec } from './schema.js';

/**
 * Миграция снапшота StyleSpec между версиями схемы.
 *
 * Правило ADR-0001 §4: снапшот в хранилище никогда не переписывается на месте.
 * Чтение старой версии проходит через цепочку чистых функций, каждая с тестом
 * на реальном снапшоте. Ломающее изменение схемы без миграции блокирует мерж.
 */
export interface Migration {
  readonly from: string;
  readonly to: string;
  /** Что изменилось и почему. Попадает в лог миграции. */
  readonly describe: string;
  readonly migrate: (snapshot: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Цепочка миграций по возрастанию версий.
 *
 * Пусто: 0.1.0 — первая версия. Каждая следующая добавляет запись сюда
 * ОДНОВРЕМЕННО с изменением схемы, в том же коммите.
 */
export const MIGRATIONS: readonly Migration[] = [];

function versionOf(snapshot: unknown): string {
  if (typeof snapshot !== 'object' || snapshot === null || !('spec_version' in snapshot)) {
    throw new SpecFormError('SPEC_INVALID', 'снапшот без spec_version', {
      userMessage: 'Не удалось открыть техпак: файл повреждён.',
      userAction: 'Откройте предыдущую версию или напишите нам',
    });
  }
  const version = (snapshot as { spec_version: unknown }).spec_version;
  if (typeof version !== 'string') {
    throw new SpecFormError('SPEC_INVALID', 'spec_version не строка', {
      userMessage: 'Не удалось открыть техпак: файл повреждён.',
      userAction: 'Откройте предыдущую версию или напишите нам',
    });
  }
  return version;
}

/**
 * Привести снапшот любой поддерживаемой версии к текущей и провалидировать.
 * Возвращает также список применённых шагов — он уходит в лог.
 */
export function migrateToCurrent(snapshot: unknown): { spec: StyleSpec; applied: string[] } {
  let version = versionOf(snapshot);
  let current = snapshot as Record<string, unknown>;
  const applied: string[] = [];

  while (version !== SPEC_VERSION) {
    const step = MIGRATIONS.find((m) => m.from === version);
    if (!step) {
      throw new SpecFormError(
        'SPEC_VERSION_UNSUPPORTED',
        `нет миграции с версии ${version} (текущая ${SPEC_VERSION})`,
        {
          userMessage: 'Этот техпак сделан в несовместимой версии продукта.',
          userAction: 'Напишите нам — восстановим вручную',
          details: { from: version, current: SPEC_VERSION },
        },
      );
    }
    current = step.migrate(current);
    applied.push(`${step.from} → ${step.to}: ${step.describe}`);
    version = step.to;
  }

  return { spec: parseStyleSpec(current), applied };
}

/** Валидация снапшота против текущей схемы. */
export function parseStyleSpec(snapshot: unknown): StyleSpec {
  const parsed = StyleSpecSchema.safeParse(snapshot);
  if (!parsed.success) {
    throw new SpecFormError('SPEC_INVALID', 'снапшот не прошёл валидацию схемы', {
      userMessage: 'Не удалось открыть техпак: данные не сходятся.',
      userAction: 'Повторить генерацию бесплатно. Если повторяется — напишите нам.',
      details: { issues: JSON.stringify(parsed.error.issues, null, 2) },
    });
  }
  return parsed.data;
}
