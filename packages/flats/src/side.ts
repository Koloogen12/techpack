import type { Centimeters } from '@seamsterly/core';
import { buildGeometry, type FlatMeasurements, type Point } from './geometry.js';
import {
  DEFAULT_PATH_OPTIONS,
  type FlatPanel,
  type FlatPaths,
  type PathOptions,
  type SeamLine,
} from './paths.js';
import { C, f, L, M } from './svg.js';

/**
 * Боковой вид технического чертежа.
 *
 * Зачем он нужен: наша же база знаний (knowledge-base/02 §2) требует side
 * для изделий с объёмом и боковой конструкцией. На переде и спинке капюшон
 * показан РАЗЛОЖЕННЫМ ВВЕРХ — это отраслевая условность, и она по построению
 * скрывает его настоящую форму. Карман-кенгуру на переде виден плоским
 * прямоугольником. Боковой вид — единственное место, где обе детали
 * показывают свой профиль.
 *
 * ЧЕСТНО О ГЛАВНОМ. Перед и спинка — изделие РАЗЛОЖЕННОЕ, бок — изделие
 * С ОБЪЁМОМ. Иначе не бывает: у разложенного изделия глубины нет, оно плоское
 * по определению, и «настоящий» боковой вид разложенной футболки — полоска
 * толщиной в два слоя полотна. Такой вид не рисует никто, потому что он
 * ничего не сообщает. Отсюда следствие, которое обязано стоять на листе:
 * ширину бокового вида нельзя сравнивать с шириной переда — это разные
 * величины на разных видах.
 *
 * Глубина изделия не задана ни одним нашим замером и не может быть задана.
 * Она ВЫВОДИТСЯ — см. `garmentDepth`.
 */

export interface DepthModel {
  /** Обхват груди ТЕЛА по размерной сетке, см. */
  bodyChest: Centimeters;
  /** Ширина торса, делённая на глубину. Из справочника body_cross_section. */
  widthToDepth: number;
}

/**
 * Полуглубина эллипса заданного периметра и заданного отношения осей.
 *
 * Периметр эллипса в элементарных функциях не выражается; берём приближение
 * Рамануджана P ≈ π[3(a+b) − √((3a+b)(a+3b))]. При a = r·b оно линейно по b,
 * поэтому b находится делением, без итераций. Погрешность приближения
 * на наших отношениях осей — доли процента, то есть заведомо меньше
 * неопределённости самого отношения.
 */
function semiDepth(perimeter: number, r: number): number {
  const k = 3 * (r + 1) - Math.sqrt((3 * r + 1) * (r + 3));
  return perimeter / (Math.PI * k);
}

/**
 * Глубина изделия на уровне груди, см.
 *
 * Модель в трёх шагах, и ни один из них не является подгонкой:
 *
 *  1. Сечение тела на уровне груди — эллипс, периметр которого равен обхвату
 *     груди из размерной сетки, а отношение осей взято из справочника.
 *  2. Прибавка на свободу ложится РАВНОМЕРНЫМ ОТСТУПОМ по контуру. Периметр
 *     эквидистанты растёт на 2·π·d, откуда отступ d = прибавка / 2π.
 *  3. Глубина изделия = глубина тела + два отступа.
 *
 * Следствие, ради которого модель и выбрана такой: с ростом прибавки сечение
 * КРУГЛЕЕТ. Оверсайз в боковом виде выходит заметно глубже прилегающего —
 * ровно как в жизни. Отношение «ширина к глубине», взятое напрямую готовым
 * числом, этого бы не дало: оно бы растягивало одну и ту же форму.
 *
 * Отрицательная прибавка законна — на трикотаже прилегающая посадка бывает
 * уже тела (см. ease_defaults). Но изделие не может сжать грудную клетку
 * вдвое: глубина ограничена снизу.
 */
export function garmentDepth(chestFlat: Centimeters, model: DepthModel): Centimeters {
  const bodyHalfDepth = semiDepth(model.bodyChest, model.widthToDepth);
  const ease = 2 * chestFlat - model.bodyChest;
  const offset = ease / (2 * Math.PI);
  const MIN_SHARE = 0.6;
  return Math.max(2 * (bodyHalfDepth + offset), 2 * bodyHalfDepth * MIN_SHARE);
}

/**
 * Передний край изделия на заданной высоте, см от середины глубины.
 *
 * Глубина на уровне следует за шириной на этом же уровне: сечение сохраняет
 * форму, меняется только его периметр. Поэтому приталенное изделие сужается
 * на боковом виде ровно настолько же, насколько на переде.
 */
function frontHalfAt(
  m: FlatMeasurements,
  depth: Centimeters,
  y: number,
  yWaist: number,
  yHem: number,
): number {
  const width =
    y <= yWaist
      ? m.chestFlat + (m.waistFlat - m.chestFlat) * Math.max(0, y / yWaist)
      : m.waistFlat + ((m.hemFlat - m.waistFlat) * (y - yWaist)) / (yHem - yWaist);
  return (depth / 2) * (width / m.chestFlat);
}

/** Карман настрочной: он лежит ПОВЕРХ полотна, а не заподлицо с ним. */
const POCKET_PROUD = 1.3;

export interface SideGeometry {
  /** Высшая точка плеча. В проекции сбоку лежит на середине глубины. */
  hps: Point;
  /** Точка горловины по центру переда — передний край изделия. */
  frontNeck: Point;
  backNeck: Point;
  /** Уровень груди, передний край. */
  chestFront: Point;
  chestBack: Point;
  hemFront: Point;
  hemBack: Point;
  /** Низ рукава. */
  sleeveEnd: Point;
  /** Глубина изделия на уровне груди, см. */
  depth: Centimeters;
  hoodTop?: Point;
  bounds: { left: number; right: number; top: number; bottom: number };
}

/**
 * Построение контрольных точек бокового вида.
 *
 * Уровни по вертикали НЕ вычисляются заново: они берутся из геометрии переда.
 * Это не экономия, а гарантия — линия груди, талии и низа обязаны совпадать
 * на всех трёх видах, и совпадать по построению, а не по совпадению формул.
 *
 * Ось X направлена ВПЕРЁД: изделие смотрит вправо.
 */
export function buildSideGeometry(m: FlatMeasurements, depth: Centimeters): SideGeometry {
  const g = buildGeometry(m, 'front');
  const neckHalf = m.neckWidth / 2;

  const hps: Point = { x: 0, y: 0 };
  const frontNeck: Point = { x: neckHalf, y: m.frontNeckDrop };
  const backNeck: Point = { x: -neckHalf, y: m.backNeckDrop };

  const chestHalf = depth / 2;
  const waistHalf = (depth / 2) * (m.waistFlat / m.chestFlat);
  const hemHalf = (depth / 2) * (m.hemFlat / m.chestFlat);

  const chestFront: Point = { x: chestHalf, y: g.underarm.y };
  const chestBack: Point = { x: -chestHalf, y: g.underarm.y };
  const hemFront: Point = { x: hemHalf, y: g.hem.y };
  const hemBack: Point = { x: -hemHalf, y: g.hem.y };

  // Рукав висит вдоль тела, слегка вперёд: руки в покое не висят строго
  // вертикально. Величина наклона — условность рисунка, и она не влияет
  // ни на один замер.
  const cuffShift = m.sleeveLength * 0.06;
  const sleeveEnd: Point = { x: cuffShift, y: g.shoulderPoint.y + m.sleeveLength };

  let hoodTop: Point | undefined;
  if (m.hoodHeight !== undefined && m.hoodWidth !== undefined) {
    hoodTop = { x: -m.hoodWidth * 0.08, y: -m.hoodHeight };
  }

  // Габариты считаются по ФАКТИЧЕСКИМ крайним точкам всех деталей, а не по
  // одному силуэту корпуса. Карман выступает наружу, капюшон шире изделия
  // в верхней части — и то, и другое обязано попасть в кадр. Деталь,
  // не вошедшую в габарит, чертёж рисует за краем видимой области:
  // она есть в файле, и её не видно.
  const hoodHalf = (m.hoodWidth ?? 0) * 0.52;
  const sleeveHalf = m.bicep / Math.PI;
  // Крайняя точка кармана — по ВЕРХНЕМУ его краю: изделие сужается к низу,
  // поэтому вверху карман выступает дальше. Взяв нижний край, габарит вышел бы
  // меньше нужного, и вход для руки оказался бы за краем видимой области.
  const pocketRight =
    m.pocketHeight !== undefined
      ? frontHalfAt(
          m,
          depth,
          g.hem.y - (m.waistRibHeight ?? 2) - 1.5 - m.pocketHeight,
          g.waist.y,
          g.hem.y,
        ) + POCKET_PROUD
      : 0;

  const left = -Math.max(chestHalf, waistHalf, hemHalf, hoodHalf, sleeveHalf);
  const right = Math.max(
    chestHalf,
    waistHalf,
    hemHalf,
    hoodHalf,
    sleeveHalf + cuffShift,
    pocketRight,
  );

  return {
    hps,
    frontNeck,
    backNeck,
    chestFront,
    chestBack,
    hemFront,
    hemBack,
    sleeveEnd,
    depth,
    ...(hoodTop ? { hoodTop } : {}),
    bounds: {
      left,
      right,
      top: Math.min(0, hoodTop?.y ?? 0),
      bottom: Math.max(g.hem.y, sleeveEnd.y),
    },
  };
}

export function buildSidePaths(
  m: FlatMeasurements,
  depth: Centimeters,
  options: PathOptions = DEFAULT_PATH_OPTIONS,
): { geometry: SideGeometry; paths: FlatPaths } {
  const s = buildSideGeometry(m, depth);
  const g = buildGeometry(m, 'front', options.minSleeveAngleDeg);
  const yChest = s.chestFront.y;
  const yWaist = g.waist.y;
  const yHem = s.hemFront.y;
  const waistHalf = (depth / 2) * (m.waistFlat / m.chestFlat);

  // --- Силуэт корпуса ----------------------------------------------------------
  // Обход: от горловины спинки назад-вниз, по низу вперёд, вверх по переду
  // и по плечу обратно. Один замкнутый путь — иначе заливка раппортом
  // не сработает, а она рисуется этим же контуром.
  const backEdge =
    C(
      { x: -depth * 0.42, y: s.backNeck.y + (yChest - s.backNeck.y) * 0.45 },
      { x: s.chestBack.x, y: yChest - (yChest - s.backNeck.y) * 0.25 },
      s.chestBack,
    ) +
    ' ' +
    C(
      { x: s.chestBack.x, y: yChest + (yWaist - yChest) * 0.5 },
      { x: -waistHalf, y: yWaist },
      { x: -waistHalf, y: yWaist },
    ) +
    ' ' +
    C({ x: -waistHalf, y: yWaist + (yHem - yWaist) * 0.4 }, s.hemBack, s.hemBack);

  const frontEdge =
    C(
      { x: waistHalf, y: yWaist + (yHem - yWaist) * 0.4 },
      { x: waistHalf, y: yWaist },
      { x: waistHalf, y: yWaist },
    ) +
    ' ' +
    C({ x: s.chestFront.x, y: yChest + (yWaist - yChest) * 0.5 }, s.chestFront, s.chestFront) +
    ' ' +
    C(
      { x: s.chestFront.x, y: yChest - (yChest - s.frontNeck.y) * 0.25 },
      { x: depth * 0.42, y: s.frontNeck.y + (yChest - s.frontNeck.y) * 0.45 },
      s.frontNeck,
    );

  // Плечо: от переда через высшую точку к спинке. Горловина видна сбоку
  // как перевал через плечо, и её глубина спереди больше — это T15 против T16.
  const shoulder =
    C(
      { x: s.frontNeck.x * 0.6, y: s.frontNeck.y * 0.35 },
      { x: s.frontNeck.x * 0.35, y: 0 },
      s.hps,
    ) +
    ' ' +
    C(
      { x: s.backNeck.x * 0.35, y: 0 },
      { x: s.backNeck.x * 0.6, y: s.backNeck.y * 0.35 },
      s.backNeck,
    );

  const outline = [M(s.backNeck), backEdge, L(s.hemFront), frontEdge, shoulder, 'Z'].join(' ');

  // --- Рукав и пройма ----------------------------------------------------------
  // Рукав сбоку — труба: сверху купол оката, ниже сужение к манжете.
  // Диаметр трубы получается из замера: ширина рукава под проймой дана
  // в плоском виде, то есть это ПОЛОВИНА обхвата, и диаметр равен 2·T12/π.
  //
  // Пройму НЕ рисуем замкнутым овалом, хотя сбоку она им и является: овал
  // шириной с рукав читается дырой в изделии. Настоящая пройма узкая
  // и высокая — её обхват равен обхвату рукава, а высота вдвое больше
  // ширины, — и на боковом виде от неё видна одна линия шва втачивания.
  const yTop = g.shoulderPoint.y;
  const rArm = m.bicep / Math.PI;
  const rCuff = m.sleeveOpening / Math.PI;
  const cuffX = s.sleeveEnd.x;
  const capDrop = rArm * 1.3;

  const sleeve =
    `${M({ x: -rArm, y: yTop + capDrop })} ` +
    C({ x: -rArm, y: yTop + capDrop * 0.45 }, { x: -rArm * 0.55, y: yTop }, { x: 0, y: yTop }) +
    ' ' +
    C(
      { x: rArm * 0.55, y: yTop },
      { x: rArm, y: yTop + capDrop * 0.45 },
      {
        x: rArm,
        y: yTop + capDrop,
      },
    ) +
    ` ${L({ x: cuffX + rCuff, y: s.sleeveEnd.y })}` +
    ` ${L({ x: cuffX - rCuff, y: s.sleeveEnd.y })} Z`;

  // Шов втачивания: от верха плеча вперёд-вниз к нижней точке проймы.
  // Вынос вперёд — проекция шва, а не замер, и он намеренно мал: пройма
  // почти плоская, потому что её обхват набирается высотой, а не шириной.
  const bow = rArm * 0.5;
  const seams: SeamLine[] = [
    {
      id: 'armhole',
      d:
        `${M({ x: 0, y: yTop })} ` +
        C(
          { x: bow * 1.15, y: yTop + (yChest - yTop) * 0.3 },
          { x: bow, y: yChest - (yChest - yTop) * 0.28 },
          { x: 0, y: yChest },
        ),
    },
  ];

  // --- Боковой шов: то, ради чего вид существует -------------------------------
  // Он идёт по самой боковой линии изделия, а сбоку эта линия смотрит прямо
  // на нас — поэтому шов проецируется в вертикаль на середине глубины.
  // Рукав висит поверх него, и закрытый участок рисуется точками (KB 02 §3).
  const sleeveBottom = Math.min(s.sleeveEnd.y, yHem);
  const hidden: string[] = [];
  if (sleeveBottom > yChest) {
    hidden.push(`${M({ x: 0, y: yChest })} L 0 ${f(sleeveBottom)}`);
  }
  if (sleeveBottom < yHem) {
    seams.push({
      id: 'side_seam',
      d: `${M({ x: 0, y: Math.max(yChest, sleeveBottom) })} L 0 ${f(yHem)}`,
    });
  }

  // --- Отделочные детали --------------------------------------------------------
  const stitches: SeamLine[] = [];
  const ribs: string[] = [];
  const hemHalf = (depth / 2) * (m.hemFlat / m.chestFlat);

  if (m.waistRibHeight !== undefined) {
    const y = yHem - m.waistRibHeight;
    seams.push({ id: 'waistband', d: `${M({ x: -hemHalf, y })} L ${f(hemHalf)} ${f(y)}` });
    const step = Math.max(hemHalf / 7, 0.8);
    for (let x = -hemHalf + step; x < hemHalf; x += step) {
      ribs.push(`${M({ x, y })} L ${f(x)} ${f(yHem)}`);
    }
  } else {
    for (let i = 0; i < options.hemStitchRows; i++) {
      const y = yHem - options.hemAllowance + i * 0.35;
      stitches.push({
        id: 'hem_stitch',
        d: `${M({ x: -hemHalf + 0.2, y })} L ${f(hemHalf - 0.2)} ${f(y)}`,
      });
    }
  }

  if (m.cuffRibHeight !== undefined) {
    const y = s.sleeveEnd.y - m.cuffRibHeight;
    seams.push({ id: 'cuff', d: `${M({ x: cuffX - rCuff, y })} L ${f(cuffX + rCuff)} ${f(y)}` });
    const step = Math.max((rCuff * 2) / 5, 0.6);
    for (let x = cuffX - rCuff + step; x < cuffX + rCuff; x += step) {
      ribs.push(`${M({ x, y })} L ${f(x)} ${f(s.sleeveEnd.y)}`);
    }
  } else {
    for (let i = 0; i < options.sleeveStitchRows; i++) {
      const y = s.sleeveEnd.y - options.sleeveHemAllowance + i * 0.35;
      stitches.push({
        id: 'sleeve_hem_stitch',
        d: `${M({ x: cuffX - rCuff, y })} L ${f(cuffX + rCuff)} ${f(y)}`,
      });
    }
  }

  // --- Капюшон: здесь он показывает НАСТОЯЩИЙ профиль ---------------------------
  // На переде капюшон разложен вверх — условность, которая по построению
  // прячет его форму. Сбоку он весь из замеров: высота H01 от шва втачивания,
  // глубина H02 в самом широком месте, лицевой край H03.
  const hood: SeamLine[] = [];
  if (s.hoodTop && m.hoodWidth !== undefined && m.hoodHeight !== undefined) {
    const hw = m.hoodWidth;
    const hh = m.hoodHeight;
    const top = s.hoodTop;

    // Профиль капюшона: затылочная часть полная и круглая, макушка смещена
    // назад, лицевой край падает круто вниз. Симметричный купол читался бы
    // шапкой, а не капюшоном.
    hood.push({
      id: 'hood_outline',
      d:
        `${M(s.backNeck)} ` +
        C(
          { x: -hw * 0.55, y: -hh * 0.22 },
          { x: -hw * 0.52, y: -hh * 0.62 },
          {
            x: -hw * 0.4,
            y: -hh * 0.86,
          },
        ) +
        ' ' +
        C({ x: -hw * 0.3, y: -hh * 0.99 }, { x: -hw * 0.12, y: -hh }, top) +
        ' ' +
        C(
          { x: hw * 0.2, y: -hh * 0.99 },
          { x: hw * 0.44, y: -hh * 0.78 },
          {
            x: hw * 0.5,
            y: -hh * 0.46,
          },
        ) +
        ' ' +
        C(
          { x: hw * 0.5, y: -hh * 0.14 },
          { x: s.frontNeck.x + hw * 0.04, y: s.frontNeck.y - hh * 0.03 },
          s.frontNeck,
        ),
    });

    // Кулиска идёт вдоль лицевого края, отступя внутрь на свою ширину.
    const inset = Math.min((m.hoodOpening ?? hh) * 0.08, hw * 0.14);
    hood.push({
      id: 'hood_casing',
      d:
        `${M({ x: top.x + hw * 0.08, y: -hh + inset })} ` +
        C(
          { x: hw * 0.2, y: -hh * 0.95 },
          { x: hw * 0.44 - inset, y: -hh * 0.75 },
          {
            x: hw * 0.5 - inset,
            y: -hh * 0.45,
          },
        ) +
        ' ' +
        C(
          { x: hw * 0.5 - inset, y: -hh * 0.15 },
          { x: s.frontNeck.x + hw * 0.02, y: s.frontNeck.y - inset },
          {
            x: s.frontNeck.x + hw * 0.02,
            y: s.frontNeck.y - inset * 0.7,
          },
        ),
    });
    // Люверс кулиски у основания лицевого края.
    hood.push({
      id: 'hood_eyelet',
      d: `${M({ x: hw * 0.44, y: -hh * 0.12 })} m -0.45 0 a 0.45 0.45 0 1 0 0.9 0 a 0.45 0.45 0 1 0 -0.9 0`,
    });
  }

  // --- Карман-кенгуру: сбоку виден профилем, а не прямоугольником ----------------
  // Ради этого профиля бок и нужен изделию с настрочным карманом: на переде
  // карман выглядит плоским прямоугольником, хотя он лежит ПОВЕРХ полотна
  // и на готовом изделии отстоит от него.
  const pocket: SeamLine[] = [];
  if (m.pocketWidth !== undefined && m.pocketHeight !== undefined) {
    const bottom = yHem - (m.waistRibHeight ?? 2) - 1.5;
    const top = bottom - m.pocketHeight;
    const at = (y: number): number => frontHalfAt(m, depth, y, yWaist, yHem);
    pocket.push({
      id: 'pocket',
      d:
        `${M({ x: at(top), y: top })} ` +
        // Вход для руки: верхний край отходит от изделия — туда и заходит рука.
        C(
          { x: at(top) + POCKET_PROUD * 0.9, y: top + m.pocketHeight * 0.1 },
          {
            x: at(top) + POCKET_PROUD,
            y: top + m.pocketHeight * 0.3,
          },
          { x: at(top + m.pocketHeight * 0.45) + POCKET_PROUD, y: top + m.pocketHeight * 0.45 },
        ) +
        ` L ${f(at(bottom) + POCKET_PROUD)} ${f(bottom)}` +
        ` L ${f(at(bottom))} ${f(bottom)}`,
    });
  }

  return {
    geometry: s,
    paths: {
      outline,
      seams,
      stitches,
      ribs,
      hood,
      parts: [sleeve],
      // Сбоку контур капюшона идёт от горловины спинки до горловины переда,
      // и его неявное замыкание — это и есть линия втачивания. Дорисовывать
      // нечего.
      fill: [outline, ...(hood.length ? [hood[0]!.d] : []), sleeve],
      panels: sidePanels(m, outline, hood, sleeve, s, yHem, hemHalf, cuffX, rCuff),
      pocket,
      center: '',
      hidden,
    },
  };
}

/**
 * Детали кроя бокового вида.
 *
 * Тот же принцип, что на переде: пояс и манжета кроятся из другого полотна
 * и рисунком не заливаются. Долевая рукава сбоку идёт вертикально — рукав
 * висит вдоль тела, — поэтому поворота у него здесь нет.
 */
function sidePanels(
  m: FlatMeasurements,
  outline: string,
  hood: SeamLine[],
  sleeve: string,
  s: SideGeometry,
  yHem: number,
  hemHalf: number,
  cuffX: number,
  rCuff: number,
): FlatPanel[] {
  const panels: FlatPanel[] = [
    { id: 'body', d: outline, material: 'shell', grain_deg: 0 },
    { id: 'sleeve', d: sleeve, material: 'shell', grain_deg: 0 },
  ];
  if (hood.length) panels.push({ id: 'hood', d: hood[0]!.d, material: 'shell', grain_deg: 0 });
  if (m.waistRibHeight !== undefined) {
    const y = yHem - m.waistRibHeight;
    panels.push({
      id: 'waistband',
      material: 'rib',
      grain_deg: 0,
      d: `${M({ x: -hemHalf, y })} ${L({ x: hemHalf, y })} ${L({ x: hemHalf, y: yHem })} ${L({ x: -hemHalf, y: yHem })} Z`,
    });
  }
  if (m.cuffRibHeight !== undefined) {
    const y = s.sleeveEnd.y - m.cuffRibHeight;
    panels.push({
      id: 'cuff',
      material: 'rib',
      grain_deg: 0,
      d: `${M({ x: cuffX - rCuff, y })} ${L({ x: cuffX + rCuff, y })} ${L({ x: cuffX + rCuff, y: s.sleeveEnd.y })} ${L({ x: cuffX - rCuff, y: s.sleeveEnd.y })} Z`,
    });
  }
  return panels;
}
