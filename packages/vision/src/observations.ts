import { z } from 'zod';
import {
  CLOSURE_KINDS,
  EDGE_KINDS,
  NECKLINE_KINDS,
  OBSERVATION_KEYS,
  OBSERVATION_LABEL_RU,
  POCKET_KINDS,
  SLEEVE_KINDS,
  SLEEVE_LENGTHS,
  YES_NO,
  observationVocabulary,
} from '@seamster/core';

/**
 * Схема наблюдений по закрытым словарям (см. packages/core/src/observations.ts).
 *
 * Модель выбирает одно значение на признак. Описания к полям — те же глоссы,
 * что в промпте: JSON-схема и текст не могут разойтись.
 */
const confidence = z.enum(['high', 'medium', 'low']);

function observed<const T extends readonly [string, ...string[]]>(values: T, key: string) {
  const { gloss } = observationVocabulary(key as never);
  return z.object({
    value: z.enum(values).describe(values.map((v) => `${v} — ${gloss[v] ?? v}`).join('; ')),
    confidence,
  });
}

export const ObservationsSchema = z.object({
  neckline: observed(NECKLINE_KINDS, 'neckline'),
  closure: observed(CLOSURE_KINDS, 'closure'),
  cuff: observed(EDGE_KINDS, 'cuff'),
  hem: observed(EDGE_KINDS, 'hem'),
  pocket: observed(POCKET_KINDS, 'pocket'),
  sleeve: observed(SLEEVE_KINDS, 'sleeve'),
  sleeve_length: observed(SLEEVE_LENGTHS, 'sleeve_length'),
  hood: observed(YES_NO, 'hood'),
});
export type ObservationsReport = z.infer<typeof ObservationsSchema>;

/** Раздел промпта со словарями — собирается из глосс, а не пишется руками. */
export function observationsPromptSection(): string {
  const lines: string[] = [
    '0. СЛОВАРИ — главный ответ. По каждому признаку выбери РОВНО ОДНО значение из списка. Это единственное, что движок сборки читает без человека: по значению выбирается узел обработки, от него — машина, операция и строка фурнитуры. Слова в visible_elements и дизайн-признаках — пояснение к выбору, не его замена. Не видно — not_visible, и это нормальный ответ; other — только когда ни одно значение не подходит, тогда опиши словами.',
    '',
  ];
  for (const key of OBSERVATION_KEYS) {
    const { values, gloss } = observationVocabulary(key);
    lines.push(
      `${OBSERVATION_LABEL_RU[key]} (${key}): ` +
        values.map((v) => `${v} — ${gloss[v]}`).join('; ') +
        '.',
    );
  }
  lines.push(
    '',
    'Смотри на деталь, а не на категорию: у свитера бывает молния, у худи — нет капюшона, у рубчика низ чаще подшит, чем притачан отдельной рибаной. Между rib_band и turned_hem решает шов притачивания: есть отдельная деталь со швом — rib_band, край просто подогнут — turned_hem. Между crew_rib_band и crew_binding решает высота: заметная бейка в 2–4 см — бейка-риб, узкая полоска около сантиметра — окантовка. Стойка, которая стоит, — mock_neck; стойка с отворотом — turtleneck.',
  );
  return lines.join('\n');
}
