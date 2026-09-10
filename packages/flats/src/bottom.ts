import type { Centimeters } from '@seamster/core';
import type { Point } from './geometry.js';
import type { FlatPanel, FlatPaths, SeamLine } from './paths.js';
import { C, L, lerp, M } from './svg.js';

/**
 * Технический чертёж НИЗА: юбка и брюки.
 *
 * Отдельный модуль, а не ветка в geometry.ts, по двум причинам.
 *
 * Первая — другая система отсчёта. У верха начало координат на линии высших
 * точек плеч, и всё строится от плеча вниз. У низа плеча нет вовсе: все его
 * точки меряются ОТ ВЕРХНЕГО КРАЯ ПОЯСА (B04 — на 10 см ниже, B05 — на 18–20,
 * колено — на 30–35 ниже точки схождения). Свести две системы в одну функцию
 * значило бы завести в ней ветку «а если плеча нет» на каждом шаге.
 *
 * Вторая — низ рисуется ЦЕЛИКОМ, а не половиной с зеркалом. У верха зеркало
 * гарантирует симметрию бесплатно, у брюк оно нарисовало бы вторую застёжку:
 * гульфик лежит на одной стороне. Симметрия здесь получается иначе — обе
 * половины строятся из одних и тех же точек со знаком, и совпадение
 * гарантировано построением, а не совпадением формул.
 *
 * Ось X вправо, ось Y вниз, ноль — центр переда (спинки) на верхнем крае пояса.
 */

/** B04 меряется на 10 см ниже верхнего края пояса — уровень задан замером. */
const HIGH_HIP_CM = 10;
/** B05 меряется на 18–20 см ниже верхнего края пояса; берём середину. */
const HIP_CM = 19;
/** B09 меряется на 30–35 см ниже точки схождения шаговых швов; берём середину. */
const KNEE_BELOW_CROTCH_CM = 32.5;

/**
 * Ширина вытачки по верхнему срезу — ЗНАК, а не замер.
 *
 * В табеле мер её нет: там есть только длина вытачки. Подставить сюда
 * сантиметры значило бы выдать за замер число, которого никто не мерил, —
 * поэтому раствор берётся долей от длины: треугольник читается при любом
 * масштабе и остаётся условным обозначением (knowledge-base/02 §4),
 * с которого не снимают размеров.
 */
const DART_OPENING_SHARE = 0.28;

/** Вытачка стоит посередине между центром и боковым швом: табель её не размещает. */
const DART_AT = 0.5;

/** Ширина шлёвки, см. Условное обозначение: своей величины в табеле мер нет. */
const BELT_LOOP_WIDTH = 1;

/**
 * Минимальный зазор между брючинами у центра, доля полуширины по бёдрам.
 *
 * При нуле контур сходится в точку, шаговые швы сливаются с центром изделия,
 * и вырез между брючинами перестаёт читаться. Зазор — свойство РИСУНКА,
 * поэтому взят долей габарита, а не сантиметрами.
 */
const LEG_GAP_SHARE = 0.02;

export type BottomKind = 'skirt' | 'trousers';

/** Замеры, общие для всякого изделия низа. Коды — из шаблонов точек. */
interface BottomCommon {
  /** B01 ширина по талии — по верхнему краю пояса, в плоском виде. */
  waistFlat: Centimeters;
  /** B03 высота пояса от верхнего края до шва притачивания. */
  waistbandHeight: Centimeters;
  /** B04 ширина по линии высокого бедра. */
  highHipFlat: Centimeters;
  /**
   * B05 ширина по бёдрам — якорь масштаба низа.
   *
   * Как и у верха, half-замер это ПОЛНАЯ ширина разложенного изделия:
   * боковой шов стоит на её половине.
   */
  hipFlat: Centimeters;
  /**
   * Глубина подгибки низа, см. У брюк это замер B16, у юбки его в табеле нет,
   * и величина приходит припуском узла подгибки.
   */
  hemAllowance?: Centimeters;
}

export interface SkirtMeasurements extends BottomCommon {
  kind: 'skirt';
  /** J01 длина юбки по центру спинки от верхнего края пояса. */
  length: Centimeters;
  /** J02 ширина по подолу. */
  sweepFlat: Centimeters;
  /** J03 длина вытачки от верхнего среза до вершины. */
  dartLength?: Centimeters;
  /** J04 длина шлицы от края низа вверх до закрепки. */
  ventLength?: Centimeters;
  /** J05 длина застёжки-молнии от верхнего края пояса. */
  zipLength?: Centimeters;
}

export interface TrousersMeasurements extends BottomCommon {
  kind: 'trousers';
  /** B06 посадка переда по среднему шву. */
  frontRise: Centimeters;
  /** B07 посадка зада по среднему шву. */
  backRise: Centimeters;
  /** B08 ширина бедра брючины на 2,5 см ниже точки схождения. */
  thighFlat: Centimeters;
  /** B09 ширина колена. Брючина лежит в один слой — это её ширина на чертеже. */
  kneeFlat: Centimeters;
  /** B10 ширина низа брючины, тоже в один слой. */
  legOpening: Centimeters;
  /** B11 длина по шаговому шву от точки схождения до низа. */
  inseamLength: Centimeters;
  /** B12 длина по боковому шву от верхнего края пояса до низа. */
  outseamLength: Centimeters;
  /** B13 длина гульфика от верхнего края пояса до нижней закрепки. */
  flyLength?: Centimeters;
}

export type BottomMeasurements = SkirtMeasurements | TrousersMeasurements;

/** Пара краёв брючины на одном уровне. */
export interface LegEdges {
  /** Край у шагового шва. */
  inner: Point;
  /** Край у бокового шва. */
  outer: Point;
}

export interface BottomGeometry {
  kind: BottomKind;
  /** Верхний край пояса у бокового шва. */
  waistTop: Point;
  /** Шов притачивания пояса на том же боку. */
  waistSeam: Point;
  /** Линия высокого бедра у бокового шва. */
  highHip: Point;
  /** Линия бёдер у бокового шва — самое широкое место изделия. */
  hip: Point;
  /** Внешний нижний угол: у юбки край подола, у брюк низ брючины у бока. */
  hem: Point;
  /** Точка схождения шаговых швов. Пусто у юбки: шагового шва у неё нет. */
  crotch?: Point;
  knee?: LegEdges;
  legHem?: LegEdges;
  /**
   * Габарит ПОЛОВИНЫ чертежа — как у верха, чтобы рендер считал viewBox
   * одинаково для всех видов. Низ симметричен по габариту даже там, где
   * несимметричен по деталям: гульфик лежит внутри контура.
   */
  bounds: { width: number; top: number; bottom: number };
}

/** Кубический сегмент контура: две опорные точки и конец. */
interface Cubic {
  c1: Point;
  c2: Point;
  p: Point;
}

/** Прямой участок как кубическая кривая — чтобы цепочка была однородной. */
const straight = (a: Point, b: Point): Cubic => ({
  c1: lerp(a, b, 1 / 3),
  c2: lerp(a, b, 2 / 3),
  p: b,
});

const signed = (p: Point, s: number): Point => ({ x: p.x * s, y: p.y });

/** Цепочка сегментов как есть; s = −1 — та же цепочка на другой половине. */
const forward = (segs: readonly Cubic[], s: number): string =>
  segs.map((g) => C(signed(g.c1, s), signed(g.c2, s), signed(g.p, s))).join(' ');

/**
 * Та же цепочка в обратную сторону.
 *
 * Обращение кубической кривой — перестановка её опорных точек, а концом
 * очередного сегмента становится конец предыдущего (для первого — начало
 * цепочки). Так левая половина получается ИЗ ТЕХ ЖЕ точек, что и правая:
 * симметрия гарантирована построением.
 */
const backward = (segs: readonly Cubic[], s: number, start: Point): string => {
  const out: string[] = [];
  for (let i = segs.length - 1; i >= 0; i--) {
    const end = i === 0 ? start : segs[i - 1]!.p;
    out.push(C(signed(segs[i]!.c2, s), signed(segs[i]!.c1, s), signed(end, s)));
  }
  return out.join(' ');
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/**
 * Уровень, заданный сантиметрами от верха пояса, поджатый к длине изделия.
 *
 * Уровни низа — не доли, а сантиметры: так они и меряются. У короткой вещи
 * линия бедра может оказаться ниже подола, и тогда шов ушёл бы за контур —
 * на чертеже появилась бы линия вне изделия. Уровень поджимается, а не
 * отбрасывается: у мини-юбки линия бёдер есть, просто она близко к подолу.
 */
const level = (cm: number, hemY: number, share: number): number => Math.min(cm, hemY * share);

/**
 * Контрольные точки низа.
 *
 * Вид не аргумент: контур переда и спинки у низа ОДИН. Отличаются детали —
 * молния и шлица есть только сзади, гульфик только спереди, — и глубина
 * выреза сиденья, которая живёт в путях, а не в точках.
 */
export function buildBottomGeometry(m: BottomMeasurements): BottomGeometry {
  const waistHalf = m.waistFlat / 2;
  const highHipHalf = m.highHipFlat / 2;
  const hipHalf = m.hipFlat / 2;

  const hemY = m.kind === 'skirt' ? m.length : m.outseamLength;
  const hipY = level(HIP_CM, hemY, 0.72);
  const highHipY = Math.min(level(HIGH_HIP_CM, hemY, 0.38), hipY * 0.75);
  const bandY = Math.min(m.waistbandHeight, highHipY * 0.6);

  const waistTop: Point = { x: waistHalf, y: 0 };
  const waistSeam: Point = { x: waistHalf, y: bandY };
  const highHip: Point = { x: highHipHalf, y: highHipY };
  const hip: Point = { x: hipHalf, y: hipY };

  if (m.kind === 'skirt') {
    const hem: Point = { x: m.sweepFlat / 2, y: hemY };
    return {
      kind: 'skirt',
      waistTop,
      waistSeam,
      highHip,
      hip,
      hem,
      bounds: { width: Math.max(waistHalf, highHipHalf, hipHalf, hem.x), top: 0, bottom: hemY },
    };
  }

  // --- Брюки -----------------------------------------------------------------
  // Уровень схождения шаговых швов берётся РАЗНОСТЬЮ длин по боковому и по
  // шаговому шву. Не посадкой B06/B07 — и вот почему: посадка меряется по
  // кривому среднему шву, то есть это длина ленты, а не глубина; вдобавок
  // обе величины и разность длин обязаны сходиться, а в непроверенном табеле
  // не сходятся. Разность двух длин задаёт уровень однозначно, и обе длины
  // при этом действительно нарисованы: бок идёт до подола, шаговый — от
  // схождения до него же.
  //
  // Границы держат уровень внутри изделия при любом табеле: выше линии бёдер
  // схождения не бывает — это уже не брюки, а два отдельных предмета, — а
  // прижатое к подолу оно не оставляет места брючине.
  const crotchY = clamp(m.outseamLength - m.inseamLength, hipY + 2, hemY * 0.85);
  // Колено меряется на 30–35 см ниже схождения. У коротких брюк этот уровень
  // оказывается ниже низа, и тогда он поджимается к середине брючины: колено
  // у шорт есть, просто оно ближе к краю.
  const kneeY = Math.min(crotchY + KNEE_BELOW_CROTCH_CM, crotchY + (hemY - crotchY) * 0.55);

  // Брючина висит отвесно, и её середина стоит посередине половины изделия:
  // от центра до бокового шва. От этой оси и откладываются ширины колена
  // и низа — они меряются в один слой и на чертеже стоят как в табеле.
  const legAxis = hipHalf / 2;
  const gap = hipHalf * LEG_GAP_SHARE;
  const edges = (width: number, y: number): LegEdges => {
    // Внутренний край не заходит за центр: брючины не могут перекрыться.
    // Поджимается именно ВНУТРЕННИЙ край, а ширина сохраняется — у широких
    // брюк она законно больше половины изделия, и силуэт расходится книзу.
    const inner = Math.max(gap, legAxis - width / 2);
    return { inner: { x: inner, y }, outer: { x: inner + width, y } };
  };

  const knee = edges(m.kneeFlat, kneeY);
  const legHem = edges(m.legOpening, hemY);
  const crotch: Point = { x: 0, y: crotchY };

  return {
    kind: 'trousers',
    waistTop,
    waistSeam,
    highHip,
    hip,
    hem: legHem.outer,
    crotch,
    knee,
    legHem,
    bounds: {
      width: Math.max(waistHalf, highHipHalf, hipHalf, knee.outer.x, legHem.outer.x),
      top: 0,
      bottom: hemY,
    },
  };
}

/**
 * Насколько кривая сиденья отходит от центра, см.
 *
 * Величина ВЫВЕДЕНА, а не назначена: ширина бедра брючины B08 больше
 * полуширины по бёдрам ровно на ту часть, которая при укладке плашмя уходит
 * в сиденье, — это и есть выступ шага. Он же и рисуется кривой: чем больше
 * B08 против бёдер, тем полнее сиденье.
 *
 * Выступ ДЕЛИТСЯ между передом и спинкой по длинам посадок: у зада она
 * длиннее, и лишняя длина живёт в более глубоком вырезе сиденья. Ровно так
 * его делит и конструктор. В сумме половины дают тот же выступ, что вышел
 * из замеров, — делёж перекладывает его, а не выдумывает.
 *
 * Ограничение сверху не косметическое: выступ не должен доставать до середины
 * брючины, иначе шаговый шов пересекает её поперёк, а вырез между брючинами
 * раздувается пузырём. Табель низа не откалиброван ни одним отшивом, и это
 * ограничение — единственное, что стоит между несогласованными числами
 * и нечитаемым чертежом.
 */
function crotchScoop(m: TrousersMeasurements, g: BottomGeometry, view: 'front' | 'back'): number {
  const legWidth = m.kneeFlat;
  const extension = Math.max(0, m.thighFlat - g.hip.x);
  const rises = m.frontRise + m.backRise;
  const own = view === 'back' ? m.backRise : m.frontRise;
  const share = rises > 0 ? (2 * own) / rises : 1;
  // Кривая сиденья есть всегда: без неё шаговый шов выходил бы из точки
  // схождения отвесно, а так не построена ни одна брючная конструкция.
  return clamp(extension * share, legWidth * 0.1, g.knee!.inner.x + legWidth * 0.35);
}

export interface BottomPathOptions {
  /** Глубина подгибки низа, см — припуск узла подгибки. */
  hemAllowance: Centimeters;
  /**
   * Число параллельных строчек низа. Ноль означает потайную подгибку:
   * с лица строчки нет, и на чертеже низ показан линией подгибки без пунктира
   * (так сказано в самом справочнике узлов про `hem_blind`).
   */
  hemStitchRows: number;
  /** Ширина подзора шлицы, см — припуск узла шлицы. */
  ventAllowance: Centimeters;
  /**
   * Детали, которых не задаёт ни один замер.
   *
   * Шлёвки и карман в боковом шве не меряются вовсе, вытачка и шлица бывают
   * и не бывают — спрашивать про них табель мер нечего. На чертеже они
   * появляются тогда, когда их запросил узел обработки, и связь «узел ↔ линия»
   * держится с обеих сторон по построению: линия без узла невозможна.
   */
  parts: {
    waistband: boolean;
    darts: boolean;
    vent: boolean;
    zipBack: boolean;
    fly: boolean;
    beltLoops: boolean;
    sidePocket: boolean;
    hem: boolean;
  };
}

export const DEFAULT_BOTTOM_PARTS: BottomPathOptions['parts'] = {
  waistband: true,
  darts: true,
  vent: true,
  zipBack: true,
  fly: true,
  beltLoops: true,
  sidePocket: true,
  hem: true,
};

export const DEFAULT_BOTTOM_OPTIONS: BottomPathOptions = {
  hemAllowance: 3,
  hemStitchRows: 1,
  ventAllowance: 4,
  parts: DEFAULT_BOTTOM_PARTS,
};

export function buildBottomPaths(
  m: BottomMeasurements,
  view: 'front' | 'back',
  options: BottomPathOptions = DEFAULT_BOTTOM_OPTIONS,
): { geometry: BottomGeometry; paths: FlatPaths } {
  const g = buildBottomGeometry(m);
  const parts = options.parts;
  const hemY = g.hem.y;
  const bandY = g.waistSeam.y;

  // --- Боковой контур от пояса до низа ---------------------------------------
  // Край пояса — прямой участок: пояс выкроен полосой и изгиба бедра
  // не повторяет. Ниже идёт ОДНА гладкая линия через все опорные уровни:
  // ломаная из отдельных дуг давала излом на каждом уровне, и линия бедра
  // читалась как угол кроя, которого в конструкции нет.
  //
  // Из-под пояса шов выходит отвесно — это продолжение прямого края пояса,
  // и только ниже линия расходится по бедру.
  const sideNodes: Point[] =
    m.kind === 'skirt'
      ? [g.waistSeam, g.highHip, g.hip, g.hem]
      : [g.waistSeam, g.highHip, g.hip, g.knee!.outer, g.legHem!.outer];
  const side: Cubic[] = [straight(g.waistTop, g.waistSeam), ...spline(sideNodes, { x: 0, y: 1 })];

  let outline: string;
  let inseam: Cubic[] = [];

  if (m.kind === 'skirt') {
    outline =
      `${M({ x: -g.waistTop.x, y: 0 })} ${L(g.waistTop)} ` +
      `${forward(side, 1)} ` +
      `${L({ x: -g.hem.x, y: hemY })} ` +
      `${backward(side, -1, g.waistTop)} Z`;
  } else {
    const knee = g.knee!;
    const legHem = g.legHem!;
    const crotch = g.crotch!;

    // Шаговый шов: из точки схождения он уходит ВБОК, а не вниз — по этой
    // кривой сиденья брюки и узнаются. Дальше линия идёт к колену и низу
    // тем же гладким ходом, что и бок.
    inseam = spline(
      [crotch, knee.inner, legHem.inner],
      unit({ x: 1, y: 0.55 }),
      crotchScoop(m, g, view),
    );

    outline =
      `${M({ x: -g.waistTop.x, y: 0 })} ${L(g.waistTop)} ` +
      `${forward(side, 1)} ` +
      `${L(legHem.inner)} ` +
      `${backward(inseam, 1, crotch)} ` +
      `${forward(inseam, -1)} ` +
      `${L({ x: -legHem.outer.x, y: hemY })} ` +
      `${backward(side, -1, g.waistTop)} Z`;
  }

  /**
   * Полуширина изделия на уровне y — по ТЕМ ЖЕ узлам, что и контур.
   *
   * Список узлов один на оба места намеренно: разойдясь, они дают линию,
   * которая упирается не в тот край. Так строчка подгибки и уезжала за
   * боковой шов — оценка шла по своим узлам, а контур по своим.
   */
  const sideAt = (y: number): number => interpolate([g.waistTop, ...sideNodes], y);

  const seams: SeamLine[] = [];
  const stitches: SeamLine[] = [];
  const pocket: SeamLine[] = [];
  const hidden: string[] = [];

  // --- Пояс -------------------------------------------------------------------
  // Шов притачивания идёт поперёк изделия во всю ширину: пояс прямой,
  // и на уровне шва изделие ровно той же ширины, что по верхнему краю.
  if (parts.waistband) {
    seams.push({
      id: 'waistband',
      d: `${M({ x: -g.waistTop.x, y: bandY })} ${L({ x: g.waistTop.x, y: bandY })}`,
    });
  }

  // --- Вытачки ----------------------------------------------------------------
  // Треугольник тонкими сплошными, вершина вниз — к выпуклости бедра
  // (knowledge-base/02 §4). Третья сторона треугольника — сам шов пояса,
  // поэтому рисуются только две.
  //
  // У юбки вытачки и спереди, и сзади; у брюк — только на задних половинках:
  // так их и стачивают. Нарисовать вытачку на переде брюк значило бы
  // потребовать операции, которой в технологической последовательности нет.
  //
  // Длина: у юбки она замер (J03). У брюк своей точки в табеле нет, и вытачка
  // доведена до линии высокого бедра — уровня, который табель определяет сам
  // (B04 меряется на 10 см ниже верха пояса). Это положение знака, а не размер:
  // снимать с чертежа длину вытачки брюк нечего, её там не мерили.
  const dartLength = m.kind === 'skirt' ? m.dartLength : g.highHip.y - bandY;
  const dartHere = m.kind === 'skirt' || view === 'back';
  if (parts.darts && dartHere && dartLength !== undefined && dartLength > 0) {
    const opening = dartLength * DART_OPENING_SHARE;
    for (const s of [1, -1]) {
      const x = s * g.waistTop.x * DART_AT;
      seams.push({
        id: 'dart',
        d:
          `${M({ x: x - opening / 2, y: bandY })} ` +
          `${L({ x, y: bandY + dartLength })} ` +
          `${L({ x: x + opening / 2, y: bandY })}`,
      });
    }
  }

  // --- Юбка: молния, шлица ------------------------------------------------------
  if (m.kind === 'skirt' && view === 'back') {
    // Потайная молния — ОДИНАРНАЯ линия с выноской (knowledge-base/02 §4):
    // с лица у неё не видно ни зубцов, ни строчки, и рисовать двойную линию
    // значило бы показать обычную молнию.
    if (parts.zipBack && m.zipLength !== undefined) {
      const bottom = Math.min(m.zipLength, hemY);
      seams.push({ id: 'zip_invisible', d: `${M({ x: 0, y: 0 })} ${L({ x: 0, y: bottom })}` });
    }
    // Шлица: средний шов идёт до закрепки, ниже видна кромка подзора.
    // Ширина подзора — припуск узла шлицы: своей точки в табеле мер у неё нет,
    // а припуск узла — это ровно та величина, на которую подзор заходит.
    if (parts.vent && m.ventLength !== undefined && m.ventLength > 0) {
      const top = Math.max(hemY - m.ventLength, bandY);
      const width = Math.min(options.ventAllowance, g.hem.x * 0.4);
      seams.push({
        id: 'vent',
        d:
          `${M({ x: 0, y: hemY })} ${L({ x: 0, y: top })} ` +
          `${L({ x: width, y: top })} ${L({ x: width, y: hemY })}`,
      });
    }
  }

  // --- Брюки: гульфик, средний шов, шлёвки, карман -------------------------------
  if (m.kind === 'trousers') {
    const crotch = g.crotch!;
    const fly = parts.fly ? clampFly(m, crotch.y) : undefined;

    if (view === 'front' && fly !== undefined) {
      // Гульфик виден двумя вещами: кромкой верхней части по центру переда
      // и J-образной отделочной строчкой. Строчка идёт по ОДНОЙ стороне —
      // застёжка одна, и зеркальная копия обещала бы вторую.
      const width = Math.min(fly * 0.45, g.waistTop.x * 0.22);
      seams.push({ id: 'fly', d: `${M({ x: 0, y: 0 })} ${L({ x: 0, y: fly })}` });
      stitches.push({
        id: 'fly',
        d:
          `${M({ x: width, y: 0 })} ${L({ x: width, y: fly - width })} ` +
          C({ x: width, y: fly - width * 0.45 }, { x: width * 0.55, y: fly }, { x: 0, y: fly }),
      });
    }

    // Средний шов сиденья: на спинке от пояса до схождения, на переде — ниже
    // гульфика. Выше гульфика среднего шва на переде не видно: там застёжка.
    const top = view === 'front' ? (fly ?? 0) : 0;
    seams.push({ id: 'crotch', d: `${M({ x: 0, y: top })} ${L(crotch)}` });

    if (parts.beltLoops) {
      // Раскладка на семь шлёвок: две на каждой половине переда и три на
      // спинке, средняя по центру. Числа шлёвок в табеле мер нет — на чертеже
      // это ЗНАК расположения, и снимать с него количество нельзя.
      const at = view === 'front' ? [0.35, 0.8, -0.35, -0.8] : [0, 0.6, -0.6];
      for (const share of at) {
        const x = g.waistTop.x * share;
        seams.push({
          id: 'belt_loop',
          d:
            `${M({ x: x - BELT_LOOP_WIDTH / 2, y: 0 })} ` +
            `${L({ x: x - BELT_LOOP_WIDTH / 2, y: bandY })} ` +
            `${M({ x: x + BELT_LOOP_WIDTH / 2, y: 0 })} ` +
            `${L({ x: x + BELT_LOOP_WIDTH / 2, y: bandY })}`,
        });
      }
    }

    if (parts.sidePocket) {
      // Вход в карман лежит В БОКОВОМ ШВЕ, то есть на самом контуре: линии
      // ему не нужно, нужны границы. Их показывают засечками у концов входа,
      // а мешковину — точками: она под полотном (knowledge-base/02 §3, §4).
      // Своей длины у входа в табеле нет; обе его границы табель задаёт сам —
      // шов притачивания пояса сверху и линия бёдер снизу.
      const y1 = bandY;
      const y2 = g.hip.y;
      const tick = g.hip.x * 0.07;
      // Мешковина висит от входа внутрь и ниже него. Ширина и вылет взяты
      // от длины входа: своих величин у мешковины в табеле нет, а на чертеже
      // она — контур под полотном, по которому видно, что карман есть
      // и куда он уходит.
      const bagDepth = (y2 - y1) * 0.35;
      for (const s of [1, -1]) {
        pocket.push({
          id: 'pocket_opening',
          d:
            `${M({ x: s * sideAt(y1), y: y1 })} ${L({ x: s * (sideAt(y1) - tick), y: y1 })} ` +
            `${M({ x: s * sideAt(y2), y: y2 })} ${L({ x: s * (sideAt(y2) - tick), y: y2 })}`,
        });
        const bagBottom = y2 + bagDepth;
        const bagX = sideAt(y2) - (y2 - y1) * 0.75;
        hidden.push(
          `${M({ x: s * (sideAt(y1) - tick), y: y1 })} ` +
            `${L({ x: s * bagX, y: y1 + bagDepth })} ` +
            C(
              { x: s * bagX, y: bagBottom },
              { x: s * (bagX + (sideAt(y2) - bagX) * 0.5), y: bagBottom },
              { x: s * sideAt(bagBottom), y: bagBottom },
            ),
        );
      }
    }
  }

  // --- Низ --------------------------------------------------------------------
  // Подгибка идёт по краю низа: у юбки одной линией через всю ширину,
  // у брюк — по каждой брючине отдельно. Строчек столько, сколько их
  // на самом деле: по числу пунктирных линий фабрика читает тип машины.
  if (parts.hem) {
    const spans = (offset: number): [Point, Point][] => {
      const y = hemY - offset;
      if (m.kind === 'skirt')
        return [
          [
            { x: -sideAt(y), y },
            { x: sideAt(y), y },
          ],
        ];
      const inner = interpolate([g.knee!.inner, g.legHem!.inner], y);
      const outer = interpolate([g.knee!.outer, g.legHem!.outer], y);
      return [
        [
          { x: inner, y },
          { x: outer, y },
        ],
        [
          { x: -outer, y },
          { x: -inner, y },
        ],
      ];
    };
    const allowance = Math.min(m.hemAllowance ?? options.hemAllowance, (hemY - bandY) * 0.5);
    if (options.hemStitchRows <= 0) {
      // Потайная подгибка: с лица строчки нет, и пунктир обещал бы отстрочку,
      // которой не будет. Показана линия сгиба подгибки.
      for (const [a, b] of spans(allowance)) seams.push({ id: 'hem', d: `${M(a)} ${L(b)}` });
    } else {
      for (let i = 0; i < options.hemStitchRows; i++) {
        for (const [a, b] of spans(Math.max(allowance - i * 0.35, 0.2))) {
          stitches.push({ id: 'hem', d: `${M(a)} ${L(b)}` });
        }
      }
    }
  }

  // --- Центр -------------------------------------------------------------------
  // У юбки центр — вспомогательная ось: спереди это сгиб, сзади средний шов,
  // названными линиями на котором стоят только молния и шлица. Отдельного
  // узла на «стачать средний шов» в спецификации нет, а линия с именем,
  // за которым не стоит работы, обещала бы обработку, которой не описано.
  // У брюк центр занят швами с именами — гульфиком и швом сиденья.
  const center = m.kind === 'skirt' ? `${M({ x: 0, y: 0 })} ${L({ x: 0, y: hemY })}` : '';

  // Заливка идёт по одной детали: пояс кроится из того же полотна и по той же
  // долевой, что корпус. Выделить его отдельной деталью значило бы объявить
  // поворот раппорта, которого в спецификации нет.
  const panels: FlatPanel[] = [{ id: 'body', d: outline, material: 'shell', grain_deg: 0 }];

  return {
    geometry: g,
    paths: {
      outline,
      seams,
      stitches,
      ribs: [],
      hood: [],
      parts: [],
      pocket,
      fill: [outline],
      panels,
      center,
      hidden,
    },
  };
}

/** Длина гульфика, не длиннее самого среднего шва: ниже схождения его нет. */
function clampFly(m: TrousersMeasurements, crotchY: number): number | undefined {
  if (m.flyLength === undefined || m.flyLength <= 0) return undefined;
  return Math.min(m.flyLength, crotchY * 0.9);
}

const unit = (v: Point): Point => {
  const n = Math.hypot(v.x, v.y);
  return n === 0 ? { x: 0, y: 1 } : { x: v.x / n, y: v.y / n };
};

/**
 * Гладкая линия через опорные уровни.
 *
 * Касательная в узле смотрит по хорде его соседей, длина плеча — треть звена.
 * Отсюда два свойства, ради которых это и написано. Первое: соседние сегменты
 * сходятся БЕЗ ИЗЛОМА — линия бедра на чертеже перестаёт читаться углом кроя,
 * которого в конструкции нет. Второе: плечо привязано к длине своего звена,
 * а не к общей длине линии, поэтому короткий участок у пояса не разносит
 * кривую в петлю рядом с длинным участком до подола.
 *
 * Касательная в первом узле задаётся снаружи: у бокового шва она отвесна
 * (шов выходит из-под прямого пояса), у шагового — почти горизонтальна
 * (кривая сиденья). Длина её плеча тоже приходит снаружи там, где она
 * ВЫВЕДЕНА из замеров, а не из длины звена.
 */
function spline(nodes: readonly Point[], startDir: Point, startArm?: number): Cubic[] {
  const last = nodes.length - 1;
  const tangents = nodes.map((_, i) =>
    i === 0
      ? startDir
      : unit({
          x: nodes[Math.min(i + 1, last)]!.x - nodes[i - 1]!.x,
          y: nodes[Math.min(i + 1, last)]!.y - nodes[i - 1]!.y,
        }),
  );

  const out: Cubic[] = [];
  for (let i = 1; i <= last; i++) {
    const a = nodes[i - 1]!;
    const b = nodes[i]!;
    const arm = Math.hypot(b.x - a.x, b.y - a.y) / 3;
    const first = i === 1 && startArm !== undefined ? startArm : arm;
    out.push({
      c1: { x: a.x + tangents[i - 1]!.x * first, y: a.y + tangents[i - 1]!.y * first },
      c2: { x: b.x - tangents[i]!.x * arm, y: b.y - tangents[i]!.y * arm },
      p: b,
    });
  }
  return out;
}

/**
 * Абсцисса на ломаной по её узлам — оценка полуширины изделия на уровне y.
 *
 * Нужна там, где линия обязана дойти РОВНО до края и не дальше: строчка
 * подгибки, засечки кармана. Ломаная идёт по тем же опорным точкам, что
 * и контур, и отличается от него на прогиб кривой между узлами — доли
 * сантиметра на нашем шаге уровней.
 */
function interpolate(nodes: readonly Point[], y: number): number {
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  if (y <= first.y) return first.x;
  if (y >= last.y) return last.x;
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1]!;
    const b = nodes[i]!;
    if (y <= b.y) {
      const span = b.y - a.y;
      return span <= 0 ? b.x : a.x + ((b.x - a.x) * (y - a.y)) / span;
    }
  }
  return last.x;
}
