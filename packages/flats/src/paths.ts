import { buildGeometry, type FlatGeometry, type FlatMeasurements, type Point } from './geometry.js';
import { C, f, L, lerp, M } from './svg.js';

/**
 * Построение путей чертежа.
 *
 * Конвенции линий — knowledge-base/02 §3, они же спецификация генератора:
 * контур толще внутренних швов, отстрочка пунктиром, скрытое точками.
 * Число пунктирных линий равно числу реальных параллельных строчек —
 * по нему фабрика определяет тип машины.
 *
 * Все кривые — кубические Безье с контрольными точками, выведенными из
 * концов отрезка. Ломаная из прямых читалась бы как чертёж, нарисованный
 * программистом, а документ идёт технологу.
 */

/** Магическая константа приближения дуги окружности кубической кривой. */
const KAPPA = 0.5523;

/**
 * Четверть эллипса от центра горловины (0, b) к высшей точке плеча (a, 0).
 * Горловина и шов втачивания бейки строятся одной формулой с разными полуосями —
 * поэтому они гарантированно параллельны, а не «примерно похожи».
 */
const neckArc = (a: number, b: number): string =>
  `${M({ x: 0, y: b })} ${C({ x: a * KAPPA, y: b }, { x: a, y: b * KAPPA }, { x: a, y: 0 })}`;

/** Тот же эллипс без начального M — чтобы продолжить им уже открытый путь. */
const neckArcTail = (a: number, b: number): string =>
  C({ x: a * KAPPA, y: b }, { x: a, y: b * KAPPA }, { x: a, y: 0 });

/**
 * Он же в обратную сторону: от плеча к центру.
 * Обращение кубической кривой — перестановка её опорных точек.
 */
const neckArcTailBack = (a: number, b: number): string =>
  C({ x: a, y: b * KAPPA }, { x: a * KAPPA, y: b }, { x: 0, y: b });

/** Точка на том же эллипсе при параметре t от центра (0) к плечу (1). */
const onNeck = (t: number, a: number, b: number): Point => ({
  x: a * Math.sin((t * Math.PI) / 2),
  y: b * Math.cos((t * Math.PI) / 2),
});

/**
 * Конструктивный шов на чертеже.
 *
 * У линии есть ИМЯ, и это не украшение разметки: узел обработки в разделе
 * конструкции обязан иметь на чертеже видимую линию, иначе документ
 * противоречит сам себе — технолог читает чертёж швами и первым делом
 * спросит, где шов проймы. Связь проверяется в обе стороны тестом.
 */
export interface SeamLine {
  id: string;
  d: string;
}

/**
 * Деталь кроя на чертеже.
 *
 * Чертёж — не один силуэт, а набор деталей, и заливке это принципиально.
 * Пояс и манжеты кроятся из ДРУГОГО полотна: в спецификации это отдельная
 * позиция, кашкорсе, и при печати полотна до раскроя она не печатается.
 * Заливая рисунком весь силуэт, превью обещало печатный пояс — фабрика
 * прислала бы однотонный, и правым остался бы документ, а не клиент.
 *
 * Второе, ради чего нужны детали, — ДОЛЕВАЯ. Рукав скроен вдоль своей длины,
 * и на чертеже он повёрнут; значит и рисунок на нём повёрнут вместе с ним.
 * Глобально вертикальная заливка показывала бы направление, которого
 * на готовой вещи не будет.
 */
export interface FlatPanel {
  id: string;
  /** Замкнутый контур детали. */
  d: string;
  /**
   * Роль материала из спецификации. `shell` печатается, `rib` — нет:
   * это отдельное полотно, и оно идёт цветом-компаньоном.
   */
  material: 'shell' | 'rib';
  /**
   * Поворот долевой детали относительно вертикали, градусы по часовой.
   * Ноль — деталь кроится строго по долевой, как перед и спинка.
   */
  grain_deg: number;
}

export interface FlatPaths {
  /** Силуэт правой половины. Левая — зеркалом, поэтому симметрия точная. */
  outline: string;
  /** Конструктивные швы: пройма, шов втачивания бейки, притачивание рибан. */
  seams: SeamLine[];
  /** Отделочные строчки. Каждая линия — одна реальная строчка. */
  stitches: SeamLine[];
  /** Рубчик отделочных деталей — условное обозначение рибаны. */
  ribs: string[];
  /** Капюшон: контур, лицевой край, люверс. Пусто, если капюшона нет. */
  hood: SeamLine[];
  /**
   * Отдельные детали, рисуемые контуром поверх корпуса.
   *
   * На переде и спинке пусто: там рукав входит в общий силуэт. Сбоку рукав —
   * самостоятельная фигура, висящая поверх корпуса, и контуром он обязан быть
   * потому же, почему им является корпус: это край изделия, а не шов на нём.
   */
  parts: string[];
  /** Карман-кенгуру. Пусто, если кармана нет. */
  pocket: SeamLine[];
  /**
   * Замкнутые области под заливку — цветом колорвея или раппортом.
   *
   * Отдельно от контуров, потому что контур и область — не одно и то же.
   * Контур капюшона на переде идёт от горловины до макушки и обрывается:
   * как ЛИНИЯ он верен, а как ОБЛАСТЬ замыкается по хорде и оставляет
   * белый клин над горловиной. Так и было, пока заливка шла по контурам:
   * у худи в раппорте зияла незакрашенная дыра.
   */
  fill: string[];
  /** Детали кроя. Заливка идёт по ним, а не по силуэту. */
  panels: FlatPanel[];
  /** Линия центра переда или спинки — тонкая, вспомогательная. */
  center: string;
  /**
   * Скрытые за другой деталью линии — точечные (knowledge-base/02 §3).
   *
   * На переде и спинке пусто: там ничто ничего не закрывает. Существует
   * ради бокового вида, где рукав висит поверх бокового шва — то есть
   * поверх ровно того, ради чего этот вид и рисуют.
   */
  hidden: string[];
}

export interface PathOptions {
  /** Глубина подгибки низа, см. Определяет, где идёт отстрочка. */
  hemAllowance: number;
  /** Число параллельных строчек низа. Прямо соответствует типу машины. */
  hemStitchRows: number;
  /** Глубина подгибки низа рукава, см. */
  sleeveHemAllowance: number;
  sleeveStitchRows: number;
  /**
   * Ниже этого угла рукав на чертеже не отводится, градусы.
   *
   * Приходит снаружи, из справочника условностей: чертёж остаётся чистой
   * проекцией спеки и в справочники не ходит. Ноль означает «рисовать точную
   * укладку» — так строятся тесты геометрии.
   */
  minSleeveAngleDeg: number;
}

export const DEFAULT_PATH_OPTIONS: PathOptions = {
  hemAllowance: 2,
  hemStitchRows: 2,
  sleeveHemAllowance: 2,
  sleeveStitchRows: 2,
  minSleeveAngleDeg: 0,
};

export function buildPaths(
  m: FlatMeasurements,
  view: 'front' | 'back',
  options: PathOptions = DEFAULT_PATH_OPTIONS,
): { geometry: FlatGeometry; paths: FlatPaths } {
  const g = buildGeometry(m, view, options.minSleeveAngleDeg);
  const neckDrop = view === 'front' ? m.frontNeckDrop : m.backNeckDrop;

  // --- Пройма ------------------------------------------------------------------
  // Форма настоящей проймы: от плечевой точки идёт вниз с прогибом внутрь,
  // затем выходит наружу к нижней точке. Прямая линия читалась бы как реглан.
  const armDy = g.underarm.y - g.shoulderPoint.y;
  const armhole = C(
    { x: g.shoulderPoint.x - armDy * 0.1, y: g.shoulderPoint.y + armDy * 0.38 },
    { x: g.underarm.x - armDy * 0.08, y: g.underarm.y - armDy * 0.22 },
    g.underarm,
  );

  // --- Рукав ------------------------------------------------------------------
  // Верхний сгиб слегка выгнут ВВЕРХ: прямая читается трапецией, а прогиб
  // внутрь — вмятиной. Обе контрольные точки идут вдоль сгиба и лишь приподняты.
  const rise = m.sleeveLength * 0.05;
  const capA = lerp(g.shoulderPoint, g.sleeveTopEnd, 0.35);
  const capB = lerp(g.shoulderPoint, g.sleeveTopEnd, 0.78);
  const sleeveTop = C(
    { x: capA.x, y: capA.y - rise },
    { x: capB.x, y: capB.y - rise * 0.45 },
    g.sleeveTopEnd,
  );
  const sleeveEnd = L(g.sleeveBottomEnd);
  // Нижний срез рукава почти прямой, с лёгким провисом к пройме.
  const underMid = lerp(g.sleeveBottomEnd, g.underarm, 0.55);
  const sleeveUnder = C(
    lerp(g.sleeveBottomEnd, g.underarm, 0.25),
    { x: underMid.x, y: underMid.y + m.sleeveOpening * 0.06 },
    g.underarm,
  );

  // --- Боковой шов: от проймы через талию к низу -------------------------------
  const sideToWaist = C(
    {
      x: g.underarm.x - (g.underarm.x - g.waist.x) * 0.5,
      y: g.underarm.y + (g.waist.y - g.underarm.y) * 0.45,
    },
    {
      x: g.waist.x + (g.underarm.x - g.waist.x) * 0.2,
      y: g.waist.y - (g.waist.y - g.underarm.y) * 0.25,
    },
    g.waist,
  );
  const waistToHem = C(
    { x: g.waist.x - (g.waist.x - g.hem.x) * 0.3, y: g.waist.y + (g.hem.y - g.waist.y) * 0.35 },
    { x: g.hem.x, y: g.hem.y - (g.hem.y - g.waist.y) * 0.3 },
    g.hem,
  );

  const outline = [
    // Горловина — четверть эллипса от центра переда к высшей точке плеча.
    neckArc(g.hps.x, neckDrop),
    L(g.shoulderPoint),
    // У безрукавки контур идёт СРАЗУ ПО ПРОЙМЕ: рукава нет, и нарисованный
    // рукав обещал бы фабрике деталь кроя, которой в раскладке не будет.
    ...(m.sleeveless ? [armhole] : [sleeveTop, sleeveEnd, sleeveUnder]),
    sideToWaist,
    waistToHem,
    L(g.hemCenter),
  ].join(' ');

  // --- Конструктивные швы ------------------------------------------------------
  // Пройма идёт первой и помечена: по этой линии технолог читает узел
  // втачивания рукава, и связь «узел ↔ линия на чертеже» проверяется тестом.
  // Линия проймы: у изделия с рукавом это шов втачивания, у безрукавки —
  // сам край, и он уже нарисован контуром. Второй раз его не проводим,
  // но линия узла нужна: пройму окантовывают, и это операция.
  const seams: SeamLine[] = [{ id: 'armhole', d: `${M(g.shoulderPoint)} ${armhole}` }];

  // Шов втачивания бейки — тот же эллипс с полуосями, увеличенными на высоту
  // бейки. Бейки может не быть вовсе: у худи горловина закрыта капюшоном,
  // и раньше сюда подставлялись типовые 2 см — чертёж показывал фабрике
  // деталь, которой в табеле мер нет.
  const bandA = m.neckRibHeight === undefined ? 0 : g.hps.x + m.neckRibHeight * 0.55;
  const bandB = m.neckRibHeight === undefined ? 0 : neckDrop + m.neckRibHeight;
  if (m.neckRibHeight !== undefined) {
    seams.push({ id: 'neck_band', d: neckArc(bandA, bandB) });
  }
  // У изделия с капюшоном бейки нет, и линия горловины — это шов втачивания
  // капюшона. Он обязан быть НАЗВАН: узел «втачивание капюшона» есть
  // в конструкции, и технолог ищет его на чертеже.
  if (m.hoodHeight !== undefined) {
    seams.push({ id: 'hood_set_in', d: neckArc(g.hps.x, neckDrop) });
  }

  // --- Отстрочки: столько линий, сколько реальных строчек ----------------------
  const stitches: SeamLine[] = [];

  // Подгибка низа рисуется только там, где низ ПОДШИТ. У изделия с поясом-риб
  // подгибки нет вовсе, и отстрочка на чертеже обещала бы операцию, которой
  // в спецификации не будет.
  for (let i = 0; m.waistRibHeight === undefined && i < options.hemStitchRows; i++) {
    const offset = options.hemAllowance - i * 0.35;
    stitches.push({
      id: 'hem_stitch',
      d: `${M({ x: 0, y: g.hem.y - offset })} L ${f(g.hem.x - 0.2)} ${f(g.hem.y - offset)}`,
    });
  }

  const perp = { x: -Math.sin(g.sleeveAngle), y: Math.cos(g.sleeveAngle) };
  const dir = { x: Math.cos(g.sleeveAngle), y: Math.sin(g.sleeveAngle) };
  for (
    let i = 0;
    !m.sleeveless && m.cuffRibHeight === undefined && i < options.sleeveStitchRows;
    i++
  ) {
    const back = options.sleeveHemAllowance - i * 0.35;
    const a = { x: g.sleeveTopEnd.x - dir.x * back, y: g.sleeveTopEnd.y - dir.y * back };
    const b = { x: a.x + perp.x * m.sleeveOpening, y: a.y + perp.y * m.sleeveOpening };
    stitches.push({ id: 'sleeve_hem_stitch', d: `${M(a)} ${L(b)}` });
  }

  // --- Рубчик бейки: частые тонкие линии поперёк детали ------------------------
  // Символ рибаны из библиотеки условных обозначений (knowledge-base/02 §4):
  // технолог узнаёт бейку с одного взгляда, без подписи. Обе точки берутся
  // при одном параметре на двух эллипсах, поэтому штрихи ложатся ровно.
  const ribs: string[] = [];
  if (m.neckRibHeight !== undefined) {
    const RIB_COUNT = 9;
    for (let i = 1; i < RIB_COUNT; i++) {
      const t = i / RIB_COUNT;
      ribs.push(`${M(onNeck(t, g.hps.x, neckDrop))} ${L(onNeck(t, bandA, bandB))}`);
    }
  }

  // --- Отделочные детали: манжета и пояс ---------------------------------------
  // Швы притачивания рисуются поперёк детали, а рубчик — вдоль неё:
  // так технолог отличает рибану от подгибки без подписи.
  if (m.waistRibHeight !== undefined) {
    const y = g.hem.y - m.waistRibHeight;
    seams.push({ id: 'waistband', d: `${M({ x: 0, y })} L ${f(g.hem.x)} ${f(y)}` });
    const step = Math.max(g.hem.x / 14, 0.8);
    for (let x = step; x < g.hem.x; x += step) {
      ribs.push(`${M({ x, y })} L ${f(x)} ${f(g.hem.y)}`);
    }
  }

  if (m.cuffRibHeight !== undefined && !m.sleeveless) {
    const back = m.cuffRibHeight;
    const a = { x: g.sleeveTopEnd.x - dir.x * back, y: g.sleeveTopEnd.y - dir.y * back };
    const b = { x: a.x + perp.x * m.sleeveOpening, y: a.y + perp.y * m.sleeveOpening };
    seams.push({ id: 'cuff', d: `${M(a)} ${L(b)}` });
    const steps = 7;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const from = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const to = { x: from.x + dir.x * back, y: from.y + dir.y * back };
      ribs.push(`${M(from)} ${L(to)}`);
    }
  }

  // --- Капюшон ------------------------------------------------------------------
  // На техническом чертеже капюшон показывают разложенным ВВЕРХ, за плечами:
  // иначе он закрывает горловину и спинку, и их не проверить.
  const hood: SeamLine[] = [];
  if (g.hoodTop && g.hoodSide && m.hoodOpening !== undefined) {
    const h = -g.hoodTop.y;
    const side = g.hoodSide.x;

    // Внешний контур: от шва втачивания расширяется у основания,
    // держит ширину в средней части и скругляется к макушке.
    // Профиль капюшона, разложенного вверх: расширяется от горловины,
    // держит ширину в средней части и скругляется к макушке. Прежние
    // контрольные точки выводили его на полную ширину сразу и держали
    // до самого верха — получалась коробка, а не капюшон.
    const arc = (w: number, top: number, from: Point): string =>
      `${M(from)} ` +
      C(
        { x: w * 0.98, y: -top * 0.22 },
        { x: w, y: -top * 0.55 },
        { x: w * 0.93, y: -top * 0.78 },
      ) +
      ' ' +
      C({ x: w * 0.82, y: -top * 0.95 }, { x: w * 0.45, y: -top }, { x: 0, y: -top });

    hood.push({ id: 'hood_outline', d: arc(side, h, { x: g.hps.x, y: 0 }) });

    // Лицевой край капюшона: тот же контур, отступя внутрь на ширину кулиски.
    const inset = Math.min(m.hoodOpening * 0.1, side * 0.35);
    hood.push({
      id: 'hood_casing',
      d: arc(side - inset, h - inset, { x: g.hps.x * 0.92, y: -inset * 0.5 }),
    });

    // Кулиска со шнуром: люверс и свисающий конец у основания лицевого края.
    // Только на переде — сзади шнур не виден.
    if (view === 'front') {
      const eyeletY = -h * 0.08;
      const eyeletX = (side - inset) * 0.55;
      hood.push({
        id: 'hood_eyelet',
        d: `${M({ x: eyeletX, y: eyeletY })} m -0.45 0 a 0.45 0.45 0 1 0 0.9 0 a 0.45 0.45 0 1 0 -0.9 0`,
      });
      hood.push({
        id: 'hood_drawcord',
        d:
          `${M({ x: eyeletX, y: eyeletY })} ` +
          C(
            { x: eyeletX + 0.6, y: eyeletY + h * 0.14 },
            { x: eyeletX - 0.4, y: eyeletY + h * 0.24 },
            { x: eyeletX + 0.3, y: eyeletY + h * 0.34 },
          ),
      });
    }
  }

  // --- Карман-кенгуру -------------------------------------------------------------
  // Классическая форма: верхний край от центра, диагональный вход для руки,
  // внешний край вниз и нижний край обратно к центру. Рисуется половина,
  // вторая получается зеркалом.
  const pocket: SeamLine[] = [];
  if (view === 'front' && m.pocketWidth !== undefined && m.pocketHeight !== undefined) {
    const bottom = g.hem.y - (m.waistRibHeight ?? 2) - 1.5;
    const top = bottom - m.pocketHeight;

    if (m.zipPlacketWidth !== undefined) {
      // Изделие с застёжкой: карман не может пересекать центр переда, он
      // накладной и лежит СБОКУ от молнии. Кенгуру здесь был бы разрезан
      // молнией пополам — то есть перестал бы быть карманом.
      const inner = m.zipPlacketWidth + 1.5;
      const outer = inner + m.pocketWidth;
      pocket.push({
        id: 'pocket',
        d:
          `${M({ x: inner, y: top })} L ${f(outer)} ${f(top)} ` +
          `L ${f(outer)} ${f(bottom)} L ${f(inner)} ${f(bottom)} Z`,
      });
    } else {
      // Карман-кенгуру: верхний край от центра, диагональный вход для руки,
      // внешний край вниз и нижний край обратно к центру.
      const halfWidth = m.pocketWidth / 2;
      const openingInner = halfWidth * 0.52;
      const openingDrop = m.pocketHeight * 0.42;
      pocket.push({
        id: 'pocket',
        d:
          `${M({ x: 0, y: top })} L ${f(openingInner)} ${f(top)} ` +
          `L ${f(halfWidth)} ${f(top + openingDrop)} ` +
          `L ${f(halfWidth)} ${f(bottom)} L 0 ${f(bottom)}`,
      });
    }
  }

  const center = `${M(g.neckCenter)} L 0 ${f(g.hem.y)}`;

  // --- Застёжка на молнии ---------------------------------------------------
  // Молния идёт по центру переда от горловины до низа, планка — полосой
  // вдоль неё. Рисуется только на переде: со спины застёжки не видно, и
  // линия там означала бы шов, которого нет.
  if (view === 'front' && m.zipPlacketWidth !== undefined) {
    const top = neckDrop;
    const bottom = g.hem.y;
    seams.push({ id: 'zip_line', d: `${M({ x: 0, y: top })} L 0 ${f(bottom)}` });
    stitches.push({
      id: 'zip_stitch',
      d: `${M({ x: m.zipPlacketWidth, y: top })} L ${f(m.zipPlacketWidth)} ${f(bottom)}`,
    });
  }

  // --- Воротник и планка поло ------------------------------------------------
  // Воротник лежит на плечах: его ширина — половина длины втачивания, высота
  // на чертеже — ширина отлёта. Планка идёт вниз от горловины полосой.
  if (view === 'front' && m.collarLength !== undefined) {
    const spread = m.collarSpread ?? m.collarLength * 0.13;
    const half = Math.min(m.collarLength / 2, g.shoulderPoint.x * 0.92);
    seams.push({
      id: 'collar',
      d:
        `${M({ x: 0, y: neckDrop })} L ${f(half)} ${f(g.hps.y + spread * 0.35)} ` +
        `L ${f(half * 0.82)} ${f(g.hps.y - spread)} L 0 ${f(neckDrop - spread)}`,
    });
    if (m.placketLength !== undefined) {
      const w = m.placketWidth ?? m.placketLength * 0.22;
      stitches.push({
        id: 'placket',
        d:
          `${M({ x: 0, y: neckDrop })} L ${f(w)} ${f(neckDrop)} ` +
          `L ${f(w)} ${f(neckDrop + m.placketLength)} L 0 ${f(neckDrop + m.placketLength)}`,
      });
    }
  }

  // Область капюшона: контур, доведённый по центру до горловины и замкнутый
  // ПО ЛИНИИ ГОРЛОВИНЫ, а не по хорде. Хорда оставляла у выреза белый клин:
  // горловина выгнута наружу, и прямая её не догоняет.
  const hoodFill = hood.length
    ? [`${hood[0]!.d} L 0 ${f(neckDrop)} ${neckArcTail(g.hps.x, neckDrop)} Z`]
    : [];

  // --- Детали кроя ---------------------------------------------------------
  // Рукав — отдельная деталь: он ограничен проймой, а не силуэтом. Обратный
  // ход по пройме получается перестановкой опорных точек кубической кривой.
  const armholeBack = C(
    { x: g.underarm.x - armDy * 0.08, y: g.underarm.y - armDy * 0.22 },
    { x: g.shoulderPoint.x - armDy * 0.1, y: g.shoulderPoint.y + armDy * 0.38 },
    g.shoulderPoint,
  );
  const sleevePanel = `${M(g.shoulderPoint)} ${sleeveTop} ${sleeveEnd} ${sleeveUnder} ${armholeBack} Z`;

  // Долевая рукава идёт вдоль его длины. Поворот мотива от вертикали:
  // rotate(a) переводит (0,1) в (−sin a, cos a); приравняв это направлению
  // рукава (cos θ, sin θ), получаем a = θ − 90°.
  const sleeveGrainDeg = (g.sleeveAngle * 180) / Math.PI - 90;

  const panels: FlatPanel[] = [
    { id: 'body', d: outline, material: 'shell', grain_deg: 0 },
    // Рукав — отдельная деталь кроя. У безрукавки его в раскладке нет,
    // и панели тоже быть не должно: заливка красила бы пустоту.
    ...(m.sleeveless
      ? []
      : [
          {
            id: 'sleeve',
            d: sleevePanel,
            material: 'shell' as const,
            grain_deg: sleeveGrainDeg,
          },
        ]),
  ];
  if (hoodFill.length) {
    panels.push({ id: 'hood', d: hoodFill[0]!, material: 'shell', grain_deg: 0 });
  }
  if (pocket.length) {
    panels.push({ id: 'pocket', d: `${pocket[0]!.d} Z`, material: 'shell', grain_deg: 0 });
  }
  if (m.waistRibHeight !== undefined) {
    const y = g.hem.y - m.waistRibHeight;
    panels.push({
      id: 'waistband',
      material: 'rib',
      grain_deg: 0,
      d: `${M({ x: 0, y })} L ${f(g.waist.x)} ${f(y)} L ${f(g.waist.x)} ${f(g.hem.y)} L 0 ${f(g.hem.y)} Z`,
    });
  }
  if (m.cuffRibHeight !== undefined) {
    const dirC = { x: Math.cos(g.sleeveAngle), y: Math.sin(g.sleeveAngle) };
    const perpC = { x: -Math.sin(g.sleeveAngle), y: Math.cos(g.sleeveAngle) };
    const a = {
      x: g.sleeveTopEnd.x - dirC.x * m.cuffRibHeight,
      y: g.sleeveTopEnd.y - dirC.y * m.cuffRibHeight,
    };
    const b = { x: a.x + perpC.x * m.sleeveOpening, y: a.y + perpC.y * m.sleeveOpening };
    panels.push({
      id: 'cuff',
      material: 'rib',
      grain_deg: 0,
      d: `${M(a)} ${L(g.sleeveTopEnd)} ${L(g.sleeveBottomEnd)} ${L(b)} Z`,
    });
  }
  if (m.neckRibHeight !== undefined) {
    // Кольцо бейки: наружная дуга от центра к плечу, короткий отрезок вдоль
    // плеча, внутренняя дуга обратно к центру. Обе дуги — один и тот же
    // эллипс с разными полуосями, поэтому кольцо выходит ровным.
    panels.push({
      id: 'neckband',
      material: 'rib',
      grain_deg: 0,
      d:
        `${neckArc(bandA, bandB)} L ${f(g.hps.x)} 0 ` +
        `${neckArcTailBack(g.hps.x, neckDrop)} L 0 ${f(bandB)} Z`,
    });
  }

  return {
    geometry: g,
    paths: {
      outline,
      seams,
      stitches,
      ribs,
      hood,
      parts: [],
      fill: [outline, ...hoodFill],
      panels,
      pocket,
      center,
      hidden: [],
    },
  };
}
