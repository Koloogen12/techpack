import { kb, type KnowledgeBase } from '@seamster/kb';
import type { StyleSpec } from '@seamster/stylespec';

/**
 * Готовность документа к отправке фабрике.
 *
 * Красное «НЕ ЗАПОЛНЕНО» в разделе маркировки — не украшение: без страны
 * изготовления, юрлица и товарного знака продажа в ЕАЭС невозможна по статье
 * 9 ТР ТС 017/2011. Отправить такой документ фабрике значит запустить партию,
 * которую нельзя будет продать.
 *
 * Считается только то, что МОЖЕТ заполнить бренд. Дату изготовления ставит
 * фабрика при выпуске партии, символы ухода и знак обращения подставляем мы —
 * требовать их от человека бессмысленно, и гейт, который нельзя пройти,
 * человек просто обойдёт.
 */
export interface ReadinessGap {
  id: string;
  label_ru: string;
  action_ru: string;
}

export interface Readiness {
  /** Можно ли отдавать документ наружу. */
  ready: boolean;
  /** Чего не хватает — то, что заполняет бренд. */
  gaps: readonly ReadinessGap[];
}

export function readiness(spec: StyleSpec, base: KnowledgeBase = kb()): Readiness {
  const byBrand = new Set(
    base
      .labelRequisites()
      .filter((r) => r.required && r.fills_from === 'brand_profile')
      .map((r) => r.id),
  );

  const gaps = (spec.labels?.requisites ?? [])
    .filter((r) => r.required && r.value === null && byBrand.has(r.id))
    .map((r) => ({
      id: r.id,
      label_ru: r.label_ru,
      action_ru: r.action_ru ?? 'Заполните профиль бренда',
    }));

  return { ready: gaps.length === 0, gaps };
}
