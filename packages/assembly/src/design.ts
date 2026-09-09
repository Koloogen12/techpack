import { fromPhoto } from '@seamster/core';
import type { DesignFeatureValue } from '@seamster/stylespec';

/**
 * Дизайн-признаки: перенос наблюдений vision в спеку.
 *
 * Здесь нет справочника и нет типовых значений — и это единственный раздел,
 * у которого их быть не может. Реестр узлов описывает технологию: как сшить
 * плечо, сколько строчек в подгибке. Окат буф, широкий пояс, клинья юбки —
 * это дизайн, он есть только у ЭТОЙ вещи и берётся только со снимка. Поэтому
 * источник у каждого признака один — vision, статус один — «оценка по фото».
 *
 * Уверенность наблюдения (high/medium/low) едет отдельно и не превращается
 * в статус: задание художнику технического рисунка берёт только уверенные
 * признаки, а документ показывает все, включая сомнительные, — конструктор
 * лекал решит сам.
 */
export interface DesignFeatureObservation {
  zone: DesignFeatureValue['zone'];
  en: string;
  ru: string;
  confidence: DesignFeatureValue['certainty'];
}

export interface DesignInput {
  /** Что vision увидел на снимках. Приходит из VisionReport.design_features. */
  design_features?: readonly DesignFeatureObservation[];
}

export function buildDesign(input: DesignInput): { features: DesignFeatureValue[] } | null {
  const seen = new Set<string>();
  const features: DesignFeatureValue[] = [];
  for (const f of input.design_features ?? []) {
    const en = f.en.trim();
    const ru = f.ru.trim();
    // Пустая формулировка — не признак; повтор той же зоны и той же фразы —
    // не второй признак. Модель иногда отдаёт оба.
    if (!en || !ru) continue;
    const key = `${f.zone}|${en.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const tracked = fromPhoto(true, `vision:design#${f.zone}`, ru);
    features.push({
      zone: f.zone,
      ru,
      en,
      certainty: f.confidence,
      confidence: tracked.confidence,
      source: tracked.source,
    });
  }
  return features.length ? { features } : null;
}
