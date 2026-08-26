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
 * Каждая новая версия схемы добавляет запись сюда ОДНОВРЕМЕННО с изменением
 * самой схемы, в том же коммите. Ломающее изменение без миграции блокирует мерж.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    from: '0.1.0',
    to: '0.2.0',
    describe: 'добавлен раздел конструкции; для старых снапшотов он остаётся пустым',
    migrate: (snapshot) => ({ ...snapshot, spec_version: '0.2.0' }),
  },
  {
    from: '0.2.0',
    to: '0.3.0',
    describe: 'добавлены разделы материалов и маркировки; для старых снапшотов они пустые',
    migrate: (snapshot) => ({ ...snapshot, spec_version: '0.3.0' }),
  },
  {
    from: '0.3.0',
    to: '0.4.0',
    describe:
      'в спецификацию материалов добавлен тираж заказа; в старых снапшотах ' +
      'расход на тираж есть, а самого тиража нет — восстановить его нельзя, ' +
      'поэтому обнуляются оба: число без смысла хуже отсутствующего',
    migrate: (snapshot) => {
      const bom = snapshot.bom as Record<string, unknown> | undefined;
      return {
        ...snapshot,
        ...(bom ? { bom: { ...bom, batch_qty: null, batch_consumption_m: null } } : {}),
        spec_version: '0.4.0',
      };
    },
  },
  {
    from: '0.4.0',
    to: '0.5.0',
    describe:
      'добавлен раздел нанесения; у старых снапшотов его нет, и это корректно — ' +
      'вещь без принта его и не имеет',
    migrate: (snapshot) => ({ ...snapshot, spec_version: '0.5.0' }),
  },
  {
    from: '0.5.0',
    to: '0.6.0',
    describe:
      'нанесение разделено на локальный макет и сплошной раппорт; ' +
      'у снапшотов 0.5.0 раппорта быть не могло, поэтому всё существующее — локальное',
    migrate: (snapshot) => {
      const artwork = snapshot.artwork as { placements?: Record<string, unknown>[] } | undefined;
      return {
        ...snapshot,
        ...(artwork?.placements
          ? {
              artwork: {
                ...artwork,
                placements: artwork.placements.map((p) => ({ ...p, kind: 'placement' })),
              },
            }
          : {}),
        spec_version: '0.6.0',
      };
    },
  },
  {
    from: '0.6.0',
    to: '0.7.0',
    describe:
      'у колорвея появились образец полотна и фирменный номер цвета от бренда; ' +
      'у снапшотов 0.6.0 их не было, и восстановить их неоткуда — образец это ' +
      'файл, которого в старом паке нет, а номер знает только бренд',
    migrate: (snapshot) => {
      const bom = snapshot.bom as { colorways?: Record<string, unknown>[] } | undefined;
      return {
        ...snapshot,
        ...(bom?.colorways
          ? {
              bom: {
                ...bom,
                colorways: bom.colorways.map((c) => ({
                  ...c,
                  swatch: null,
                  book_code: null,
                  book_source: null,
                })),
              },
            }
          : {}),
        spec_version: '0.7.0',
      };
    },
  },
];

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
