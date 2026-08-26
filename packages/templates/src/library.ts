import { boxHeight, boxWidth, type Box } from './svg.js';

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
   * Габарит листа НАШЕГО чертежа по этому изделию, в сантиметрах.
   *
   * Не ширина груди: в габарит чертежа входят разведённые рукава, и
   * приравнять его к груди значило бы уменьшить силуэт вдвое. Габарит
   * приходит из параметрического мастера, который построен по табелю мер, —
   * то есть масштаб всё равно задан табелем, только через ту же условность
   * рисунка, в какой нарисован и шаблон.
   */
  targetWidthCm: number;
  targetHeightCm: number;
  /** Текст плашки на языке комплекта. */
  disclaimer: string;
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
   * Насколько пропорции шаблона расходятся с нашим чертежом.
   *
   * Считается по отношению ширины к высоте: 0.12 означает, что лист
   * шаблона на двенадцать процентов иной формы, чем наш. Часть этого
   * расхождения — разница условности рисунка (угол отведения рукава),
   * и небольшую разницу мы прощаем. Большая означает другое изделие:
   * кроп вместо обычного, удлинённое вместо стандартного.
   */
  proportionDrift: number;
}

const PLATE_FILL = '#F4F2EE';
const PLATE_TEXT = '#5A554D';

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

  // Расхождение считается ДО масштабирования и по форме листа, а не по
  // размеру: размер мы задаём сами, а форму задал художник.
  const templateAspect = unitsWide / unitsTall;
  const targetAspect = options.targetWidthCm / options.targetHeightCm;
  const proportionDrift = Math.abs(templateAspect - targetAspect) / targetAspect;

  // Вписываем, а не растягиваем: неравномерный масштаб утолщил бы линию
  // поперёк и утончил вдоль — чертёж поехал бы там, где его читают.
  const scale = Math.min(options.targetWidthCm / unitsWide, options.targetHeightCm / unitsTall);
  const drawnWidth = unitsWide * scale;
  const drawnHeight = unitsTall * scale;

  // Подпись вида рисует ВЫЗЫВАЮЩАЯ СТОРОНА: у документа она своя, в своей
  // типографике, и вторая внутри картинки только налезала бы на шапку листа.
  const plateHeight = options.targetHeightCm * 0.085;
  const frameWidth = options.targetWidthCm;
  const frameHeight = drawnHeight + plateHeight * 1.7;
  const offsetX = (frameWidth - drawnWidth) / 2;
  const fontPlate = options.targetHeightCm * 0.032;

  const body = innerOf(templateSvg);
  // Толщина линии живёт в единицах шаблона; при переносе в сантиметры её
  // надо вернуть обратно, иначе крупный силуэт придёт с волосяным контуром,
  // а мелкий — с жирным.
  const strokeScale = 1 / scale;

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r(frameWidth)} ${r(frameHeight)}" role="img">`,
    `<g transform="translate(${r(offsetX)} 0) scale(${r6(scale)}) ` +
      `translate(${r6(-box.minX)} ${r6(-box.minY)})" ` +
      `stroke-width="${r6(strokeScale)}">`,
    body,
    '</g>',
    `<rect x="${r(frameWidth * 0.16)}" y="${r(drawnHeight + plateHeight * 0.45)}" ` +
      `width="${r(frameWidth * 0.68)}" height="${r(plateHeight)}" rx="${r(plateHeight * 0.28)}" ` +
      `fill="${PLATE_FILL}"/>`,
    `<text x="${r(frameWidth / 2)}" y="${r(drawnHeight + plateHeight * 1.18)}" ` +
      `text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${r(fontPlate)}" ` +
      `fill="${PLATE_TEXT}">${escapeXml(options.disclaimer)}</text>`,
    '</svg>',
  ].join('');

  return {
    svg,
    viewBox: { width: frameWidth, height: frameHeight },
    scale,
    proportionDrift: Math.round(proportionDrift * 1000) / 1000,
  };
}

/**
 * Порог расхождения формы листа, за которым силуэт не годится.
 *
 * Четверть — это уже другое изделие: кроп вместо обычного, удлинённое
 * вместо стандартного. Такую подмену увидит и заказчик, и фабрика, и
 * никакая плашка её не оправдает. Тогда честнее вернуться к
 * параметрическому мастеру, который построит силуэт ровно по табелю.
 *
 * Меньшую разницу прощаем сознательно: часть её — не изделие, а условность
 * рисунка. Угол отведения рукава меняет форму листа сильнее, чем длина
 * изделия, и требовать здесь совпадения значило бы отвергать библиотеку
 * целиком за то, что её рисовал другой человек.
 */
export const MAX_PROPORTION_DRIFT = 0.25;

const r = (n: number): string => (Math.round(n * 100) / 100).toString();
const r6 = (n: number): string => (Math.round(n * 1e6) / 1e6).toString();

function escapeXml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
