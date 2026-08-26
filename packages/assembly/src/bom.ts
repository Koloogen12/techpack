import { assume, fromBase, roundCm, type Tracked } from '@seamsterly/core';
import { SeamsterlyError } from '@seamsterly/core';
import {
  kb as defaultKb,
  type Category,
  type KnowledgeBase,
  type Material,
  type MaterialRole,
} from '@seamsterly/kb';
import type { PhotoConfidence } from './pom.js';

/**
 * Движок спецификации материалов.
 *
 * Два ограничения из предметной области определяют всю его логику:
 *
 *  1. Класс полотна по фактуре с фото определяется, плотность в граммах —
 *     никогда (knowledge-base/05 §1.1). Поэтому GSM и состав всегда уходят
 *     предположением, даже когда полотно опознано уверенно.
 *  2. Расход без раскладки точно не считается. Конкурент на этом основании
 *     отказывается его считать вовсе — а фабрике он нужен, чтобы назвать цену
 *     (слабость №14). Мы даём предварительную оценку с явной оговоркой.
 */

/**
 * Колорвей берётся ИЗ СХЕМЫ, а не объявляется здесь заново.
 *
 * Своя копия тут уже стояла и успела разойтись: у колорвея появились образец
 * полотна и фирменный номер цвета, а копия про них не знала — и движок молча
 * отбрасывал бы поля, которые схема требует. Это тот же класс ошибки, что
 * трижды дал расхождение на сборке входа спеки: одна сущность, описанная
 * в двух местах, расходится не «если», а «когда».
 */
export type { Colorway } from '@seamsterly/stylespec';
import type { Colorway } from '@seamsterly/stylespec';

export interface BomInput {
  category: Category;
  /** Класс полотна, опознанный по фактуре. Пусто — берётся типовой для категории. */
  fabric_class?: string;
  fabric_confidence?: PhotoConfidence;
  /** Колорвеи изделия. Пусто — один основной цвет. */
  colorways?: readonly Colorway[];
  /** Тираж. Влияет только на пересчёт расхода на партию. */
  quantity?: number;
}

/**
 * Строка спецификации берётся ИЗ СХЕМЫ, а не описывается здесь заново —
 * по той же причине, что и колорвей с узлом конструкции.
 */
export type { BomLine } from '@seamsterly/stylespec';
import type { BomLine } from '@seamsterly/stylespec';

export interface BomResult {
  /** Спецификация одна на колорвей: замена цвета меняет свотчи и Pantone. */
  colorways: Colorway[];
  lines: BomLine[];
  /** Предварительный расход основного полотна на изделие, погонных метров. */
  fabric_consumption_m: Tracked<number>;
  /** То же на весь тираж. Пусто, если тираж не назван. */
  /** Тираж заказа, штук. Без него расход на тираж — число без смысла. */
  batch_qty: number | null;
  batch_consumption_m: number | null;
  notes: string[];
}

const ROLE_PREFIX: Record<MaterialRole, string> = {
  shell: 'F',
  rib: 'F',
  interlining: 'I',
  thread: 'T',
  label: 'L',
  packaging: 'P',
};

const PLACEMENT: Record<MaterialRole, string> = {
  shell: 'основное полотно',
  rib: 'горловина, манжеты, пояс',
  interlining: 'плечевой шов',
  thread: 'все швы',
  label: 'горловина, боковой шов, навесной',
  packaging: 'индивидуальная упаковка',
};

const DEFAULT_COLORWAY: Colorway = { id: 'main', name_ru: 'Основной' };

export function buildBom(input: BomInput, base: KnowledgeBase = defaultKb()): BomResult {
  const notes: string[] = [];
  const defaults = base.categoryDefaultsFor(input.category).default_materials;
  const colorways = input.colorways?.length ? [...input.colorways] : [DEFAULT_COLORWAY];

  const dupIds = colorways.map((c) => c.id).filter((id, i, all) => all.indexOf(id) !== i);
  if (dupIds.length) {
    // Два цвета с одним идентификатором дают одинаковые артикулы SKU —
    // на складе и в «Честном знаке» это два разных товара под одним кодом.
    throw new SeamsterlyError(
      'SPEC_INVALID',
      `дубли идентификаторов колорвеев: ${dupIds.join(', ')}`,
      {
        userMessage: `У нескольких цветов совпадает идентификатор: ${[...new Set(dupIds)].join(', ')}.`,
        userAction: 'Задайте каждому цвету свой идентификатор — по нему строятся артикулы',
        details: { duplicates: [...new Set(dupIds)].join(', ') },
      },
    );
  }

  // --- Основное полотно: фактура с фото может уточнить типовое ----------------
  const shellId = resolveShell(input, defaults.shell, base, notes);

  const ids: { id: string; role: MaterialRole }[] = [
    { id: shellId, role: 'shell' },
    ...(defaults.rib ? [{ id: defaults.rib, role: 'rib' as const }] : []),
    ...defaults.threads.map((id) => ({ id, role: 'thread' as const })),
    ...defaults.interlinings.map((id) => ({ id, role: 'interlining' as const })),
    ...defaults.labels.map((id) => ({ id, role: 'label' as const })),
    ...defaults.packaging.map((id) => ({ id, role: 'packaging' as const })),
  ];

  const counters = new Map<string, number>();
  const lines = ids.map(({ id, role }) => {
    const n = (counters.get(ROLE_PREFIX[role]) ?? 0) + 1;
    counters.set(ROLE_PREFIX[role], n);
    return buildLine(
      base.material(id),
      role,
      `${ROLE_PREFIX[role]}-${String(n).padStart(2, '0')}`,
      input,
    );
  });

  // --- Предварительный расход -------------------------------------------------
  const formula = base.consumptionFor(input.category);
  const withWaste =
    formula.consumption_m.default *
    (1 + formula.marker_waste_percent.default / 100) *
    (1 + formula.shrinkage_percent.default / 100);
  const perUnit = roundCm(withWaste);

  const consumption = fromBase(
    perUnit,
    `kb:consumption_formulas#${input.category}`,
    `предварительно: ${formula.consumption_m.default} м на размер M при ширине ` +
      `${formula.fabric_width_cm.default} см, плюс ${formula.marker_waste_percent.default}% ` +
      `на раскладку и ${formula.shrinkage_percent.default}% на усадку. ` +
      `Уточняется фабрикой по раскладке`,
  );

  notes.push(
    'Расход полотна дан предварительно. Точное значение фабрика считает по раскладке ' +
      'на конкретный размерный ряд — заложите запас при закупке.',
  );

  if (colorways.length > 1) {
    notes.push(
      `Колорвеев ${colorways.length}: спецификация и артикулы SKU строятся на каждый цвет ` +
        `отдельно, а расход полотна делится между ними по тиражу.`,
    );
  }

  return {
    colorways,
    lines,
    fabric_consumption_m: consumption,
    batch_qty: input.quantity ?? null,
    batch_consumption_m: input.quantity ? roundCm(perUnit * input.quantity) : null,
    notes,
  };
}

/**
 * Основное полотно.
 *
 * Фактура с фото уточняет типовое значение категории — но только если
 * опознанный класс действительно применим к категории. Иначе доверяем
 * справочнику и говорим об этом.
 */
function resolveShell(
  input: BomInput,
  fallback: string,
  base: KnowledgeBase,
  notes: string[],
): string {
  if (!input.fabric_class || input.fabric_class === 'unknown') return fallback;
  if (input.fabric_class === fallback) return fallback;

  let recognized: Material;
  try {
    recognized = base.material(input.fabric_class);
  } catch {
    notes.push(
      `Полотно на фото опознано как «${input.fabric_class}», но такого нет в справочнике — ` +
        `взяли типовое для категории.`,
    );
    return fallback;
  }

  if (!recognized.applications.includes(input.category)) {
    notes.push(
      `Полотно на фото похоже на «${recognized.name_ru}», но для этой категории оно нетипично — ` +
        `взяли «${base.material(fallback).name_ru}». Проверьте по образцу.`,
    );
    return fallback;
  }

  notes.push(`Основное полотно определено по фактуре с фото: ${recognized.name_ru}.`);
  return recognized.id;
}

function buildLine(material: Material, role: MaterialRole, code: string, input: BomInput): BomLine {
  const source = `kb:materials#${material.id}`;
  const isShellFromPhoto =
    role === 'shell' && input.fabric_class === material.id && input.fabric_confidence !== undefined;

  return {
    code,
    role,
    material_id: material.id,
    name_ru: material.name_ru,
    name_en: material.name_en,
    name_zh: material.name_zh,
    composition_en: material.composition_default_en,
    composition_zh: material.composition_default_zh,
    // Состав с фото не определяется никогда — даже когда полотно опознано.
    composition: assume(
      material.composition_default_ru,
      `${source}.composition`,
      'состав по фото не определяется — подтвердить у поставщика полотна',
    ),
    gsm: material.gsm
      ? assume(
          material.gsm.default,
          `${source}.gsm`,
          `плотность по фото не определяется. Типовой диапазон ${material.gsm.min}–` +
            `${material.gsm.max} г/м² — подтвердить у поставщика`,
        )
      : null,
    placement_ru: PLACEMENT[role],
    consumption:
      role === 'shell'
        ? null // расход полотна считается отдельно, ниже по документу
        : fromBase(1, `${source}.consumption`, 'типовое количество на изделие'),
    consumption_unit: role === 'shell' || role === 'rib' ? 'м' : 'шт',
    supplier_article: null,
    ...(isShellFromPhoto ? { note: 'класс полотна опознан по фактуре на фото' } : {}),
  };
}

/** Сколько строк спецификации требуют подтверждения. */
export function countBomAssumptions(lines: readonly BomLine[]): number {
  return lines.filter(
    (l) => l.composition.confidence === 'assumption' || l.gsm?.confidence === 'assumption',
  ).length;
}
