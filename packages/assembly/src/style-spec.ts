import { observationRu, track } from '@seamster/core';
import { SPEC_VERSION, parseStyleSpec, type StyleSpec } from '@seamster/stylespec';
import { kb as defaultKb, type KnowledgeBase } from '@seamster/kb';
import { buildMeasurements, countMeasurementAssumptions, type PomInput } from './pom.js';
import {
  buildConstruction,
  countConstructionAssumptions,
  seesZip,
  type ConstructionInput,
} from './construction.js';
import { buildBom, countBomAssumptions, type BomInput } from './bom.js';
import { buildLabels, type BrandProfile } from './labels.js';
import { buildArtwork, type ArtworkInput, type PatternPlacementInput } from './artwork.js';
import { buildDesign, type DesignInput } from './design.js';
import { neckHeightFromObservation } from './observations.js';

/**
 * Сборка StyleSpec — детерминированная стадия пайплайна.
 *
 * Ни одного обращения к LLM: на вход приходят ответы мастера и (опционально)
 * уже посчитанные пропорции с фото, на выходе — цифровая модель изделия.
 * Из неё рендерятся чертёж, таблицы и PDF (ADR-0003 §1).
 */
export interface StyleSpecInput
  extends PomInput, Omit<ConstructionInput, 'category'>, Omit<BomInput, 'category'>, DesignInput {
  /** Реквизиты бренда для ярлыков. Без них обязательные поля остаются пробелами. */
  brand_profile?: BrandProfile;
  /** Макеты для нанесения. Пусто — вещь без принта, и это норма. */
  artwork?: readonly ArtworkInput[];
  /** Сплошные раппорты: тайлы уже сгенерированы и проверены на бесшовность. */
  patterns?: readonly PatternPlacementInput[];
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
  const categoryDefaults = base.categoryDefaultsFor(input.category, input.fabric_kind);
  const { measurements, notes } = buildMeasurements(input, base);
  const construction = buildConstruction(input, base);
  notes.push(...construction.notes);

  /**
   * Точки, привязанные к узлу, остаются только если узел в изделии есть.
   *
   * Табель мер собирается по категории, а категория — это семейство:
   * куртка бывает со стойкой и с капюшоном, пальто со шлицей и без.
   * Без этого отбора документ печатал куртке со стойкой «высота капюшона
   * 37,4 см» — число, которое ОТК обязан померить у детали, которой нет.
   *
   * Отбор идёт ЗДЕСЬ, а не в сборке табеля: табель считается раньше
   * конструкции и про узлы ничего не знает, а менять порядок сборки ради
   * одного отбора значит связать два независимых шага.
   */
  // Привязка точки к узлу — свойство ШАБЛОНА, а не снапшота: в спеке
  // остаётся только измеренная величина, и правильно так — документ
  // годовой давности не должен зависеть от того, что справочник думает
  // об этой точке сегодня.
  const template = base.pomTemplate(input.category, input.fabric_kind);
  const needsNode = new Map(
    template.points.filter((p) => p.requires_node).map((p) => [p.code, p.requires_node!]),
  );

  if (needsNode.size) {
    const presentNodes = new Set(construction.nodes.map((n) => n.node_id));
    const kept = measurements.points.filter((p) => {
      const node = needsNode.get(p.code);
      return !node || presentNodes.has(node);
    });

    if (kept.length !== measurements.points.length) {
      // Составная точка может ссылаться на убранную — тогда её значение
      // перестаёт сходиться, и убрать надо обе.
      const keptCodes = new Set(kept.map((p) => p.code));
      const composedOf = new Map(
        template.points
          .filter((p) => p.composed_of?.length)
          .map((p) => [p.code, p.composed_of!.map((c) => c.code)]),
      );
      measurements.points = kept.filter((p) => {
        const parts = composedOf.get(p.code);
        return !parts || parts.every((c) => keptCodes.has(c));
      });
    }
  }

  // Окантовка вместо бейки-риб: «высота бейки горловины» в табеле — это
  // высота окантовки по узлу (около 1 см), а не 3 см стойки из типового
  // отношения. Иначе художник рисует стойку, которой на фото нет.
  const presentIds = new Set(construction.nodes.map((n) => n.node_id));
  // Стойка по словарю: бейка-риб есть, а высота типовая (3 см) — стойка выше.
  const neckHeight = neckHeightFromObservation(input.observations);
  if (neckHeight && presentIds.has('neck_rib_band')) {
    const note = `${observationRu('neckline', input.observations!.neckline.value)} по фото — высота бейки по типу стойки, подтвердите по образцу`;
    measurements.points = measurements.points.map((p) =>
      p.code === 'T17' && Math.abs(p.base.value - neckHeight) > 0.5
        ? {
            ...p,
            base: track(neckHeight, 'estimated_from_photo', 'vision:observations#neckline', note),
            graded: p.graded.map((g) => ({
              ...g,
              value: track(
                neckHeight,
                'estimated_from_photo',
                'vision:observations#neckline',
                note,
              ),
            })),
          }
        : p,
    );
  }
  if (presentIds.has('neck_binding') && !presentIds.has('neck_rib_band')) {
    const height = base.node('neck_binding').finished_cm?.default ?? 1.2;
    const note = 'окантовка по фото: узкая бейка, не стойка — высота по узлу окантовки';
    measurements.points = measurements.points.map((p) =>
      p.code === 'T17' && p.base.value > height + 0.3
        ? {
            ...p,
            base: track(height, 'default_from_base', 'kb:construction_nodes#neck_binding', note),
            graded: p.graded.map((g) => ({
              ...g,
              value: track(height, 'default_from_base', 'kb:construction_nodes#neck_binding', note),
            })),
          }
        : p,
    );
  }

  // Застёжка по фото уходит и в фурнитуру: узлы планки уже заменены на
  // молнию выше, строка пуговиц обязана уйти вместе с ними.
  const closureSeen = (input.visible_elements ?? []).find((e) => e.key === 'closure_type');
  const closureByVocab = (() => {
    const o = input.observations?.closure;
    if (!o || o.confidence === 'low') return undefined;
    if (/^zip_/.test(o.value)) return 'zip' as const;
    if (/^buttons_|^snaps$/.test(o.value)) return 'buttons' as const;
    if (o.value === 'none') return 'none' as const;
    return undefined;
  })();
  const bom = buildBom(
    {
      ...input,
      ...(input.closure === undefined
        ? closureByVocab
          ? { closure: closureByVocab }
          : closureSeen && seesZip(closureSeen.value) && !input.observations
            ? { closure: 'zip' as const }
            : {}
        : {}),
    },
    base,
  );
  notes.push(...bom.notes);

  // Дизайн-признаки не зависят ни от чего в сборке: они с фото и только с фото.
  const design = buildDesign(input);

  // Состав для ярлыка берётся из спецификации, а не собирается заново:
  // расхождение состава на ярлыке и в спецификации — прямое нарушение ТР ТС.
  const shell = bom.lines.find((l) => l.role === 'shell');
  if (!shell) throw new Error('спецификация без основного полотна');
  const shellMaterial = base.material(shell.material_id);
  const lining = bom.lines.find((l) => l.role === 'lining');
  const insulation = bom.lines.find((l) => l.role === 'insulation');

  /**
   * Состав на ярлыке: по слоям, если слоёв больше одного.
   *
   * Статья 9 ТР ТС 017/2011 требует указывать состав изделия на подкладке
   * ПО СЛОЯМ. Написать на ярлыке куртки один состав верха — не упрощение,
   * а недостоверная маркировка: покупатель читает «100 % полиэстер» и не
   * знает ни про подкладку, ни про пуховую набивку, а декларирование
   * такого изделия идёт по третьему слою регламента.
   */
  const composition = [
    lining || insulation ? `верх: ${shell.composition.value}` : shell.composition.value,
    ...(lining ? [`подкладка: ${lining.composition.value}`] : []),
    ...(insulation ? [`утеплитель: ${insulation.composition.value}`] : []),
  ].join('; ');

  /**
   * Уход считается по самому требовательному слою.
   *
   * Шерстяное пальто на вискозной подкладке стирать нельзя не потому, что
   * нельзя шерсть, а потому, что нельзя изделие целиком: мягкий режим
   * одного слоя не отменяет запрета другого. Порядок профилей в
   * справочнике идёт от свободного к строгому, и берётся последний.
   */
  const careOf = (line: typeof shell | undefined): string | undefined =>
    line ? (base.material(line.material_id).care_profile_id ?? undefined) : undefined;
  const careCandidates = [careOf(shell), careOf(lining), careOf(insulation)].filter(
    (id): id is string => typeof id === 'string',
  );
  const careProfileId = base.strictestCareProfile(careCandidates) ?? 'cotton_knit';

  if (
    lining &&
    careCandidates.length > 1 &&
    careProfileId !== (shellMaterial.care_profile_id ?? '')
  ) {
    const owner = [
      { role: 'подкладка', line: lining },
      { role: 'утеплитель', line: insulation },
      { role: 'основное полотно', line: shell },
    ].find((x) => x.line && base.material(x.line.material_id).care_profile_id === careProfileId);
    notes.push(
      `Режим ухода задан слоем «${owner?.role ?? 'подкладка'}» как самым требовательным, ` +
        'а не основным полотном. Проверьте, что он не вредит остальным слоям: ' +
        'синтетический утеплитель, например, требует барабанной сушки, а её запрет ' +
        'символом не выражается и идёт текстом.',
    );
  }

  const labels = buildLabels(
    {
      category: input.category,
      gender: input.gender,
      article: input.article,
      size_range: input.size_range,
      colorways: bom.colorways,
      composition,
      care_profile_id: careProfileId,
      ...(input.brand_profile === undefined ? {} : { brand: input.brand_profile }),
    },
    base,
  );
  notes.push(...labels.notes);

  // Нанесение считается ПОСЛЕ спецификации: выбор техники зависит от полотна,
  // а полотно определяется там. Обратный порядок дал бы сублимацию на хлопке.
  const artwork =
    input.artwork?.length || input.patterns?.length
      ? buildArtwork(
          {
            category: input.category,
            placements: input.artwork ?? [],
            fabric_class: shell.material_id,
            ...(input.patterns ? { patterns: input.patterns } : {}),
            ...(bom.batch_consumption_m === null
              ? {}
              : { batch_consumption_m: bom.batch_consumption_m }),
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
    ...(design ? { design } : {}),
    bom: {
      colorways: bom.colorways,
      lines: bom.lines,
      fabric_consumption_m: bom.fabric_consumption_m,
      ...(bom.fabric_surface ? { fabric_surface: bom.fabric_surface } : {}),
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
        [categoryDefaults.id]: categoryDefaults.version,
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
