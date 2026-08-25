import {
  SpecFormError,
  clamp,
  fromBase,
  roundCm,
  track,
  userInput,
  type Centimeters,
  type Confidence,
  type Tracked,
} from '@specform/core';
import {
  kb as defaultKb,
  type Category,
  type FabricKind,
  type FitIntent,
  type Gender,
  type KnowledgeBase,
  type PomPoint,
} from '@specform/kb';
import type { GradedValue, Measurements, PomValue } from '@specform/stylespec';

/**
 * POM-движок: строит табель мер.
 *
 * Алгоритм — knowledge-base/03 §5.2. Ключевая идея: абсолютные сантиметры
 * с одного фото получить нельзя (монокулярная неоднозначность масштаба),
 * поэтому масштаб приходит от пользователя — базовый размер и посадка, —
 * а фото даёт только безразмерные пропорции.
 *
 *   размер тела по сетке + прибавка на посадку  →  якорь (ширина по груди)
 *   якорь × пропорция с фото, с клэмпом         →  остальные точки
 *   класс точки                                  →  допуск
 *   приращения РФ                                →  градация по ряду
 *
 * Дифференциаторы: R1 (якорь от пользователя), R2 (автодопуски),
 * R3 (автоградация) — TECH-REQUIREMENTS-PIPELINE.md §5.
 */

export interface ManualMeasurement {
  /** Код точки, которую пользователь померил рулеткой. */
  code: string;
  value_cm: Centimeters;
}

/**
 * Уверенность vision-этапа в отдельной пропорции.
 * Переносится в документ примечанием: «оценка по фото, уверенность низкая».
 */
export type PhotoConfidence = 'high' | 'medium' | 'low';

export interface PhotoRatio {
  /** Отношение величины к якорю масштаба. */
  ratio: number;
  confidence?: PhotoConfidence;
  /** По каким ориентирам получено. Приходит из vision-отчёта. */
  reason?: string;
}

/** Форма, в которой vision отдаёт пропорции. Структурно совместима с VisionReport. */
export interface PhotoProportion {
  pom_code: string;
  ratio_to_chest: number;
  confidence: PhotoConfidence;
  reason?: string;
}

/**
 * Перевод пропорций vision-отчёта во вход POM-движка.
 *
 * Отношения с низкой уверенностью НЕ отбрасываются: промпт прямо разрешает
 * модели признаваться в неуверенности, и отбрасывать такие значения означало бы
 * наказывать её за честность. Вместо этого уверенность едет в документ примечанием —
 * пользователь видит и число, и то, насколько ему верить.
 */
export function photoRatiosFrom(
  proportions: readonly PhotoProportion[],
): Record<string, PhotoRatio> {
  const out: Record<string, PhotoRatio> = {};
  for (const p of proportions) {
    if (!(p.ratio_to_chest > 0)) continue; // ноль и отрицательное — мусор, не значение
    out[p.pom_code] = {
      ratio: p.ratio_to_chest,
      confidence: p.confidence,
      ...(p.reason === undefined ? {} : { reason: p.reason }),
    };
  }
  return out;
}

export interface PomInput {
  category: Category;
  gender: Gender;
  base_size_ru: number;
  base_height_cm: Centimeters;
  fit_intent: FitIntent;
  fabric_kind: FabricKind;
  /** Размерный ряд, по возрастанию. Обязан содержать базовый размер. */
  size_range: number[];
  /**
   * Безразмерные пропорции с фото: код точки → отношение к якорю.
   * Пусто для точек, которых на фото не видно, — тогда берётся типовое отношение.
   */
  photo_ratios?: Readonly<Record<string, number | PhotoRatio>>;
  /**
   * Один ручной замер линейно калибрует весь масштаб (knowledge-base/03 §5.2).
   * Самый дешёвый способ поднять точность, поэтому мастер его предлагает.
   */
  manual?: ManualMeasurement;
}

export interface PomResult {
  measurements: Measurements;
  /** Что движок решил не молча — уходит в отчёт пользователю и в лог. */
  notes: string[];
}

const CALIBRATED_NOTE = 'масштаб откалиброван по вашему замеру';

/**
 * Правдоподобный диапазон роста, см.
 *
 * ГОСТ 31396 задаёт женские ростовки 152–176, ГОСТ 31399 мужские 158–200.
 * Границы взяты шире норматива: продукт не обязан отказывать нетиповой фигуре.
 * Но за этими пределами поправка на ростовку превращает изделие в бессмыслицу —
 * при росте 300 см длина футболки выходила 123 см, и никто этого не замечал.
 */
const HEIGHT_RANGE = { min: 140, max: 210 } as const;

export function buildMeasurements(input: PomInput, base: KnowledgeBase = defaultKb()): PomResult {
  const notes: string[] = [];
  const template = base.pomTemplate(input.category);

  const duplicates = input.size_range.filter((ru, i) => input.size_range.indexOf(ru) !== i);
  if (duplicates.length) {
    // Дубль размера порождает дубль артикула SKU — два разных изделия под
    // одним кодом маркировки. Ловится здесь, а не на приёмке партии.
    throw new SpecFormError(
      'SPEC_INVALID',
      `размерный ряд содержит дубли: ${[...new Set(duplicates)].join(', ')}`,
      {
        userMessage: `В размерном ряду повторяются размеры: ${[...new Set(duplicates)].join(', ')}.`,
        userAction: 'Уберите повторы — каждый размер указывается один раз',
        details: { duplicates: [...new Set(duplicates)].join(', ') },
      },
    );
  }

  if (input.base_height_cm < HEIGHT_RANGE.min || input.base_height_cm > HEIGHT_RANGE.max) {
    throw new SpecFormError(
      'SPEC_INVALID',
      `рост ${input.base_height_cm} вне диапазона ${HEIGHT_RANGE.min}–${HEIGHT_RANGE.max}`,
      {
        userMessage: `Рост ${input.base_height_cm} см выходит за пределы, на которых мы умеем считать.`,
        userAction: `Укажите рост от ${HEIGHT_RANGE.min} до ${HEIGHT_RANGE.max} см`,
        details: { height: input.base_height_cm },
      },
    );
  }

  if (!input.size_range.includes(input.base_size_ru)) {
    throw new SpecFormError(
      'SPEC_INVALID',
      `базовый размер ${input.base_size_ru} вне ряда ${input.size_range.join(',')}`,
      {
        userMessage: 'Базовый размер не входит в выбранный размерный ряд.',
        userAction: 'Выберите базовый размер из ряда или расширьте ряд',
        details: { base: input.base_size_ru, range: input.size_range.join(', ') },
      },
    );
  }

  const anchorPoint = template.points.find((p) => p.derivation === 'anchor');
  if (!anchorPoint) throw new Error(`шаблон ${input.category} без якоря масштаба`);

  // --- 1. Якорь: обхват тела по сетке + прибавка на посадку --------------------
  const body = base.bodyMeasurements(input.gender, input.base_size_ru);
  const ease = base.easeFor(input.category, input.fit_intent, input.fabric_kind);

  if (ease.fallbackFrom) {
    notes.push(
      `Для категории «${input.category}» посадка «${ease.fallbackFrom}» не типовая — ` +
        `взяли «${ease.entry.fit}». Если нужно плотнее, поправьте ширину по груди вручную.`,
    );
  }

  // Прибавка задана как ПОЛНЫЙ обхват изделия минус обхват тела,
  // а якорь — половинный замер: делим на два ровно один раз.
  const anchorCm = (body.chest + ease.entry.default) / 2;

  // --- 2. Ростовка: длины подтягиваются к росту пользователя -------------------
  const chart = base.sizeChart(input.gender);
  const heightSteps = (input.base_height_cm - chart.base_height) / chart.height_step;
  if (heightSteps !== 0) {
    notes.push(
      `Рост ${input.base_height_cm} см против типового ${chart.base_height} см — ` +
        `длины пересчитаны на ${heightSteps > 0 ? '+' : ''}${roundCm(heightSteps)} ростовки.`,
    );
  }

  // --- 3. Значения точек ------------------------------------------------------
  const raw = new Map<string, Tracked<number>>();
  for (const point of template.points) {
    raw.set(point.code, valueFor(point, anchorPoint, anchorCm, heightSteps, input, base));
  }

  // --- 4. Калибровка по ручному замеру ---------------------------------------
  const scaled = input.manual ? calibrate(raw, input.manual, notes) : raw;

  // --- 5. Допуски и градация --------------------------------------------------
  const points: PomValue[] = template.points.map((point) => {
    const value = scaled.get(point.code)!;
    return {
      code: point.code,
      name_ru: point.name_ru,
      name_en: point.name_en,
      how_to_measure_ru: point.how_to_measure_ru,
      measure_kind: point.measure_kind,
      base: { ...value, value: roundCm(value.value) },
      tolerance: toleranceFor(point, input.fabric_kind, base),
      graded: gradeFor(point, value.value, input, base),
      required: point.required,
      pro_only: point.pro_only,
    };
  });

  return {
    measurements: {
      template_id: template.id,
      template_version: template.version,
      points,
    },
    notes,
  };
}

function normalizeRatio(value: number | PhotoRatio | undefined): PhotoRatio | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'number' ? { ratio: value } : value;
}

/** Значение одной точки до калибровки и округления. */
function valueFor(
  point: PomPoint,
  anchorPoint: PomPoint,
  anchorCm: Centimeters,
  heightSteps: number,
  input: PomInput,
  base: KnowledgeBase,
): Tracked<number> {
  if (point.derivation === 'anchor') {
    return fromBase(
      anchorCm,
      `engine:pom/anchor(size=${input.base_size_ru},fit=${input.fit_intent})`,
      'посчитано из размерной сетки и типовой прибавки на посадку — подтвердить по образцу',
    );
  }

  const photo = normalizeRatio(input.photo_ratios?.[point.code]);
  const photoRatio = photo?.ratio;
  const baseline = point.baseline_ratio!;
  const range = point.ratio_range;

  let ratio = baseline;
  let confidence: Confidence = 'default_from_base';
  let source = `kb:${anchorPoint.code}×baseline#${point.code}`;
  let note: string | undefined;

  // Ноль и отрицательное — не «наблюдение вне диапазона», а мусор. Ограничить
  // такое границей означало бы подменить типовое значение выдуманным: минус
  // единица превращалась в самое короткое правдоподобное изделие вместо типового.
  const usablePhotoRatio = photoRatio !== undefined && photoRatio > 0 ? photoRatio : undefined;

  if (usablePhotoRatio !== undefined && point.derivation === 'ratio_to_anchor') {
    const clamped = range ? clamp(usablePhotoRatio, range.min, range.max) : usablePhotoRatio;
    if (clamped !== usablePhotoRatio) {
      // Фото сказало неправдоподобное. Значение теперь не «то, что на фото»,
      // а граница нашего диапазона — понижаем статус и объясняем.
      ratio = clamped;
      note =
        `оценка по фото (${usablePhotoRatio.toFixed(2)}) вышла за правдоподобный диапазон ` +
        `${range!.min}–${range!.max} и ограничена — проверьте по образцу`;
      source = `engine:pom/clamped#${point.code}`;
    } else {
      ratio = usablePhotoRatio;
      confidence = 'estimated_from_photo';
      source = `vision:ratio#${point.code}`;
      // Уверенность модели едет в документ вместе со значением: пользователь
      // видит и число, и то, насколько ему верить.
      if (photo?.confidence === 'low') {
        note = photo.reason
          ? `уверенность по фото низкая (${photo.reason}) — подтвердить по образцу`
          : 'уверенность по фото низкая — подтвердить по образцу';
      } else if (photo?.confidence === 'medium') {
        note = 'уверенность по фото средняя — стоит проверить по образцу';
      }
    }
  }

  let value = anchorCm * ratio;

  // Ростовка двигает только длины — ширины от роста не зависят.
  const rule = base.gradingRule(point.grading_key);
  if (heightSteps !== 0 && rule.per_height !== 0) {
    value += rule.per_height * heightSteps;
  }

  return track(value, confidence, source, note);
}

/**
 * Линейная калибровка масштаба по одному ручному замеру.
 *
 * Пользователь померил одну точку рулеткой — этого достаточно, чтобы
 * подтянуть все остальные: пропорции между точками мы знаем, не знаем масштаб.
 */
function calibrate(
  raw: ReadonlyMap<string, Tracked<number>>,
  manual: ManualMeasurement,
  notes: string[],
): Map<string, Tracked<number>> {
  const computed = raw.get(manual.code);
  if (!computed) {
    throw new SpecFormError('SPEC_INVALID', `ручной замер для неизвестной точки ${manual.code}`, {
      userMessage: 'Не нашли точку, для которой вы указали замер.',
      userAction: 'Выберите точку из таблицы замеров',
      details: { code: manual.code },
    });
  }
  if (computed.value <= 0) throw new Error(`нулевое расчётное значение в точке ${manual.code}`);

  const factor = manual.value_cm / computed.value;
  const out = new Map<string, Tracked<number>>();

  for (const [code, value] of raw) {
    if (code === manual.code) {
      out.set(code, userInput(manual.value_cm, 'user:wizard.manual_measurement'));
      continue;
    }
    const note = value.note ? `${value.note}; ${CALIBRATED_NOTE}` : CALIBRATED_NOTE;
    out.set(code, track(value.value * factor, value.confidence, value.source, note));
  }

  notes.push(
    `Масштаб откалиброван по вашему замеру точки ${manual.code}: ` +
      `все значения умножены на ${factor.toFixed(3)}.`,
  );
  return out;
}

/** Допуск точки. Приоритет: явное значение категории > класс точки. */
function toleranceFor(point: PomPoint, fabric: FabricKind, base: KnowledgeBase): Tracked<number> {
  if (point.tolerance_cm !== undefined) {
    return fromBase(point.tolerance_cm, `kb:pom_templates#${point.code}.tolerance_cm`);
  }
  return fromBase(
    base.toleranceFor(point.tolerance_class, fabric),
    `kb:tolerance_classes#${point.tolerance_class}.${fabric}`,
  );
}

/**
 * Градация по размерному ряду.
 *
 * Российский размер равен половине обхвата груди, поэтому один размерный шаг
 * равен половине шага сетки по обхвату: 46 → 48 это один шаг.
 */
function gradeFor(
  point: PomPoint,
  baseValue: number,
  input: PomInput,
  base: KnowledgeBase,
): GradedValue[] {
  const rule = base.gradingRule(point.grading_key);
  if (rule.per_size === 0) return [];

  const ruPerStep = base.chestStep() / 2;
  const increment = rule.per_size * (input.fabric_kind === 'knit' ? rule.knit_multiplier : 1);

  return input.size_range
    .filter((ru) => ru !== input.base_size_ru)
    .map((ru) => {
      const steps = (ru - input.base_size_ru) / ruPerStep;
      return {
        ru,
        value: fromBase(
          roundCm(baseValue + increment * steps),
          `engine:pom/grading#${point.grading_key}`,
        ),
      };
    });
}

/** Сколько значений табеля мер требуют подтверждения по образцу. */
export function countMeasurementAssumptions(measurements: Measurements): number {
  return measurements.points.filter(
    (p) => p.base.confidence === 'assumption' || p.tolerance.confidence === 'assumption',
  ).length;
}
