import { SPEC_VERSION, parseStyleSpec, type StyleSpec } from '@specform/stylespec';
import { kb as defaultKb, type KnowledgeBase } from '@specform/kb';
import { buildMeasurements, countMeasurementAssumptions, type PomInput } from './pom.js';
import {
  buildConstruction,
  countConstructionAssumptions,
  type ConstructionInput,
} from './construction.js';
import { buildBom, countBomAssumptions, type BomInput } from './bom.js';
import { buildLabels, type BrandProfile } from './labels.js';
import { buildArtwork, type ArtworkInput } from './artwork.js';

/**
 * Сборка StyleSpec — детерминированная стадия пайплайна.
 *
 * Ни одного обращения к LLM: на вход приходят ответы мастера и (опционально)
 * уже посчитанные пропорции с фото, на выходе — цифровая модель изделия.
 * Из неё рендерятся чертёж, таблицы и PDF (ADR-0003 §1).
 */
export interface StyleSpecInput
  extends PomInput, Omit<ConstructionInput, 'category'>, Omit<BomInput, 'category'> {
  /** Реквизиты бренда для ярлыков. Без них обязательные поля остаются пробелами. */
  brand_profile?: BrandProfile;
  /** Макеты для нанесения. Пусто — вещь без принта, и это норма. */
  artwork?: readonly ArtworkInput[];
  /** Светлое ли полотно. Нужно сублимации: краситель прозрачен. */
  light_fabric?: boolean;
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
  const construction = buildConstruction(input, base);
  notes.push(...construction.notes);

  const bom = buildBom(input, base);
  notes.push(...bom.notes);

  // Состав для ярлыка берётся из спецификации, а не собирается заново:
  // расхождение состава на ярлыке и в спецификации — прямое нарушение ТР ТС.
  const shell = bom.lines.find((l) => l.role === 'shell');
  if (!shell) throw new Error('спецификация без основного полотна');
  const shellMaterial = base.material(shell.material_id);

  const labels = buildLabels(
    {
      category: input.category,
      gender: input.gender,
      article: input.article,
      size_range: input.size_range,
      colorways: bom.colorways,
      composition: shell.composition.value,
      care_profile_id: shellMaterial.care_profile_id ?? 'cotton_knit',
      ...(input.brand_profile === undefined ? {} : { brand: input.brand_profile }),
    },
    base,
  );
  notes.push(...labels.notes);

  // Нанесение считается ПОСЛЕ спецификации: выбор техники зависит от полотна,
  // а полотно определяется там. Обратный порядок дал бы сублимацию на хлопке.
  const artwork = input.artwork?.length
    ? buildArtwork(
        {
          category: input.category,
          placements: input.artwork,
          fabric_class: shell.material_id,
          ...(input.quantity === undefined ? {} : { quantity: input.quantity }),
          ...(input.light_fabric === undefined ? {} : { light_fabric: input.light_fabric }),
        },
        base,
      )
    : null;
  if (artwork) notes.push(...artwork.notes);

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
    construction: {
      machine_park_profile: base.machineParkProfile(input.machine_park).id,
      nodes: construction.nodes,
      sequence: construction.sequence,
    },
    bom: {
      colorways: bom.colorways,
      lines: bom.lines,
      fabric_consumption_m: bom.fabric_consumption_m,
      batch_qty: bom.batch_qty,
      batch_consumption_m: bom.batch_consumption_m,
    },
    labels: {
      care_symbols: labels.care_symbols,
      requisites: labels.requisites,
      sku_matrix: labels.sku_matrix,
    },
    ...(artwork ? { artwork: artwork.artwork } : {}),
    assets: [],
    meta: {
      generated_at: input.generated_at.toISOString(),
      ...(input.vision_cache_key === undefined ? {} : { vision_cache_key: input.vision_cache_key }),
      kb_versions: {
        [measurements.template_id]: measurements.template_version,
        [`category_defaults/${input.category}`]: base.categoryDefaultsFor(input.category).version,
      },
      assumptions_count:
        countMeasurementAssumptions(measurements) +
        countConstructionAssumptions(construction.nodes) +
        countBomAssumptions(bom.lines),
    },
  };

  // Валидация на выходе, а не на входе: схема ловит рассогласования,
  // которые движок мог допустить сам — например разошедшийся счётчик предположений.
  return { spec: parseStyleSpec(draft), notes };
}
