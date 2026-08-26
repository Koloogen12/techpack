import {
  SeamsterlyError,
  clamp,
  confidenceRank,
  fromBase,
  measuredByScale,
  roundCm,
  track,
  userInput,
  type Centimeters,
  type Confidence,
  type Tracked,
} from '@seamsterly/core';
import {
  CATEGORY_LABEL_RU,
  FIT_INTENT_LABEL_RU,
  kb as defaultKb,
  type Category,
  type FabricKind,
  type FitIntent,
  type Gender,
  type KnowledgeBase,
  type PomPoint,
  type ScaleReferenceId,
  type ScaleSide,
  type ToleranceProfileId,
} from '@seamsterly/kb';
import type { GradedValue, Measurements, PomValue } from '@seamsterly/stylespec';

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
  /**
   * Набор допусков. По умолчанию ГОСТ 23193-78 — норматив РФ, фабрике привычен
   * и достижим. `premium` жёстче: осознанный выбор бренда, готового платить
   * за отбраковку, а не «настройка качества».
   */
  tolerance_profile?: ToleranceProfileId;
  /** Предмет известного размера в кадре — см. `resolveScale`. */
  scale?: ScaleObservation;
}

/**
 * Наблюдение опорного предмета на снимке.
 *
 * Структурно совместимо с полем `scale_object` отчёта разбора. Истинный размер
 * предмета сюда НЕ входит: он берётся из справочника по `kind`, потому что
 * величина, заданная стандартом, не должна зависеть от того, что показалось
 * на фотографии.
 */
export interface ScaleObservation {
  kind: ScaleReferenceId | 'none';
  side: ScaleSide;
  /** Отношение измеренной стороны предмета к опорной величине изделия. */
  ratio_to_anchor: number;
  /** Предмет лежит в плоскости изделия. Иначе масштаб искажён перспективой. */
  coplanar: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason?: string;
}

/**
 * Правдоподобный диапазон опорной величины (половина обхвата груди), см.
 *
 * Ошибка определения краёв предмета входит в пересчёт делением, поэтому
 * маленькая ошибка отношения даёт большую ошибку сантиметров. Значение вне
 * этих границ означает, что предмет опознан неверно, — и молча взять его
 * за масштаб хуже, чем не взять вовсе.
 */
const SCALE_ANCHOR_RANGE = { min: 25, max: 90 } as const;

/**
 * Насколько якорь по сетке и якорь по масштабу могут расходиться, доля.
 *
 * Расхождение больше этого — не погрешность, а сообщение: указанный размер
 * не соответствует вещи на снимке. Это не ошибка продукта, а находка для
 * пользователя, и молчать о ней нельзя.
 */
const ANCHOR_DISAGREEMENT = 0.05;

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

/**
 * Полуобхват груди, на котором откалиброваны отношения к росту, см.
 *
 * Женский RU 46 (обхват 92) — опорный случай продукта. Точки, привязанные
 * к росту, получают поправку на отклонение размера от этой опоры.
 */
const REFERENCE_CHEST_HALF = 46;

export function buildMeasurements(input: PomInput, base: KnowledgeBase = defaultKb()): PomResult {
  const notes: string[] = [];
  const template = base.pomTemplate(input.category);

  const duplicates = input.size_range.filter((ru, i) => input.size_range.indexOf(ru) !== i);
  if (duplicates.length) {
    // Дубль размера порождает дубль артикула SKU — два разных изделия под
    // одним кодом маркировки. Ловится здесь, а не на приёмке партии.
    throw new SeamsterlyError(
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
    throw new SeamsterlyError(
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
    throw new SeamsterlyError(
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
      `Для категории «${CATEGORY_LABEL_RU[input.category]}» посадка ` +
        `«${FIT_INTENT_LABEL_RU[ease.fallbackFrom]}» не типовая — взяли ` +
        `«${FIT_INTENT_LABEL_RU[ease.entry.fit]}». Если нужно плотнее, ` +
        `поправьте ширину по груди вручную.`,
    );
  }

  // Прибавка задана как ПОЛНЫЙ обхват изделия минус обхват тела,
  // а якорь — половинный замер: делим на два ровно один раз.
  const anchorFromChart = (body.chest + ease.entry.default) / 2;

  // Предмет известного размера в кадре, если он там был, задаёт масштаб
  // ИЗМЕРЕНИЕМ, а не расчётом от заявленного размера.
  const scale = resolveScale(input.scale, anchorFromChart, notes, base);
  const anchorCm = scale?.cm ?? anchorFromChart;

  // Второй якорь — тело без прибавки. За ним следуют горловина и наклон плеча:
  // oversize делает изделие шире, а не длиннее.
  const bodyAnchorCm = body.chest / 2;

  // Третий якорь — рост. За ним следуют длины изделия и рукава. Поправка
  // на размер к ним прибавляется отдельным слагаемым: человек на четыре
  // размера больше не имеет рук на четверть длиннее, он шире.
  const referenceChestHalf = REFERENCE_CHEST_HALF;
  const sizeStepsFromReference = (bodyAnchorCm - referenceChestHalf) / (base.chestStep() / 2);

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

  // Сначала точки, считающиеся сами по себе.
  for (const point of template.points) {
    if (point.derivation === 'composed') continue;
    raw.set(
      point.code,
      valueFor(point, {
        garment: anchorCm,
        body: bodyAnchorCm,
        height: input.base_height_cm,
        sizeStepsFromReference,
        heightSteps,
        input,
        base,
        ...(scale ? { scale } : {}),
      }),
    );
  }

  // Ширина плеч ограничивается шириной изделия ДО составных точек по той же
  // причине, что и рукав: длина рукава от центра спинки складывается из них.
  clampShoulder(raw, notes);

  // Анатомический предел проверяется ДО составных точек: длина рукава от
  // центра спинки складывается из ширины плеч и длины рукава, и подрезать
  // её после сложения значило бы получить сумму, не равную слагаемым.
  clampReach(raw, input, notes);

  // Затем составные — они ссылаются на уже посчитанные.
  for (const point of template.points) {
    if (point.derivation !== 'composed') continue;
    raw.set(point.code, composeValue(point, raw));
  }

  // --- 4. Калибровка по ручному замеру ---------------------------------------
  const scaled = input.manual ? calibrate(raw, input.manual, notes) : raw;

  // --- 5. Допуски и градация --------------------------------------------------
  // Градация считается в два прохода по той же причине, что и значения:
  // составная точка обязана складываться из слагаемых НА КАЖДОМ размере,
  // иначе таблица сходится на базовом размере и расходится на остальных.
  const graded = new Map<string, GradedValue[]>();
  for (const point of template.points) {
    if (point.derivation === 'composed') continue;
    graded.set(point.code, gradeFor(point, scaled.get(point.code)!.value, input, base));
  }
  for (const point of template.points) {
    if (point.derivation !== 'composed') continue;
    graded.set(point.code, composeGraded(point, scaled, graded, input));
  }

  const points: PomValue[] = template.points.map((point) => {
    const value = scaled.get(point.code)!;
    return {
      code: point.code,
      name_ru: point.name_ru,
      name_en: point.name_en,
      name_zh: point.name_zh,
      how_to_measure_ru: point.how_to_measure_ru,
      how_to_measure_en: point.how_to_measure_en,
      how_to_measure_zh: point.how_to_measure_zh,
      translation_verified: point.translation_verified,
      measure_kind: point.measure_kind,
      base: { ...value, value: roundCm(value.value) },
      tolerance: toleranceFor(point, input.fabric_kind, base, input.tolerance_profile),
      graded: graded.get(point.code)!,
      required: point.required,
      pro_only: point.pro_only,
    };
  });

  notes.push(...separatingPoints(points));

  return {
    measurements: {
      template_id: template.id,
      template_version: template.version,
      points,
    },
    notes,
  };
}

/** Масштаб, принятый к работе. */
interface ResolvedScale {
  cm: Centimeters;
  reference: string;
  label: string;
}

/**
 * Пересчёт кадра в сантиметры по предмету известного размера.
 *
 * Возвращает null и объясняет причину каждый раз, когда предмету нельзя
 * доверять. Молчаливый отказ здесь опаснее всего: пользователь положил лист
 * в кадр, ждёт измерения, а получил ту же оценку — и не узнал, почему.
 *
 * Каждая проверка ниже закрывает конкретный способ соврать:
 * предмет не в плоскости изделия даёт масштаб, искажённый перспективой;
 * низкая уверенность означает, что края предмета не найдены; результат вне
 * правдоподобного диапазона означает, что предмет опознан неверно, — ошибка
 * отношения входит в пересчёт делением и потому усиливается, а не гасится.
 */
function resolveScale(
  observation: ScaleObservation | undefined,
  anchorFromChart: Centimeters,
  notes: string[],
  base: KnowledgeBase,
): ResolvedScale | null {
  if (!observation || observation.kind === 'none') return null;

  const ref = base.scaleReference(observation.kind);

  if (!(observation.ratio_to_anchor > 0)) return null;

  if (!observation.coplanar) {
    notes.push(
      `В кадре есть опорный предмет (${ref.label_ru}), но он лежит не в плоскости ` +
        `изделия — ` +
        `перспектива искажает масштаб, и по нему считать нельзя. Замеры взяты от указанного ` +
        `размера, как обычно. ${ref.how_to_place_ru}`,
    );
    return null;
  }

  if (observation.confidence === 'low') {
    notes.push(
      `В кадре похож на опорный предмет (${ref.label_ru}), но его края определяются ` +
        `неуверенно, и масштаб по нему не считался. Переснимите так, чтобы предмет ` +
        `целиком попадал в кадр и был хорошо освещён.`,
    );
    return null;
  }

  const cm =
    base.scaleReferenceCm(observation.kind, observation.side) / observation.ratio_to_anchor;

  if (cm < SCALE_ANCHOR_RANGE.min || cm > SCALE_ANCHOR_RANGE.max) {
    notes.push(
      `Масштаб по предмету в кадре дал ширину по груди ${roundCm(cm)} см — это вне ` +
        `правдоподобного диапазона ${SCALE_ANCHOR_RANGE.min}–${SCALE_ANCHOR_RANGE.max} см, ` +
        `значит предмет опознан неверно. Масштаб не использован.`,
    );
    return null;
  }

  const drift = Math.abs(cm - anchorFromChart) / anchorFromChart;
  if (drift > ANCHOR_DISAGREEMENT) {
    // Это не сбой, а находка: вещь на снимке не соответствует заявленному
    // размеру. Чаще всего врёт бирка, а не наш расчёт.
    notes.push(
      `Заявленный размер и вещь на снимке расходятся на ${Math.round(drift * 100)}%: ` +
        `по размерной сетке ширина по груди вышла бы ${roundCm(anchorFromChart)} см, ` +
        `а по опорному предмету в кадре (${ref.label_ru}) получается ${roundCm(cm)} см. ` +
        `Документ собран по измерению — оно ближе к факту, чем размер на бирке. ` +
        `Если верен размер, а не снимок, уберите предмет из кадра и повторите.`,
    );
  }

  notes.push(
    `Масштаб снят с кадра по предмету известного размера (${ref.label_ru}): ` +
      `ширина по груди ${roundCm(cm)} см — это измерение, а не оценка. Остальные точки ` +
      `по-прежнему пропорции с фото, но теперь они отложены от измеренной величины.`,
  );

  return { cm, reference: observation.kind, label: ref.label_ru };
}

function normalizeRatio(value: number | PhotoRatio | undefined): PhotoRatio | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'number' ? { ratio: value } : value;
}

/**
 * Составная точка: сумма других точек с коэффициентами.
 *
 * Такой замер по определению является суммой — длина рукава от центра спинки
 * идёт через плечо. Считать её отдельной пропорцией значит позволить документу
 * противоречить самому себе: на oversize плечи расширялись, а сумма — нет.
 *
 * Статус наследуется по слабейшему звену: сумма не может быть достовернее
 * самого сомнительного из слагаемых.
 */
/**
 * Плечи не бывают шире изделия.
 *
 * Плечевой шов идёт по верхнему краю той же детали, ширину которой меряет
 * ширина по груди: панель не может быть уже собственного края. У спущенного
 * плеча величины сходятся почти вплотную, но не переходят друг друга.
 *
 * Найдено, когда в голден-набор добавили кадр спинки: на разложенном оверсайз-худи
 * модель приняла за плечевую линию верх оката рукава и выдала плечи 69.3 при
 * ширине по груди 66. Поточечная проверка правдоподобия пропускала — оба числа
 * по отдельности нормальны для оверсайза.
 */
function clampShoulder(raw: Map<string, Tracked<number>>, notes: string[]): void {
  const shoulder = raw.get('T06');
  const chest = raw.get('T03');
  if (!shoulder || !chest || shoulder.value <= chest.value) return;

  notes.push(
    `Ширина плеч по фото вышла ${roundCm(shoulder.value)} см при ширине по груди ` +
      `${roundCm(chest.value)} см — плечи шире изделия, чего не бывает: на снимке ` +
      `за плечевую линию принят верх оката рукава. Значение ограничено шириной ` +
      `изделия. Подтвердите по образцу — особенно если плечо спущенное.`,
  );

  raw.set(
    'T06',
    track(
      chest.value,
      'default_from_base',
      'engine:pom/shoulder-vs-chest',
      'ограничено шириной изделия: плечи не бывают шире панели — проверьте по образцу',
    ),
  );
}

/**
 * Анатомический предел размаха.
 *
 * Ширина плеч плюс две длины рукава — это размах рук в готовом изделии.
 * У человека размах примерно равен росту; с манжетой и свободой изделия
 * запас в десять процентов покрывает всё разумное. Больше — значит рукав
 * длиннее руки, а такую вещь не наденут.
 *
 * Поточечный клэмп это поймать не может: и ширина плеч, и длина рукава
 * по отдельности остаются правдоподобными. Свитшот на первом прогоне вышел
 * с рукавом 74.1 при плечах 50.2 — 198 см размаха при росте 170. Каждое
 * число в отдельности проходило, сумма не проходила никак.
 *
 * Излишек снимается с РУКАВА: ширина плеч в плоской раскладке читается
 * уверенно, а длину рукава завышает диагональная укладка — именно на неё
 * жаловалась модель разбора на том самом снимке.
 */
const MAX_REACH_TO_HEIGHT = 1.1;

function clampReach(raw: Map<string, Tracked<number>>, input: PomInput, notes: string[]): void {
  const shoulder = raw.get('T06');
  const sleeve = raw.get('T10');
  if (!shoulder || !sleeve) return;

  // Сравниваем ОКРУГЛЁННЫЕ значения — те самые, что попадут в документ.
  // Иначе округление на выходе способно добавить последнюю десятую и вывести
  // сумму за предел уже после проверки; на переборе входов такой случай нашёлся.
  const shoulderCm = roundCm(shoulder.value);
  const sleeveCm = roundCm(sleeve.value);
  const limit = input.base_height_cm * MAX_REACH_TO_HEIGHT;
  const reach = shoulderCm + 2 * sleeveCm;
  if (reach <= limit) return;

  // Вниз до десятой: клэмп не имеет права округлять в сторону нарушения.
  const allowed = Math.floor(((limit - shoulderCm) / 2) * 10) / 10;
  if (allowed <= 0) {
    // Плечи сами по себе шире анатомического предела — рукав тут ни при чём,
    // и подрезать его до нуля значило бы спрятать настоящую проблему.
    notes.push(
      `Ширина плеч ${shoulderCm} см сама по себе превышает анатомический ` +
        `предел размаха для роста ${roundCm(input.base_height_cm)} см. Длина рукава ` +
        `не поправлена: проверьте ширину плеч по образцу — скорее всего ошибка в ней.`,
    );
    return;
  }

  notes.push(
    `Длина рукава ограничена анатомией: ширина плеч ${shoulderCm} см плюс ` +
      `две длины рукава давали размах ${roundCm(reach)} см при росте ` +
      `${roundCm(input.base_height_cm)} см — это длиннее руки. Рукав уменьшен с ` +
      `${sleeveCm} до ${allowed} см. Подтвердите по образцу: ` +
      `чаще всего отношение завышает диагональная укладка рукава на снимке.`,
  );

  raw.set(
    'T10',
    track(
      allowed,
      // Значение больше не «то, что на фото», а наша граница — статус падает.
      'default_from_base',
      'engine:pom/anatomy#T10',
      `ограничено анатомическим пределом размаха (плечи + 2 × рукав ≤ рост × ${MAX_REACH_TO_HEIGHT}) — проверьте по образцу`,
    ),
  );
}

/**
 * Градация составной точки — из градации её слагаемых.
 *
 * Считать составную точку по собственному правилу приращения значит позволить
 * таблице сойтись на базовом размере и разойтись на всех остальных: сумма
 * слагаемых растёт по их правилам, а сама точка — по своему.
 *
 * Слагаемое без градации (правило с нулевым приращением) на всех размерах
 * равно своему базовому значению — так и берётся.
 */
function composeGraded(
  point: PomPoint,
  values: ReadonlyMap<string, Tracked<number>>,
  graded: ReadonlyMap<string, GradedValue[]>,
  input: PomInput,
): GradedValue[] {
  const parts = point.composed_of ?? [];

  // Ни одно слагаемое не градуируется — не градуируется и сумма. В документе
  // это честный прочерк, а не столбец одинаковых чисел.
  if (parts.every((p) => !graded.get(p.code)?.length)) return [];

  return input.size_range
    .filter((ru) => ru !== input.base_size_ru)
    .map((ru) => {
      let sum = 0;
      for (const part of parts) {
        const row = graded.get(part.code)?.find((g) => g.ru === ru);
        sum += (row?.value.value ?? values.get(part.code)!.value) * part.factor;
      }
      return {
        ru,
        value: fromBase(
          roundCm(sum),
          `engine:pom/composed(${parts.map((p) => `${p.factor}×${p.code}`).join('+')})`,
        ),
      };
    });
}

function composeValue(
  point: PomPoint,
  computed: ReadonlyMap<string, Tracked<number>>,
): Tracked<number> {
  const parts = point.composed_of ?? [];
  let sum = 0;
  let weakest: Confidence = 'fit_confirmed';

  for (const part of parts) {
    const value = computed.get(part.code);
    if (!value) {
      throw new Error(
        `точка ${point.code} складывается из ${part.code}, которой нет в шаблоне ` +
          `или которая сама составная`,
      );
    }
    sum += value.value * part.factor;
    if (confidenceRank(value.confidence) < confidenceRank(weakest)) weakest = value.confidence;
  }

  // Разность может уйти в ноль, если вычитаемое слагаемое вышло абсурдным.
  // Отрицательный замер в документе хуже, чем громкая ошибка здесь.
  if (sum <= 0) {
    throw new Error(
      `точка ${point.code} посчиталась как ${roundCm(sum)} см из ` +
        `${parts.map((p) => `${p.factor}×${p.code}`).join(' + ')} — ` +
        `проверьте слагаемые, замер не может быть неположительным`,
    );
  }

  return track(
    sum,
    weakest,
    `engine:pom/composed(${parts.map((p) => `${p.factor}×${p.code}`).join('+')})`,
  );
}

/** Значение одной точки до калибровки и округления. */
/**
 * Типовое значение точки — то, что подставляется, когда фото молчит.
 *
 * Точка сама объявляет, за чем следует её величина: за шириной изделия
 * с прибавкой, за обхватом тела или за ростом.
 */
function baselineValue(
  point: PomPoint,
  rule: { per_size: number; per_height: number },
  ctx: ValueContext,
): number {
  const ratio = point.baseline_ratio!;

  if (point.anchor_basis === 'height') {
    // Длина следует за ростом, а размер добавляет поправку тем же приращением,
    // которым точка градуируется внутри ряда. Отдельная поправка на ростовку
    // не нужна: рост уже входит в основную величину.
    return ctx.height * ratio + rule.per_size * ctx.sizeStepsFromReference;
  }

  // Привязка обязательна по схеме справочника, дефолта здесь нет намеренно.
  const anchor = point.anchor_basis === 'body' ? ctx.body : ctx.garment;
  const value = anchor * ratio;
  // Ростовка двигает только те точки, для которых правило её задаёт.
  return ctx.heightSteps !== 0 && rule.per_height !== 0
    ? value + rule.per_height * ctx.heightSteps
    : value;
}

interface ValueContext {
  garment: Centimeters;
  body: Centimeters;
  height: Centimeters;
  /** На сколько размеров базовый размер отличается от опорного. */
  sizeStepsFromReference: number;
  heightSteps: number;
  input: PomInput;
  base: KnowledgeBase;
  /** Масштаб взят из кадра. Заполнено — якорь измерен, а не рассчитан. */
  scale?: ResolvedScale;
}

function valueFor(point: PomPoint, ctx: ValueContext): Tracked<number> {
  const { input, base } = ctx;
  if (point.derivation === 'anchor') {
    // Якорь, полученный по предмету известного размера, — это замер, а не
    // расчёт от заявленного размера. Остальные точки при этом остаются
    // оценкой: их ОТНОШЕНИЕ по-прежнему получено глазами модели, и правильный
    // масштаб не делает правильной саму пропорцию.
    if (ctx.scale) {
      return measuredByScale(
        ctx.garment,
        `vision:scale#${ctx.scale.reference}`,
        `пересчитано через опорный предмет в кадре (${ctx.scale.label}) — ` +
          `это измерение, а не оценка по пропорции`,
      );
    }
    return fromBase(
      ctx.garment,
      `engine:pom/anchor(size=${input.base_size_ru},fit=${input.fit_intent})`,
      'посчитано из размерной сетки и типовой прибавки на посадку — подтвердить по образцу',
    );
  }

  const photo = normalizeRatio(input.photo_ratios?.[point.code]);
  const rule = base.gradingRule(point.grading_key);

  // --- Типовое значение по привязке точки -------------------------------------
  let value = baselineValue(point, rule, ctx);
  let confidence: Confidence = 'default_from_base';
  let source = `kb:baseline#${point.code}`;
  let note: string | undefined;

  // Ноль и отрицательное — не «наблюдение вне диапазона», а мусор. Ограничить
  // такое границей значило бы подменить типовое значение выдуманным.
  const observedRatio = photo?.ratio !== undefined && photo.ratio > 0 ? photo.ratio : undefined;

  if (observedRatio !== undefined && point.derivation === 'ratio_to_anchor') {
    // ВАЖНО: модель отдаёт отношение к ширине по груди — так устроен её отчёт.
    // Значит наблюдение переводится в сантиметры через якорь ИЗДЕЛИЯ, каким бы
    // ни была собственная привязка точки. Иначе отношение к груди умножалось
    // бы на рост, и длина изделия уезжала в метры.
    const observed = ctx.garment * observedRatio;

    // Границы правдоподобия задаются относительно типового значения — так они
    // работают для любой привязки, а не только для точек от ширины изделия.
    const span =
      point.ratio_range && point.baseline_ratio
        ? {
            low: value * (point.ratio_range.min / point.baseline_ratio),
            high: value * (point.ratio_range.max / point.baseline_ratio),
          }
        : { low: value * 0.65, high: value * 1.4 };

    const clamped = clamp(observed, span.low, span.high);

    if (Math.abs(clamped - observed) > 1e-9) {
      // Фото сказало неправдоподобное. Значение теперь не «то, что на фото»,
      // а граница нашего диапазона — понижаем статус и объясняем.
      value = clamped;
      note =
        `оценка по фото (${roundCm(observed)} см) вышла за правдоподобный диапазон ` +
        `${roundCm(span.low)}–${roundCm(span.high)} см и ограничена — проверьте по образцу`;
      source = `engine:pom/clamped#${point.code}`;
    } else {
      value = observed;
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
    throw new SeamsterlyError('SPEC_INVALID', `ручной замер для неизвестной точки ${manual.code}`, {
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
function toleranceFor(
  point: PomPoint,
  fabric: FabricKind,
  base: KnowledgeBase,
  profile: ToleranceProfileId = 'gost',
): Tracked<number> {
  if (point.tolerance_cm !== undefined) {
    return fromBase(point.tolerance_cm, `kb:pom_templates#${point.code}.tolerance_cm`);
  }
  return fromBase(
    base.toleranceFor(point.tolerance_class, fabric, profile),
    `kb:tolerance_classes#${point.tolerance_class}.${fabric}.${profile}`,
  );
}

/**
 * По каким точкам ряд вообще различим.
 *
 * Международное правило приёмки: допуск не должен превышать половину шага
 * градации, иначе диапазоны соседних размеров перекрываются и одно изделие
 * законно проходит приёмку сразу в двух размерах.
 *
 * На трикотажном верхе правило выполнимо не везде: мелкие точки градуируются
 * на десятые доли, а меряются с погрешностью в полсантиметра. Это свойство
 * материала, а не ошибка документа, — поэтому здесь предупреждение,
 * а не отказ собирать спеку.
 *
 * Перечисляем НЕ нарушителей, а те точки, по которым размеры различаются:
 * нарушителей две трети таблицы, и такой список читать никто не станет,
 * а короткий список «сортируйте по этим двум» — станет.
 */
function separatingPoints(points: readonly PomValue[]): string[] {
  const graded = points.filter((p) => p.graded.length > 0);
  if (!graded.length) return [];

  const separates = graded.filter((p) => {
    const values = [p.base.value, ...p.graded.map((g) => g.value.value)].sort((a, b) => a - b);
    const perSize = (values.at(-1)! - values[0]!) / (values.length - 1);
    return perSize > 0 && p.tolerance.value <= perSize / 2;
  });

  if (separates.length === graded.length) return [];

  if (!separates.length) {
    return [
      'Ни по одной точке табеля соседние размеры не различаются: допуск везде шире ' +
        'половины шага градации. Проверьте размерный ряд — возможно, он слишком плотный ' +
        'для выбранного полотна.',
    ];
  }

  return [
    `Соседние размеры надёжно различаются только по этим точкам: ` +
      `${separates.map((p) => `${p.code} (${p.name_ru.toLowerCase()})`).join(', ')}. ` +
      `По остальным допуск шире половины шага градации, и одно изделие законно проходит ` +
      `приёмку сразу в двух размерах. Для трикотажа это норма: мелкие точки растут ` +
      `на десятые доли, а рулетка читается с точностью до половины сантиметра. ` +
      `ОТК: сортируйте ряд по названным точкам, остальные проверяйте на попадание ` +
      `в допуск своего размера, а не на отличие от соседнего.`,
  ];
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
