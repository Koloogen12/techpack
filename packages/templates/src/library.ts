import type { NodeZone } from '@seamsterly/kb';
import { boxHeight, boxWidth, type Box } from './svg.js';
import { landmarksOf, zonesOf, type SilhouetteDetails } from './zones.js';

/**
 * Отрисовка силуэта из библиотеки в масштабе изделия.
 *
 * У шаблона библиотеки нет контрольных точек: он не деформируется под
 * замеры, а только масштабируется. Отсюда два следствия, и оба честные.
 * Первое: масштаб единый по обеим осям — растянуть силуэт по длине значило
 * бы утолщить линию поперёк и утончить вдоль, и чертёж поехал бы там, где
 * его как раз читают. Второе: на таком виде не место выноскам размеров —
 * они указывали бы на точки, которых мы не размечали. Поэтому вид несёт
 * плашку: размеры живут в табеле мер, а картинка показывает силуэт.
 */

export interface LibraryRenderOptions {
  /**
   * Сколько места на листе отведено виду, в сантиметрах изделия.
   *
   * Рамка, а не размер силуэта: в неё он вписывается, если оказался шире.
   */
  targetWidthCm: number;
  targetHeightCm: number;
  /**
   * Самая узкая ширина корпуса по табелю, см — по ней задаётся масштаб.
   *
   * Не габарит листа: тот в первую очередь про угол отведения рукава. Наш
   * мастер кладёт рукав почти горизонтально и даёт лист вдвое шире своей
   * высоты, а художник датасета опускает рукав вниз; сравнивать такие
   * листы значит мерить манеру рисования, а не изделие.
   */
  bodyWidthCm: number;
  /**
   * Пропорция корпуса по табелю: ширина корпуса к длине изделия.
   *
   * Мера расхождения. Она не зависит ни от угла рукава, ни от того, как
   * нарисован капюшон, — зато ловит именно подмену изделия: кроп вместо
   * обычного, удлинённое вместо стандартного.
   */
  bodyRatio: number;
  /**
   * Текст плашки на языке комплекта.
   *
   * Пусто — плашки нет вовсе. Так силуэт идёт на лист просчёта: там он
   * величиной со спичечный коробок, оговорка в нём превращается в
   * нечитаемую полоску, а сам лист и без неё говорит, что размеры в паке.
   */
  disclaimer: string;
  /**
   * Выноски на зоны изделия.
   *
   * Указывают на зону, а не на точку, и лист об этом говорит: у покупного
   * силуэта нет контрольных точек, и выноска на «тридцать четвёртый
   * сантиметр» была бы враньём. Зато «вот здесь пройма» — правда, и это
   * тот же язык, которым устроен справочник узлов.
   */
  callouts?: {
    /** Какие зоны показывать. Обычно — те, где у изделия есть узлы. */
    zones: readonly NodeZone[];
    /** Подпись зоны на языке комплекта. */
    label: (zone: NodeZone) => string;
    /** Что на силуэте нарисовано — по разметке шаблона, не по геометрии. */
    details: SilhouetteDetails;
  };
}

export interface LibraryRenderResult {
  svg: string;
  /**
   * Габарит вида в сантиметрах изделия.
   *
   * Тот же контракт, что у параметрического чертежа: вёрстка ставит виды
   * в один масштаб, деля ширины колонок в отношении ширин видов.
   */
  viewBox: { width: number; height: number };
  /** Во сколько раз единицы шаблона переведены в сантиметры. */
  scale: number;
  /**
   * Насколько пропорции корпуса шаблона расходятся с табелем.
   *
   * Ширина по низу к длине изделия — у шаблона и у табеля. 0.12 означает,
   * что корпус силуэта на двенадцать процентов иной пропорции. Угол рукава
   * и манера рисовать капюшон сюда не входят: они мерили бы художника,
   * а не изделие.
   */
  proportionDrift: number;
  /**
   * Удалось ли вообще замерить пропорцию.
   *
   * Ложь означает, что торс не отделился от рукавов и мерить нечем. На
   * такой замер не ссылаются и по нему не отказывают: отсутствие улики —
   * не улика. Годность силуэта тогда решают признаки каталога.
   */
  proportionMeasured: boolean;
  /**
   * Зоны, которых на этом силуэте не нашлось.
   *
   * Изделие их требует — узел обработки есть, — а силуэт такой детали не
   * рисует. Выноску мы не ставим, но и молчать нельзя: лист говорит прямо,
   * что деталь на иллюстрации не показана.
   */
  missing: NodeZone[];
  /**
   * Зоны, на которые действительно встали выноски.
   *
   * По ним проверяется связь «узел ↔ чертёж»: у библиотечного силуэта её
   * держит зона, а не линия шва, но держать её обязана.
   */
  zones: NodeZone[];
}

const PLATE_FILL = '#F4F2EE';
const PLATE_TEXT = '#5A554D';
const LABEL_TEXT = '#0E0E0E';
const LEADER = '#8A8378';

function parseViewBox(svg: string): Box | null {
  const m = /viewBox="([-\d.\s]+)"/.exec(svg);
  if (!m) return null;
  const n = m[1]!.trim().split(/\s+/).map(Number);
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) return null;
  return { minX: n[0]!, minY: n[1]!, maxX: n[0]! + n[2]!, maxY: n[1]! + n[3]! };
}

/** Внутренности SVG без внешнего тега — их можно вложить в группу с трансформом. */
function innerOf(svg: string): string {
  const open = svg.indexOf('>');
  const close = svg.lastIndexOf('</svg>');
  if (open < 0 || close < 0) return '';
  return svg.slice(open + 1, close);
}

export function renderLibraryView(
  templateSvg: string,
  options: LibraryRenderOptions,
): LibraryRenderResult {
  const box = parseViewBox(templateSvg);
  if (!box) throw new Error('в шаблоне нет viewBox');

  const unitsWide = boxWidth(box);
  const unitsTall = boxHeight(box);
  if (unitsWide <= 0 || unitsTall <= 0) throw new Error('вырожденный viewBox шаблона');

  // Пропорция считается КОРПУС К КОРПУСУ: ширина торса на уровне проймы к
  // длине от плеча до низа торса. Ни раскинутые рукава, ни высота капюшона
  // сюда не входят — иначе манера рисования пролезла бы в метрику через
  // заднюю дверь, и одинаковые изделия разошлись бы вдвое.
  const marks = landmarksOf(templateSvg);
  const bodyWidth = marks?.torsoWidth ?? 0;
  const bodyLength = marks ? marks.bodyBottomY - marks.shoulderY : 0;
  const measured = (marks?.torsoMeasured ?? false) && bodyWidth > 0 && bodyLength > 0;
  const templateRatio = measured ? bodyWidth / bodyLength : 0;
  const proportionDrift = measured
    ? Math.abs(templateRatio - options.bodyRatio) / options.bodyRatio
    : 0;

  // Под выноски нужны поля по бокам: подписи стоят в них, а не поверх
  // рисунка. Без выносок силуэт занимает габарит целиком.
  const gutter = options.callouts ? 0.21 : 0;
  const innerWidth = options.targetWidthCm * (1 - gutter * 2);

  // Масштаб задаёт низ изделия. Если при этом силуэт не влезает в отведённое
  // место — вписываем; лучше нарисовать мельче, чем залезть на соседний вид.
  const byBody = bodyWidth > 0 ? options.bodyWidthCm / bodyWidth : 0;
  const fit = Math.min(innerWidth / unitsWide, options.targetHeightCm / unitsTall);
  const scale = byBody > 0 ? Math.min(byBody, fit) : fit;
  const drawnWidth = unitsWide * scale;
  const drawnHeight = unitsTall * scale;

  const plate = options.disclaimer.length > 0;
  const plateHeight = plate ? options.targetHeightCm * 0.085 : 0;
  const frameWidth = options.targetWidthCm;
  const frameHeight = drawnHeight + plateHeight * 1.7;
  const offsetX = (frameWidth - drawnWidth) / 2;
  const fontPlate = options.targetHeightCm * 0.032;
  // Ширина плашки считается по самой подписи, а не долей рамки: оговорка
  // переводится, и на другом языке она другой длины. Полдоли кегля на знак —
  // средняя ширина в Inter; лишку съедают поля, недостачу — клэмп по рамке.
  const plateWidth = Math.min(
    frameWidth * 0.96,
    options.disclaimer.length * fontPlate * 0.52 + fontPlate * 2,
  );

  // Толщину линии здесь не трогаем: она задана при приёме шаблона долей от
  // размера рисунка и масштабируется вместе с ним. Задавать её на группе
  // бессмысленно — инлайн-стиль каждого пути всё равно сильнее.
  const body = innerOf(templateSvg);

  const drawn: NodeZone[] = [];
  const leaders = options.callouts
    ? calloutLayer(templateSvg, options.callouts, {
        box,
        scale,
        offsetX,
        drawnWidth,
        drawnHeight,
        frameWidth,
        font: options.targetHeightCm * 0.028,
        onDraw: (z) => drawn.push(z),
      })
    : '';

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r(frameWidth)} ${r(frameHeight)}" role="img">`,
    `<g transform="translate(${r(offsetX)} 0) scale(${r6(scale)}) ` +
      `translate(${r6(-box.minX)} ${r6(-box.minY)})">`,
    body,
    '</g>',
    leaders,
    plate
      ? `<rect x="${r((frameWidth - plateWidth) / 2)}" y="${r(drawnHeight + plateHeight * 0.45)}" ` +
        `width="${r(plateWidth)}" height="${r(plateHeight)}" rx="${r(plateHeight * 0.28)}" ` +
        `fill="${PLATE_FILL}"/>` +
        `<text x="${r(frameWidth / 2)}" y="${r(drawnHeight + plateHeight * 1.18)}" ` +
        `text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${r(fontPlate)}" ` +
        `fill="${PLATE_TEXT}">${escapeXml(options.disclaimer)}</text>`
      : '',
    '</svg>',
  ].join('');

  return {
    svg,
    viewBox: { width: frameWidth, height: frameHeight },
    scale,
    proportionDrift: Math.round(proportionDrift * 1000) / 1000,
    proportionMeasured: measured,
    missing: (options.callouts?.zones ?? []).filter((z) => !drawn.includes(z)),
    zones: drawn,
  };
}

/**
 * Слой выносок.
 *
 * Две вещи решают, читается лист или нет. Первая: подпись стоит НА ВЫСОТЕ
 * своей зоны, а не в общей стопке, — тогда линия идёт почти горизонтально
 * и не режет изделие по диагонали. Вторая: стороны чередуются по высоте, а
 * не выбираются по тому, слева зона или справа. Иначе всё, что на осевой —
 * капюшон, горловина, карман, низ, — уходит в одно поле, и шесть линий
 * сходятся в одну точку.
 */
function calloutLayer(
  templateSvg: string,
  callouts: NonNullable<LibraryRenderOptions['callouts']>,
  geom: {
    box: Box;
    scale: number;
    offsetX: number;
    drawnWidth: number;
    drawnHeight: number;
    frameWidth: number;
    font: number;
    onDraw: (zone: NodeZone) => void;
  },
): string {
  const anchors = zonesOf(templateSvg, callouts.details);
  const toX = (x: number): number => geom.offsetX + (x - geom.box.minX) * geom.scale;
  const toY = (y: number): number => (y - geom.box.minY) * geom.scale;

  const placed = callouts.zones
    .map((zone) => {
      const a = anchors.get(zone);
      return a ? { zone, x: toX(a.x), y: toY(a.y) } : null;
    })
    .filter((p): p is { zone: NodeZone; x: number; y: number } => p !== null)
    .sort((a, b) => a.y - b.y);
  if (placed.length === 0) return '';

  // Сторону выбирает сама зона, но только та, у которой есть сторона.
  // Боковой шов слева обязан подписываться слева — линия через всё изделие
  // читается как шов, которого нет. А осевые — капюшон, горловина, карман,
  // низ — стороны не имеют и идут туда, где просторнее.
  const centre = geom.offsetX + geom.drawnWidth / 2;
  const capacity = Math.ceil(placed.length / 2);
  const sides = { left: [] as typeof placed, right: [] as typeof placed };
  for (const p of [...placed].sort((a, b) => Math.abs(b.x - centre) - Math.abs(a.x - centre))) {
    const want = p.x < centre ? 'left' : 'right';
    const other = want === 'left' ? 'right' : 'left';
    sides[sides[want].length < capacity ? want : other].push(p);
  }
  sides.left.sort((a, b) => a.y - b.y);
  sides.right.sort((a, b) => a.y - b.y);

  const out: string[] = [];
  for (const side of ['left', 'right'] as const) {
    const list = sides[side];
    if (list.length === 0) continue;

    // Подпись хочет встать на высоте своей зоны; сталкиваясь, подписи
    // расходятся вниз, а упёршись в край листа — обратно вверх.
    const gap = geom.font * 1.9;
    const rows = list.map((p) => p.y);
    for (let i = 1; i < rows.length; i++) {
      rows[i] = Math.max(rows[i]!, rows[i - 1]! + gap);
    }
    const overflow = rows[rows.length - 1]! - (geom.drawnHeight - geom.font);
    if (overflow > 0) {
      for (let i = rows.length - 1; i >= 0; i--) {
        rows[i] = Math.min(rows[i]!, geom.drawnHeight - geom.font - gap * (rows.length - 1 - i));
      }
      for (let i = 1; i < rows.length; i++) rows[i] = Math.max(rows[i]!, rows[i - 1]! + gap);
    }

    // Подпись растёт ОТ рисунка наружу: слева выключка вправо, справа —
    // влево. Наоборот текст лез бы на изделие тем сильнее, чем длиннее
    // название зоны.
    const pad = geom.font * 0.5;
    const edge = side === 'left' ? geom.offsetX : geom.frameWidth - geom.offsetX;
    const labelX = side === 'left' ? edge - pad : edge + pad;
    const elbowX = side === 'left' ? edge - pad * 0.4 : edge + pad * 0.4;

    list.forEach((p, i) => {
      const labelY = Math.max(geom.font, rows[i]!);
      out.push(
        `<g data-zone="${p.zone}" fill="none" stroke="${LEADER}" ` +
          `stroke-width="${r6(geom.font * 0.055)}" stroke-linejoin="round">` +
          `<path d="M ${r(labelX)} ${r(labelY)} L ${r(elbowX)} ${r(labelY)} L ${r(p.x)} ${r(p.y)}"/>` +
          `<circle cx="${r(p.x)}" cy="${r(p.y)}" r="${r6(geom.font * 0.2)}" ` +
          `fill="${LEADER}" stroke="none"/></g>`,
      );
      out.push(
        `<text x="${r(labelX)}" y="${r(labelY - geom.font * 0.32)}" ` +
          `text-anchor="${side === 'left' ? 'end' : 'start'}" ` +
          `font-family="Inter, Arial, sans-serif" font-size="${r(geom.font)}" fill="${LABEL_TEXT}">` +
          `${escapeXml(callouts.label(p.zone))}</text>`,
      );
      geom.onDraw(p.zone);
    });
  }
  return out.join('');
}

/**
 * Порог расхождения пропорций корпуса, за которым силуэт не годится.
 *
 * Четверть — это уже другое изделие: кроп вместо обычного, удлинённое
 * вместо стандартного. Такую подмену увидит и заказчик, и фабрика, и
 * никакая плашка её не оправдает. Тогда честнее вернуться к
 * параметрическому мастеру, который построит силуэт ровно по табелю.
 */
export const MAX_PROPORTION_DRIFT = 0.25;

const r = (n: number): string => (Math.round(n * 100) / 100).toString();
const r6 = (n: number): string => (Math.round(n * 1e6) / 1e6).toString();

function escapeXml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
}
