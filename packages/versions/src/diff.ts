import { CONFIDENCE_LABEL_RU, type Confidence } from '@seamsterly/core';
import type { StyleSpec } from '@seamsterly/stylespec';

/**
 * Различие двух версий техпака.
 *
 * Нужно ровно одной аудитории и по одной причине: человек, который уже читал
 * прошлую версию, не станет перечитывать сорок страниц. Ему нужно знать,
 * что тронули. Без этого «версия 2» означает «читайте всё заново»,
 * и вторую версию просто не читают.
 *
 * Дифф считается по СОДЕРЖАНИЮ, а не по тексту файла: перестановка ключей
 * в JSON или новая дата генерации не являются изменением изделия.
 */

export interface PointChange {
  code: string;
  name_ru: string;
  from_cm: number | null;
  to_cm: number | null;
  delta_cm: number | null;
  from_confidence: Confidence | null;
  to_confidence: Confidence | null;
  /** Появилась точка, исчезла или изменилась. */
  kind: 'added' | 'removed' | 'changed';
  /** Подтверждение поднялось выше — главный сорт изменений. */
  confirmed: boolean;
}

export interface SpecDiff {
  points: PointChange[];
  assumptions: { from: number; to: number };
  nodes: { added: string[]; removed: string[] };
  bom: { added: string[]; removed: string[] };
  colorways: { added: string[]; removed: string[] };
  identical: boolean;
}

const RANK: Record<Confidence, number> = {
  fit_confirmed: 6,
  user_input: 5,
  measured_by_scale: 4,
  estimated_from_photo: 3,
  default_from_base: 2,
  assumption: 1,
};

export function diffSpecs(prev: StyleSpec, next: StyleSpec): SpecDiff {
  const before = new Map(prev.measurements.points.map((p) => [p.code, p]));
  const after = new Map(next.measurements.points.map((p) => [p.code, p]));

  const points: PointChange[] = [];
  for (const code of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(code);
    const b = after.get(code);

    if (!a && b) {
      points.push({
        code,
        name_ru: b.name_ru,
        from_cm: null,
        to_cm: b.base.value,
        delta_cm: null,
        from_confidence: null,
        to_confidence: b.base.confidence,
        kind: 'added',
        confirmed: b.base.confidence === 'fit_confirmed',
      });
      continue;
    }
    if (a && !b) {
      points.push({
        code,
        name_ru: a.name_ru,
        from_cm: a.base.value,
        to_cm: null,
        delta_cm: null,
        from_confidence: a.base.confidence,
        to_confidence: null,
        kind: 'removed',
        confirmed: false,
      });
      continue;
    }
    if (!a || !b) continue;

    const valueChanged = a.base.value !== b.base.value;
    const statusChanged = a.base.confidence !== b.base.confidence;
    if (!valueChanged && !statusChanged) continue;

    points.push({
      code,
      name_ru: b.name_ru,
      from_cm: a.base.value,
      to_cm: b.base.value,
      delta_cm: Math.round((b.base.value - a.base.value) * 10) / 10,
      from_confidence: a.base.confidence,
      to_confidence: b.base.confidence,
      kind: 'changed',
      // Поднятие статуса — отдельный сорт изменения, и он важнее цифры:
      // значение могло не сдвинуться вовсе, но перестало быть догадкой.
      confirmed: RANK[b.base.confidence] > RANK[a.base.confidence],
    });
  }

  points.sort((x, y) => Math.abs(y.delta_cm ?? 0) - Math.abs(x.delta_cm ?? 0));

  const ids = (list: readonly { id: string }[] | undefined): Set<string> =>
    new Set((list ?? []).map((x) => x.id));
  const nodeIds = (spec: StyleSpec): Set<string> =>
    new Set((spec.construction?.nodes ?? []).map((n) => n.node_id));
  const bomCodes = (spec: StyleSpec): Set<string> =>
    new Set((spec.bom?.lines ?? []).map((l) => l.code));

  const setDiff = (a: Set<string>, b: Set<string>): { added: string[]; removed: string[] } => ({
    added: [...b].filter((x) => !a.has(x)).sort(),
    removed: [...a].filter((x) => !b.has(x)).sort(),
  });

  const nodes = setDiff(nodeIds(prev), nodeIds(next));
  const bom = setDiff(bomCodes(prev), bomCodes(next));
  const colorways = setDiff(ids(prev.bom?.colorways), ids(next.bom?.colorways));

  return {
    points,
    assumptions: { from: prev.meta.assumptions_count, to: next.meta.assumptions_count },
    nodes,
    bom,
    colorways,
    identical:
      points.length === 0 &&
      nodes.added.length === 0 &&
      nodes.removed.length === 0 &&
      bom.added.length === 0 &&
      bom.removed.length === 0 &&
      colorways.added.length === 0 &&
      colorways.removed.length === 0,
  };
}

/** Одна строка о том, что изменилось. Для консоли и для шапки листа. */
export function summarise(diff: SpecDiff): string {
  if (diff.identical) return 'Содержание не изменилось.';
  const parts: string[] = [];
  const confirmed = diff.points.filter((p) => p.confirmed).length;
  if (confirmed) parts.push(`подтверждено по образцу: ${confirmed}`);
  const moved = diff.points.filter((p) => p.kind === 'changed' && p.delta_cm !== 0).length;
  if (moved) parts.push(`сдвинулось значений: ${moved}`);
  if (diff.assumptions.to !== diff.assumptions.from) {
    parts.push(`предположений ${diff.assumptions.from} → ${diff.assumptions.to}`);
  }
  const structural =
    diff.nodes.added.length +
    diff.nodes.removed.length +
    diff.bom.added.length +
    diff.bom.removed.length;
  if (structural) parts.push(`изменений в конструкции и спецификации: ${structural}`);
  return parts.join(' · ');
}

export { CONFIDENCE_LABEL_RU };
