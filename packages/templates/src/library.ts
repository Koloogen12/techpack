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
  /** Ширина изделия в плоском виде, см — по ней задаётся масштаб. */
  chestFlatCm: number;
  /** Длина изделия, см — ею проверяется, что шаблон не врёт по пропорции. */
  lengthCm: number;
  /** Подпись вида: «Перед», «Спинка». */
  viewLabel: string;
  /** Текст плашки на языке комплекта. */
  disclaimer: string;
  /** Ширина поля вывода в тех же см. */
  frameWidthCm?: number;
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
   * Насколько пропорции шаблона расходятся с табелем.
   *
   * 0.12 означает, что при совпадении по груди длина силуэта отличается от
   * табельной на 12%. Значение не прячется: по нему решают, годится ли
   * библиотечный силуэт или нужен параметрический мастер.
   */
  proportionDrift: number;
}

const PLATE_FILL = '#F4F2EE';
const PLATE_TEXT = '#5A554D';
const LABEL_TEXT = '#0E0E0E';

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

  // Масштаб задаёт ГРУДЬ, а не длина: ширина в плоском виде — то, что
  // на флэте сверяют глазом с табелем в первую очередь.
  const scale = options.chestFlatCm / unitsWide;
  const drawnLength = unitsTall * scale;
  const proportionDrift =
    options.lengthCm > 0 ? Math.abs(drawnLength - options.lengthCm) / options.lengthCm : 0;

  const frameWidth = options.frameWidthCm ?? options.chestFlatCm * 1.6;
  const labelSpace = options.chestFlatCm * 0.09;
  const plateHeight = options.chestFlatCm * 0.11;
  const frameHeight = labelSpace + drawnLength + plateHeight * 1.6;
  const offsetX = (frameWidth - options.chestFlatCm) / 2;

  const fontLabel = options.chestFlatCm * 0.055;
  const fontPlate = options.chestFlatCm * 0.042;

  const body = innerOf(templateSvg);
  // Толщина линии живёт в единицах шаблона; при переносе в сантиметры её
  // надо вернуть обратно, иначе крупный силуэт придёт с волосяным контуром,
  // а мелкий — с жирным.
  const strokeScale = 1 / scale;

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r(frameWidth)} ${r(frameHeight)}" role="img">`,
    `<text x="${r(frameWidth / 2)}" y="${r(labelSpace * 0.7)}" text-anchor="middle" ` +
      `font-family="Inter, Arial, sans-serif" font-size="${r(fontLabel)}" fill="${LABEL_TEXT}">` +
      `${escapeXml(options.viewLabel)}</text>`,
    `<g transform="translate(${r(offsetX)} ${r(labelSpace)}) scale(${r6(scale)}) ` +
      `translate(${r6(-box.minX)} ${r6(-box.minY)})" ` +
      `vector-effect="non-scaling-stroke" stroke-width="${r6(strokeScale)}">`,
    body,
    '</g>',
    `<rect x="${r(offsetX)}" y="${r(labelSpace + drawnLength + plateHeight * 0.35)}" ` +
      `width="${r(options.chestFlatCm)}" height="${r(plateHeight)}" rx="${r(plateHeight * 0.25)}" ` +
      `fill="${PLATE_FILL}"/>`,
    `<text x="${r(frameWidth / 2)}" y="${r(labelSpace + drawnLength + plateHeight * 1.05)}" ` +
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
 * Порог расхождения пропорций, за которым библиотечный силуэт не годится.
 *
 * Пятая часть длины — это разница между обычным и укороченным изделием:
 * такую подмену увидит и заказчик, и фабрика, и никакая плашка её не
 * оправдает. Тогда честнее вернуться к параметрическому мастеру, который
 * построит силуэт ровно по табелю.
 */
export const MAX_PROPORTION_DRIFT = 0.2;

const r = (n: number): string => (Math.round(n * 100) / 100).toString();
const r6 = (n: number): string => (Math.round(n * 1e6) / 1e6).toString();

function escapeXml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
