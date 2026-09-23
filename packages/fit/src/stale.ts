import { createHash } from 'node:crypto';
import type { StyleSpec } from '@seamster/stylespec';

/**
 * Устаревание разделов документа.
 *
 * Спецификация — единственный источник, и разделы документа — её проекции.
 * Но у человека есть своя память: он ПРОВЕРИЛ таблицу материалов вчера, а
 * сегодня правка фразой убрала капюшон, и из таблицы ушёл шнур. Таблица
 * верна, память — нет. Здесь хранится ровно это: что человек проверял и
 * что с тех пор изменилось. Раздел, который никто не проверял, устареть
 * не может — ему не от чего.
 *
 * Два повода считать раздел устаревшим:
 *  - правка задела раздел (pending): «изменено фразой „…“ — проверьте»;
 *  - раздел изменился после отметки «проверено» (reviewed с отпечатком).
 * Отметка «проверено» снимает оба.
 */

export const REVIEW_SECTIONS = ['pom', 'nodes', 'bom', 'labels', 'artwork', 'cover'] as const;
export type ReviewSection = (typeof REVIEW_SECTIONS)[number];

export interface ReviewState {
  /** Раздел задет правкой и ждёт взгляда человека. */
  pending: Partial<Record<ReviewSection, { reason_ru: string; at: string }>>;
  /** Человек проверял раздел — при таком отпечатке содержимого. */
  reviewed: Partial<Record<ReviewSection, { fingerprint: string; at: string }>>;
}

export function emptyReview(): ReviewState {
  return { pending: {}, reviewed: {} };
}

export function parseReview(raw: unknown): ReviewState {
  const r = (raw ?? {}) as Partial<ReviewState>;
  const pick = <T>(obj: unknown): Partial<Record<ReviewSection, T>> => {
    const out: Partial<Record<ReviewSection, T>> = {};
    if (!obj || typeof obj !== 'object') return out;
    for (const s of REVIEW_SECTIONS) {
      const v = (obj as Record<string, unknown>)[s];
      if (v && typeof v === 'object') out[s] = v as T;
    }
    return out;
  };
  return { pending: pick(r.pending), reviewed: pick(r.reviewed) };
}

/**
 * Отпечаток содержимого раздела — по тому, что в нём читает человек:
 * числа, статусы, состав, узлы. Перестановка ключей и дата сборки в него
 * не входят, поэтому пересборка без изменений раздел не устаревает.
 */
export function sectionFingerprint(spec: StyleSpec, section: ReviewSection): string {
  const slice: unknown = (() => {
    switch (section) {
      case 'pom':
        return spec.measurements.points.map((p) => [
          p.code,
          p.base.value,
          p.base.confidence,
          p.tolerance.value,
          p.graded.map((g) => [g.ru, g.value.value]),
        ]);
      case 'nodes':
        return [
          (spec.construction?.nodes ?? []).map((n) => [
            n.node_id,
            n.stitch_code,
            n.seam_code,
            n.machine,
            n.presence.confidence,
            n.alternative?.node_id ?? null,
          ]),
          (spec.construction?.sequence ?? []).map((s) => [s.step, s.node_id, s.machine]),
        ];
      case 'bom':
        return [
          (spec.bom?.lines ?? []).map((l) => [
            l.code,
            l.material_id,
            l.composition.value,
            l.composition.confidence,
            l.gsm?.value ?? null,
            l.consumption?.value ?? null,
          ]),
          (spec.bom?.colorways ?? []).map((c) => [c.id, c.name_ru, c.hex_approx ?? null]),
          spec.bom?.fabric_consumption_m ?? null,
        ];
      case 'labels':
        return spec.labels ?? null;
      case 'artwork':
        return (spec.artwork?.placements ?? []).map((a) => [
          a.id,
          a.zone,
          a.technique.value,
          a.size_cm.width.value,
          a.size_cm.height.value,
          a.offset_from_anchor_cm.value,
          a.file_name,
        ]);
      case 'cover':
        return [spec.style, spec.base, spec.design?.features.map((f) => f.en) ?? []];
    }
  })();
  return createHash('sha256').update(JSON.stringify(slice)).digest('hex').slice(0, 24);
}

export interface StaleSection {
  section: ReviewSection;
  /** Почему раздел считается устаревшим — человеческим языком. */
  reason_ru: string;
  /** Правка задела раздел, а не просто изменились данные после проверки. */
  from_revision: boolean;
  at: string;
}

export function staleSections(spec: StyleSpec, review: ReviewState): StaleSection[] {
  const out: StaleSection[] = [];
  for (const section of REVIEW_SECTIONS) {
    const pending = review.pending[section];
    if (pending) {
      out.push({ section, reason_ru: pending.reason_ru, from_revision: true, at: pending.at });
      continue;
    }
    const seen = review.reviewed[section];
    if (seen && seen.fingerprint !== sectionFingerprint(spec, section)) {
      out.push({
        section,
        reason_ru: `Раздел изменился после вашей проверки ${dateRu(seen.at)}.`,
        from_revision: false,
        at: seen.at,
      });
    }
  }
  return out;
}

/** Правка задела разделы: каждый ждёт взгляда, пока человек не отметит «проверено». */
export function markPending(
  review: ReviewState,
  sections: readonly ReviewSection[],
  reason_ru: string,
  at = new Date().toISOString(),
): ReviewState {
  const pending = { ...review.pending };
  for (const s of sections) pending[s] = { reason_ru, at };
  return { ...review, pending };
}

/** Человек посмотрел раздел: повод снят, отпечаток запомнен. */
export function markReviewed(
  review: ReviewState,
  spec: StyleSpec,
  section: ReviewSection,
  at = new Date().toISOString(),
): ReviewState {
  const pending = { ...review.pending };
  delete pending[section];
  return {
    pending,
    reviewed: {
      ...review.reviewed,
      [section]: { fingerprint: sectionFingerprint(spec, section), at },
    },
  };
}

function dateRu(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}
