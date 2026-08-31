import { CONFIDENCE_LEVELS, type Confidence } from '@seamster/core';
import { measurementsFrom, renderFlat } from '@seamster/flats';
import { renderHtml } from '@seamster/docgen';
import { specFingerprint, type StyleSpec } from '@seamster/stylespec';

/**
 * Инварианты продукта.
 *
 * То, что обязано быть верно для ЛЮБОГО техпака на любом входе. Проверяются
 * на каждом сценарии голден-сета: деградация ловится на всей матрице, а не
 * на удобном примере.
 *
 * Каждое нарушение возвращается строкой на человеческом языке — отчёт читает
 * человек, а не только тест-раннер.
 */
export interface Violation {
  rule: string;
  detail: string;
}

/**
 * Правдоподобные абсолютные диапазоны для трикотажного верха, см.
 *
 * Это не норматив, а сетка здравого смысла: если движок выдаёт рукав в метр
 * или горловину в сорок сантиметров, формулы сошлись, а вещь — нет.
 * Диапазоны намеренно широкие: они ловят катастрофу, а не неточность.
 */
const SANE_CM: Record<string, [number, number]> = {
  T01: [45, 100],
  T02: [42, 98],
  T03: [35, 90],
  T04: [30, 90],
  T05: [33, 92],
  T06: [28, 70],
  T07: [24, 65],
  T08: [24, 65],
  T09: [14, 40],
  // Нижняя граница 8, а не 12: у oversize плечо спущено до середины бицепса,
  // и рукав ОТ ПЛЕЧЕВОЙ ТОЧКИ у короткорукавного изделия законно вырождается
  // до ладони. Перебор сочетаний нашёл футболку oversize на росте 152 с
  // рукавом 11.9 см — это не дефект, а следствие спущенного плеча.
  T10: [8, 75],
  T11: [25, 100],
  T12: [10, 35],
  T13: [7, 30],
  T14: [10, 32],
  T15: [2, 22],
  T16: [0.5, 12],
  T17: [0.5, 8],
  T18: [1, 12],
  // Точки капюшона и кармана — только у худи и свитшота.
  H01: [22, 58],
  H02: [14, 48],
  H03: [25, 70],
  H04: [22, 62],
  H05: [10, 34],
  H06: [9, 32],
  H07: [3, 14],
  H08: [3, 14],
};

export function checkSpec(spec: StyleSpec): Violation[] {
  const v: Violation[] = [];
  const fail = (rule: string, detail: string): void => {
    v.push({ rule, detail });
  };

  // --- Честность значений -----------------------------------------------------
  for (const p of spec.measurements.points) {
    if (!p.base.source) fail('источник значения', `${p.code}: базовое значение без источника`);
    if (!p.tolerance.source) fail('источник значения', `${p.code}: допуск без источника`);
    if (!CONFIDENCE_LEVELS.includes(p.base.confidence)) {
      fail('статус значения', `${p.code}: неизвестный статус ${p.base.confidence}`);
    }
    for (const g of p.graded) {
      if (!g.value.source) fail('источник значения', `${p.code}/${g.ru}: градация без источника`);
    }
  }

  for (const n of spec.construction?.nodes ?? []) {
    if (!n.presence.source) fail('источник значения', `узел ${n.node_id} без источника`);
    if (!n.seam_allowance_cm.source)
      fail('источник значения', `припуск ${n.node_id} без источника`);
  }

  for (const l of spec.bom?.lines ?? []) {
    if (!l.composition.source) fail('источник значения', `${l.code}: состав без источника`);
  }

  // --- Числа --------------------------------------------------------------------
  for (const p of spec.measurements.points) {
    const all = [p.base.value, p.tolerance.value, ...p.graded.map((g) => g.value.value)];
    for (const n of all) {
      if (!Number.isFinite(n)) fail('конечные числа', `${p.code}: значение ${n}`);
    }
    if (p.tolerance.value <= 0) fail('допуск положителен', `${p.code}: ±${p.tolerance.value}`);
    if (p.base.value <= 0) fail('замер положителен', `${p.code}: ${p.base.value}`);

    // Точность хранения — 0.1 см (ADR-0004).
    for (const n of all) {
      if (Math.abs(n * 10 - Math.round(n * 10)) > 1e-9) {
        fail('точность 0.1 см', `${p.code}: ${n}`);
      }
    }
  }

  // --- Правдоподобие ------------------------------------------------------------
  for (const p of spec.measurements.points) {
    const range = SANE_CM[p.code];
    if (!range) continue;
    if (p.base.value < range[0] || p.base.value > range[1]) {
      fail(
        'правдоподобие замера',
        `${p.code} = ${p.base.value} см, ожидалось ${range[0]}–${range[1]}`,
      );
    }
  }

  const byCode = new Map(spec.measurements.points.map((p) => [p.code, p.base.value]));
  const chest = byCode.get('T03');
  const shoulder = byCode.get('T06');
  if (chest !== undefined && shoulder !== undefined && shoulder > chest) {
    fail('пропорции изделия', `плечи (${shoulder}) шире изделия по груди (${chest})`);
  }
  const sleeveOpening = byCode.get('T13');
  const bicep = byCode.get('T12');
  if (sleeveOpening !== undefined && bicep !== undefined && sleeveOpening > bicep) {
    fail('пропорции изделия', `низ рукава (${sleeveOpening}) шире рукава под проймой (${bicep})`);
  }
  const sleeveFromShoulder = byCode.get('T10');
  const sleeveFromCb = byCode.get('T11');
  const shoulderWidth = byCode.get('T06');
  if (sleeveFromShoulder !== undefined && sleeveFromCb !== undefined) {
    if (sleeveFromCb <= sleeveFromShoulder) {
      fail(
        'пропорции изделия',
        `длина рукава от центра спинки (${sleeveFromCb}) не больше длины от плеча (${sleeveFromShoulder})`,
      );
    }
    if (shoulderWidth !== undefined) {
      // Замер от центра спинки идёт через плечо: он обязан покрывать
      // половину ширины плеч плюс сам рукав, с запасом на кривизну.
      const minimum = shoulderWidth / 2 + sleeveFromShoulder * 0.85;
      if (sleeveFromCb < minimum) {
        fail(
          'пропорции изделия',
          `рукав от центра спинки (${sleeveFromCb}) короче суммы полуплеча и рукава (${minimum.toFixed(1)})`,
        );
      }
    }
  }

  const hoodWidth = byCode.get('H02');
  const hoodOpening = byCode.get('H03');
  if (hoodWidth !== undefined && hoodOpening !== undefined && hoodOpening <= hoodWidth) {
    fail(
      'пропорции изделия',
      `лицевой край капюшона (${hoodOpening}) не длиннее его ширины (${hoodWidth})`,
    );
  }

  const pocketWidth = byCode.get('H04');
  if (pocketWidth !== undefined && chest !== undefined && pocketWidth >= chest) {
    fail('пропорции изделия', `карман (${pocketWidth}) шире изделия по груди (${chest})`);
  }

  const pocketHeight = byCode.get('H05');
  const bodyLength = byCode.get('T01');
  if (pocketHeight !== undefined && bodyLength !== undefined && pocketHeight >= bodyLength * 0.6) {
    fail('пропорции изделия', `карман (${pocketHeight}) занимает больше половины длины изделия`);
  }

  const frontDrop = byCode.get('T15');
  const backDrop = byCode.get('T16');
  if (frontDrop !== undefined && backDrop !== undefined && backDrop > frontDrop) {
    fail('пропорции изделия', `горловина спинки (${backDrop}) глубже переда (${frontDrop})`);
  }

  // --- Согласованность длин ---------------------------------------------------
  //
  // Длина от высшей точки плеча и длина по центру спинки — это один и тот же
  // отрезок, отмеренный от двух линий, между которыми ровно глубина горловины
  // спинки. Тождество, а не приблизительное соотношение.
  //
  // Найдено на приёмке первых паков: футболка объявляла 74 от плеча, 66.6
  // по центру спинки и 2.8 глубины горловины — дыра 4.6 см ВНУТРИ одной
  // таблицы. Свитшот врал на 9.3. Поточечная проверка правдоподобия это
  // пропускала: каждое число по отдельности выглядело нормально.
  const LENGTH_TOLERANCE_CM = 1;
  const consistentLengths = (
    where: string,
    hps: number | undefined,
    cb: number | undefined,
    drop: number | undefined,
  ): void => {
    if (hps === undefined || cb === undefined || drop === undefined) return;
    const gap = cb - (hps - drop);
    if (Math.abs(gap) > LENGTH_TOLERANCE_CM) {
      fail(
        'согласованность длин',
        `${where}: T02 (${cb}) ≠ T01 − T16 (${(hps - drop).toFixed(1)}), расхождение ${gap.toFixed(1)} см`,
      );
    }
  };

  consistentLengths('базовый размер', byCode.get('T01'), byCode.get('T02'), byCode.get('T16'));

  // Сойтись на базовом размере и разойтись на остальных — отдельный способ
  // соврать, и именно его пропускает проверка одного размера.
  const gradedAt = (code: string, ru: number): number | undefined => {
    const point = spec.measurements.points.find((p) => p.code === code);
    if (!point) return undefined;
    return point.graded.find((g) => g.ru === ru)?.value.value ?? point.base.value;
  };
  for (const ru of spec.base.size_range) {
    if (ru === spec.base.base_size_ru) continue;
    consistentLengths(
      `размер ${ru}`,
      gradedAt('T01', ru),
      gradedAt('T02', ru),
      gradedAt('T16', ru),
    );
  }

  // --- Скорость градации --------------------------------------------------------
  //
  // Ширина по груди — ведущий признак размерной сетки. Ни одна точка не имеет
  // права расти по ряду быстрее неё: рукав, горловина или карман, обгоняющие
  // грудь, означают, что на большом размере вещь становится другой моделью.
  //
  // Найдено калибровкой эталоном v1.0: бицепс рос на 1.6 см против 0.5 по
  // первоисточнику ЕМКО, карман — на 0.8 против 0.2. По ряду 42–52 это давало
  // разброс кармана 4 см при 10 см по груди. Каждое отдельное значение
  // выглядело правдоподобным; неправдоподобной была скорость.
  const stepOf = (p: StyleSpec['measurements']['points'][number]): number | null => {
    if (p.graded.length === 0) return null;
    const values = [p.base.value, ...p.graded.map((g) => g.value.value)].sort((a, b) => a - b);
    return (values.at(-1)! - values[0]!) / (values.length - 1);
  };

  const chestStep = stepOf(spec.measurements.points.find((p) => p.code === 'T03')!);
  if (chestStep !== null && chestStep > 0) {
    for (const p of spec.measurements.points) {
      const step = stepOf(p);
      // Допуск на округление до 0.1 см на каждом конце ряда.
      if (step !== null && step > chestStep + 0.05) {
        fail(
          'скорость градации',
          `${p.code} растёт на ${step.toFixed(2)} см на размер — быстрее ведущей ` +
            `ширины по груди (${chestStep.toFixed(2)})`,
        );
      }
    }
  }

  // --- Анатомия ----------------------------------------------------------------
  //
  // Ширина плеч плюс две длины рукава — это размах рук в готовом изделии,
  // а он не может заметно превышать рост. Свитшот на приёмке выдал 198 см
  // при росте 170: и плечи 50.2, и рукав 74.1 по отдельности проходили
  // проверку правдоподобия, а вместе давали вещь, которую не наденут.
  const MAX_REACH_TO_HEIGHT = 1.1;
  const sleeve = byCode.get('T10');
  if (sleeve !== undefined && shoulderWidth !== undefined) {
    const reach = shoulderWidth + 2 * sleeve;
    const limit = spec.base.base_height_cm * MAX_REACH_TO_HEIGHT;
    if (reach > limit + 0.05) {
      fail(
        'анатомия',
        `размах в изделии ${reach.toFixed(1)} см (плечи ${shoulderWidth} + 2 × рукав ${sleeve}) ` +
          `при росте ${spec.base.base_height_cm} см — предел ${limit.toFixed(1)}`,
      );
    }
  }

  // --- Градация -------------------------------------------------------------------
  const expected = spec.base.size_range.filter((ru) => ru !== spec.base.base_size_ru);
  for (const p of spec.measurements.points) {
    if (p.graded.length === 0) continue;
    const covered = p.graded.map((g) => g.ru);
    if (covered.join() !== expected.join()) {
      fail('покрытие градации', `${p.code}: ${covered.join(',')} вместо ${expected.join(',')}`);
    }
    // Монотонность: значение обязано расти вместе с размером.
    const series = [...p.graded].sort((a, b) => a.ru - b.ru).map((g) => g.value.value);
    const sorted = [...series].sort((a, b) => a - b);
    if (series.join() !== sorted.join()) {
      fail('монотонность градации', `${p.code}: ${series.join(', ')}`);
    }
  }

  // --- Счётчик предположений ------------------------------------------------------
  const actual =
    spec.measurements.points.filter(
      (p) => p.base.confidence === 'assumption' || p.tolerance.confidence === 'assumption',
    ).length +
    (spec.construction?.nodes.filter((n) => n.presence.confidence === 'assumption').length ?? 0) +
    (spec.bom?.lines.filter(
      (l) => l.composition.confidence === 'assumption' || l.gsm?.confidence === 'assumption',
    ).length ?? 0);
  if (actual !== spec.meta.assumptions_count) {
    fail('счётчик предположений', `в meta ${spec.meta.assumptions_count}, в данных ${actual}`);
  }

  // --- Конструкция ------------------------------------------------------------------
  const nodeIds = new Set((spec.construction?.nodes ?? []).map((n) => n.node_id));
  for (const n of spec.construction?.nodes ?? []) {
    if (n.requires_special_equipment && !n.alternative) {
      fail('замена под парк машин', `узел ${n.node_id} требует спецмашины без альтернативы`);
    }
    if (n.spi <= 0) fail('SPI указан', `узел ${n.node_id}: SPI ${n.spi}`);
    if (n.seam_allowance_cm.value <= 0) {
      fail('припуск положителен', `узел ${n.node_id}: ${n.seam_allowance_cm.value}`);
    }
  }
  for (const s of spec.construction?.sequence ?? []) {
    if (s.node_id && !nodeIds.has(s.node_id)) {
      fail('целостность последовательности', `операция ${s.step} ссылается на ${s.node_id}`);
    }
  }

  // --- Маркировка ---------------------------------------------------------------------
  for (const r of spec.labels?.requisites ?? []) {
    if (r.value === null && r.action_ru === null) {
      fail('пробел объяснён', `реквизит ${r.id} пуст и не говорит, как заполнить`);
    }
  }
  const skus = (spec.labels?.sku_matrix ?? []).map((s) => s.sku);
  if (new Set(skus).size !== skus.length) fail('уникальность SKU', 'есть повторяющиеся артикулы');

  const expectedSkus = (spec.bom?.colorways.length ?? 0) * spec.base.size_range.length;
  if (spec.labels && skus.length !== expectedSkus) {
    fail('полнота матрицы SKU', `${skus.length} позиций вместо ${expectedSkus}`);
  }

  // --- Проекции: чертёж и документ ------------------------------------------------------
  for (const view of ['front', 'back'] as const) {
    const svg = renderFlat(measurementsFrom(spec), { view }).svg;
    if (svg.includes('NaN')) fail('чертёж без NaN', `вид ${view}`);
    if (!svg.includes('data-layer="outline"')) fail('чертёж послойный', `вид ${view}: нет контура`);
    if (svg.includes('<image') || svg.includes('base64')) {
      fail('вектор без растра', `вид ${view}: в чертеже растровая подложка`);
    }
  }

  const html = renderHtml(spec, { pro: true });
  for (const bad of ['NaN', 'undefined', '[object Object]']) {
    if (html.includes(bad)) fail('документ без мусора', `в HTML встречается «${bad}»`);
  }
  for (const p of spec.measurements.points) {
    if (!html.includes(`>${p.code}<`)) fail('полнота документа', `точка ${p.code} не попала в PDF`);
  }
  for (const n of spec.construction?.nodes ?? []) {
    if (!html.includes(n.label_ru)) fail('полнота документа', `узел ${n.label_ru} не попал в PDF`);
  }
  for (const l of spec.bom?.lines ?? []) {
    if (!html.includes(l.name_ru))
      fail('полнота документа', `материал ${l.name_ru} не попал в PDF`);
  }
  for (const s of spec.labels?.sku_matrix ?? []) {
    if (!html.includes(s.sku)) fail('полнота документа', `артикул ${s.sku} не попал в PDF`);
  }

  // --- Отпечаток --------------------------------------------------------------------------
  if (specFingerprint(spec) !== specFingerprint(spec)) {
    fail('устойчивость отпечатка', 'два вычисления дали разный результат');
  }

  return v;
}

/** Сводка по статусам — для отчёта, не для проверки. */
export function confidenceBreakdown(spec: StyleSpec): Record<Confidence, number> {
  const counts = Object.fromEntries(CONFIDENCE_LEVELS.map((c) => [c, 0])) as Record<
    Confidence,
    number
  >;
  for (const p of spec.measurements.points) counts[p.base.confidence]++;
  for (const n of spec.construction?.nodes ?? []) counts[n.presence.confidence]++;
  for (const l of spec.bom?.lines ?? []) counts[l.composition.confidence]++;
  return counts;
}
