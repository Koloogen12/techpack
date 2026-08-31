import { confidenceRank } from '@seamster/core';
import { kb as defaultKb, type KnowledgeBase, type PhotoView } from '@seamster/kb';
import type { StyleSpec } from '@seamster/stylespec';

/**
 * Какой недостающий кадр поднимет точность сильнее всего.
 *
 * Единственный совет по точности, который стоит человеку тридцати секунд,
 * а не денег и не двух недель ожидания образца. Всё остальное — «померьте
 * рулеткой», «закажите пробник» — стоит времени; доснять спинку не стоит
 * ничего, и это надо сказать до того, как документ уедет на фабрику.
 *
 * Считается по факту, а не по общим соображениям: берутся точки, которые
 * в собранном документе оказались слабыми, и для каждой смотрится, какой
 * ракурс делает её наблюдаемой. Ракурсы, которые уже прислали, из совета
 * исключаются — предлагать доснять то, что уже есть, значит расписаться
 * в том, что совет не считался.
 */

export interface ViewAdvice {
  view: PhotoView;
  label_ru: string;
  how_to_shoot_ru: string;
  /** Коды точек, которые кадр переведёт в наблюдения. */
  codes: string[];
}

/** Слабое значение: не наблюдалось на фото либо наблюдалось неуверенно. */
function isWeak(confidence: string): boolean {
  // Всё, что ниже оценки по фото, получено не из снимка вовсе.
  return confidenceRank(confidence as never) <= confidenceRank('estimated_from_photo');
}

export function suggestViews(
  spec: StyleSpec,
  suppliedViews: readonly (PhotoView | undefined)[],
  base: KnowledgeBase = defaultKb(),
): ViewAdvice[] {
  const have = new Set(suppliedViews.filter((v): v is PhotoView => v !== undefined));

  // Точка считается слабой один раз: если её уже подтвердил заказчик
  // или снятый образец, никакая пересъёмка ничего не улучшит.
  const weak = new Set(
    spec.measurements.points.filter((p) => isWeak(p.base.confidence)).map((p) => p.code),
  );
  if (weak.size === 0) return [];

  const advice: ViewAdvice[] = [];
  for (const entry of base.photoViews()) {
    if (have.has(entry.id)) continue;
    const codes = entry.unlocks_pom.filter((c) => weak.has(c));
    if (codes.length === 0) continue;
    advice.push({
      view: entry.id,
      label_ru: entry.label_ru,
      how_to_shoot_ru: entry.how_to_shoot_ru,
      codes,
    });
  }

  // Сначала тот кадр, который закрывает больше точек. При равенстве —
  // порядок справочника: он идёт от общего плана к деталям, то есть
  // от простого в съёмке к сложному.
  return advice.sort((a, b) => b.codes.length - a.codes.length);
}

/** Совет словами — для отчёта CLI и для примечаний документа. */
export function viewAdviceNotes(advice: readonly ViewAdvice[]): string[] {
  return advice.map(
    (a) =>
      `Доснимите: ${a.label_ru.toLowerCase()} — это переведёт ${a.codes.length} ` +
      `${plural(a.codes.length, 'замер', 'замера', 'замеров')} из предположений ` +
      `в наблюдения (${a.codes.join(', ')}). Как снимать: ${a.how_to_shoot_ru}`,
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/**
 * Совет положить в кадр предмет известного размера.
 *
 * Отдельно от совета по ракурсам, потому что действует иначе. Лишний ракурс
 * добавляет НАБЛЮДЕНИЯ — точек становится больше. Предмет известного размера
 * не добавляет ни одной точки, он чинит МАСШТАБ: все пропорции с фото
 * перестают зависеть от того, верен ли заявленный размер.
 *
 * Обещать здесь «N точек станут замерами» было бы враньём: измеренной
 * становится одна величина — опорная. Остальные остаются оценкой пропорции,
 * просто отложенной от измерения, а не от предположения.
 */
export function scaleAdvice(usedScale: boolean, base: KnowledgeBase = defaultKb()): string[] {
  if (usedScale) return [];

  const best = base.scaleReferences().find((r) => r.trust === 'high') ?? base.scaleReferences()[0];
  if (!best) return [];

  return [
    `Положите в кадр опорный предмет (${best.label_ru}) — это единственный способ снять ` +
      `размер с фотографии по-настоящему. Сейчас масштаб берётся из указанного вами ` +
      `размера, то есть из замысла; предмет известного размера даёт факт, и заодно ` +
      `показывает расхождение, если вещь не соответствует своей бирке. ` +
      `${best.how_to_place_ru}`,
  ];
}
