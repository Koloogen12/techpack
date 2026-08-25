import { SPEC_VERSION, parseStyleSpec, type StyleSpec } from '@specform/stylespec';
import { kb as defaultKb, type KnowledgeBase } from '@specform/kb';
import { buildMeasurements, countMeasurementAssumptions, type PomInput } from './pom.js';

/**
 * Сборка StyleSpec — детерминированная стадия пайплайна.
 *
 * Ни одного обращения к LLM: на вход приходят ответы мастера и (опционально)
 * уже посчитанные пропорции с фото, на выходе — цифровая модель изделия.
 * Из неё рендерятся чертёж, таблицы и PDF (ADR-0003 §1).
 */
export interface StyleSpecInput extends PomInput {
  /** Идентификатор техпака. Приходит извне — движок ничего не выдумывает. */
  id: string;
  name: string;
  /** Артикул. Тоже извне: генерация случайного значения сломала бы детерминизм. */
  article: string;
  brand?: string;
  season?: string;
  description?: string;
  /** Ключ контент-кэша vision (ADR-0003). Пусто, если фото не анализировались. */
  vision_cache_key?: string;
  /** Момент генерации. Передаётся снаружи, чтобы сборка оставалась чистой функцией. */
  generated_at: Date;
}

export interface StyleSpecResult {
  spec: StyleSpec;
  /** Решения, о которых движок обязан сказать пользователю. */
  notes: string[];
}

export function buildStyleSpec(
  input: StyleSpecInput,
  base: KnowledgeBase = defaultKb(),
): StyleSpecResult {
  const { measurements, notes } = buildMeasurements(input, base);

  const draft = {
    spec_version: SPEC_VERSION,
    style: {
      id: input.id,
      name: input.name,
      article: input.article,
      category: input.category,
      ...(input.brand === undefined ? {} : { brand: input.brand }),
      ...(input.season === undefined ? {} : { season: input.season }),
      ...(input.description === undefined ? {} : { description: input.description }),
    },
    base: {
      gender: input.gender,
      base_size_ru: input.base_size_ru,
      base_height_cm: input.base_height_cm,
      fit_intent: input.fit_intent,
      fabric_kind: input.fabric_kind,
      size_range: input.size_range,
    },
    measurements,
    assets: [],
    meta: {
      generated_at: input.generated_at.toISOString(),
      ...(input.vision_cache_key === undefined ? {} : { vision_cache_key: input.vision_cache_key }),
      kb_versions: {
        [measurements.template_id]: measurements.template_version,
      },
      assumptions_count: countMeasurementAssumptions(measurements),
    },
  };

  // Валидация на выходе, а не на входе: схема ловит рассогласования,
  // которые движок мог допустить сам — например разошедшийся счётчик предположений.
  return { spec: parseStyleSpec(draft), notes };
}
