import type { PomDrawing, StyleSpec } from '@seamster/stylespec';
import type { GarmentBox, PlacementGeometry } from './placement.js';

/**
 * Чертёж замеров: линии точек табеля на рисунке этой вещи и сетка в сантиметрах.
 *
 * Табель мер говорит, ЧТО измерять и СКОЛЬКО; чертёж показывает, ГДЕ на этой
 * вещи лежит каждая линия. Масштаб тот же, что у раскладки нанесения
 * (packages/flats/src/placement.ts): длина изделия из табеля против габарита
 * изделия на рисунке. Линия ставится по типовому месту для кода — так, как
 * его описывает справочник и ГОСТ 4103 (ширина по груди на уровне низа
 * проймы, низ рукава поперёк рукава у края и т. д.), — а человек может
 * подвинуть концы и подтвердить место. Значение линия не задаёт: числа
 * остаются в таблице, чертёж — иллюстрация места.
 *
 * Чистая геометрия без DOM: те же функции рисуют чертёж в кабинете, печатают
 * его в документе и собирают SVG на выгрузку.
 */

export type PomView = 'front' | 'back';

export interface PomPoint {
  x: number;
  y: number;
}

export interface PomLine {
  code: string;
  view: PomView;
  /** Точки линии в пикселях картинки вида; две — отрезок, три — ломаная. */
  pts: PomPoint[];
  /** Место задано человеком, а не типовое по коду. */
  custom: boolean;
  confirmed: boolean;
  value: number;
  name_ru: string;
}

export interface PomGrid {
  /** Шаг сетки, см: 5 или 10 — чтобы клетка читалась и на телефоне. */
  stepCm: number;
  /** Вертикальные и горизонтальные линии, px картинки. */
  xs: number[];
  ys: number[];
}

/** Значение точки табеля базового размера. */
function value(spec: StyleSpec, code: string): number | undefined {
  return spec.measurements.points.find((p) => p.code === code)?.base.value;
}

const HAS_NODE = (spec: StyleSpec, ...ids: string[]): boolean => {
  const nodes = new Set((spec.construction?.nodes ?? []).map((n) => n.node_id));
  return ids.some((id) => nodes.has(id));
};

/**
 * Типовое место линии для кода — в сантиметрах от высшей точки плеча (y вниз)
 * и середины переда/спинки (x вправо). Возвращает точки или null, когда для
 * кода типового места нет: такую линию человек ставит сам.
 *
 * Правила — по описаниям «как мерить» из справочника точек: ширина по
 * груди — на 1 см ниже проймы, по низу — на 1 см выше края, ширина плеч —
 * между плечевыми точками, пройма — по прямой от плечевой точки до низа
 * проймы, рукав — от плечевой точки по верхнему краю до низа, низ рукава —
 * поперёк рукава у края.
 */
function typicalCm(
  spec: StyleSpec,
  code: string,
  view: PomView,
  g: PlacementGeometry,
): [number, number][] | null {
  const v = (c: string) => value(spec, c);
  const length = v('T01') ?? v('J01');
  if (!length) return null;
  const neckW = v('T14') ?? 18;
  const shoulderW = v('T06') ?? (v('T03') ?? 46) * 0.95;
  const chestW = v('T03') ?? shoulderW;
  const slope = v('T18') ?? 4;
  const armhole = v('T09') ?? 22;
  const waistY = v('T20') ?? armhole + (length - armhole) * 0.45;
  const backDrop = v('T16') ?? 2;
  const cuffW = v('T13') ?? 9;
  const sleeveL = v('T10');
  const half = (c: string) => (v(c) ?? 0) / 2;

  // Плечевая точка и конец рукава: рукав идёт от плечевой точки по верхнему
  // краю к низу; наклон подбирается так, чтобы конец рукава лёг к краю
  // габарита на рисунке, а длина осталась табельной.
  const shoulder: [number, number] = [shoulderW / 2, slope];
  const sleeveEnd = (): [number, number] | null => {
    if (!sleeveL) return null;
    const edgeCm = (g.box.x1 - g.cfX) / g.pxPerCm - Math.max(cuffW, 4) / 2;
    let dx = edgeCm - shoulder[0];
    if (dx < sleeveL * 0.15) dx = sleeveL * 0.15;
    if (dx > sleeveL * 0.85) dx = sleeveL * 0.6;
    const dy = Math.sqrt(Math.max(0, sleeveL * sleeveL - dx * dx));
    return [shoulder[0] + dx, shoulder[1] + dy];
  };
  /** Единичный вектор оси рукава и перпендикуляр наружу (вверх от подмышки). */
  const sleeveAxis = () => {
    const end = sleeveEnd();
    if (!end) return null;
    const dx = end[0] - shoulder[0];
    const dy = end[1] - shoulder[1];
    const len = Math.hypot(dx, dy) || 1;
    return { end, d: [dx / len, dy / len] as const, p: [dy / len, -dx / len] as const };
  };

  if (view === 'front') {
    switch (code) {
      case 'T01':
        return [
          [-neckW / 2, 0],
          [-neckW / 2, length],
        ];
      case 'J01':
        return [
          [-half('B01') - 1.5, 0],
          [-half('B01') - 1.5, length],
        ];
      case 'T03':
        return [
          [-half('T03'), armhole + 1],
          [half('T03'), armhole + 1],
        ];
      case 'T04':
        return [
          [-half('T04'), waistY],
          [half('T04'), waistY],
        ];
      case 'T05':
      case 'J02':
        return [
          [-half(code), length - 1],
          [half(code), length - 1],
        ];
      case 'T19':
        return [
          [-half('T19'), waistY + 20],
          [half('T19'), waistY + 20],
        ];
      case 'T06':
        return [
          [-shoulderW / 2, slope],
          [shoulderW / 2, slope],
        ];
      case 'K02':
        return [
          [-half('K02'), 0],
          [half('K02'), 0],
        ];
      case 'T07':
        return [
          [-half('T07'), armhole * 0.55],
          [half('T07'), armhole * 0.55],
        ];
      case 'T09':
        return [
          [-shoulder[0], shoulder[1]],
          [-chestW / 2, armhole],
        ];
      case 'K03':
        return [
          [-half('K02'), 0],
          [-half('K02'), v('K03') ?? armhole],
        ];
      case 'T14':
        return [
          [-neckW / 2, 0],
          [neckW / 2, 0],
        ];
      case 'T15':
        return [
          [0, 0],
          [0, v('T15') ?? 7],
        ];
      case 'T17': {
        const h = v('T17');
        if (!h || !HAS_NODE(spec, 'neck_rib_band', 'collar_rib_stand', 'neck_binding')) return null;
        return [
          [neckW / 2 + 0.8, -h],
          [neckW / 2 + 0.8, 0],
        ];
      }
      case 'T18':
        return [
          [-shoulder[0], 0],
          [-shoulder[0], slope],
        ];
      case 'T20':
        return [
          [neckW / 2 + 2.5, 0],
          [neckW / 2 + 2.5, waistY],
        ];
      case 'T10': {
        const end = sleeveEnd();
        return end ? [shoulder, end] : null;
      }
      case 'T12': {
        const a = sleeveAxis();
        const w = v('T12');
        if (!a || !w) return null;
        const u: [number, number] = [chestW / 2, armhole];
        return [u, [u[0] + a.p[0] * w, u[1] + a.p[1] * w]];
      }
      case 'T13': {
        const a = sleeveAxis();
        const w = v('T13');
        if (!a || !w) return null;
        return [a.end, [a.end[0] - a.p[0] * w, a.end[1] - a.p[1] * w]];
      }
      case 'H08': {
        const a = sleeveAxis();
        const h = v('H08');
        if (!a || !h) return null;
        return [a.end, [a.end[0] - a.d[0] * h, a.end[1] - a.d[1] * h]];
      }
      case 'H07':
      case 'B03': {
        const h = v(code);
        if (!h) return null;
        const x = code === 'H07' ? half('T05') - 1.5 : -half('B01') - 1.5;
        const top = code === 'H07' ? length - h : 0;
        return [
          [x, top],
          [x, top + h],
        ];
      }
      case 'Z01':
      case 'O01': {
        const l = v(code);
        if (!l) return null;
        const top = v('T15') ?? 7;
        return [
          [0, top],
          [0, top + l],
        ];
      }
      case 'Z02': {
        const w = v('Z02');
        const l = v('Z01');
        if (!w) return null;
        const y = (v('T15') ?? 7) + (l ?? 20) / 2;
        return [
          [-w / 2, y],
          [w / 2, y],
        ];
      }
      case 'H04': {
        const w = v('H04');
        const h = v('H05') ?? 20;
        if (!w) return null;
        const y = length - (v('H07') ?? 6) - h / 2;
        return [
          [-w / 2, y],
          [w / 2, y],
        ];
      }
      case 'H05': {
        const h = v('H05');
        const w = v('H04') ?? 30;
        if (!h) return null;
        const bottom = length - (v('H07') ?? 6);
        return [
          [w / 2 + 1, bottom - h],
          [w / 2 + 1, bottom],
        ];
      }
      case 'B01':
        return [
          [-half('B01'), 1],
          [half('B01'), 1],
        ];
      case 'B04':
        return [
          [-half('B04'), 10],
          [half('B04'), 10],
        ];
      case 'B05':
        return [
          [-half('B05'), 20],
          [half('B05'), 20],
        ];
      default:
        return null;
    }
  }

  // Спинка: длина по центру спинки, ширина спинки, глубина горловины спинки,
  // рукав от центра спинки — ломаная через плечевую точку.
  switch (code) {
    case 'T02':
      return [
        [0, backDrop],
        [0, backDrop + (v('T02') ?? length - backDrop)],
      ];
    case 'T08':
      return [
        [-half('T08'), armhole * 0.55],
        [half('T08'), armhole * 0.55],
      ];
    case 'T16':
      return [
        [0, 0],
        [0, backDrop],
      ];
    case 'T11': {
      const a = sleeveAxis();
      if (!a) return null;
      return [[0, backDrop], shoulder, a.end];
    }
    case 'O02': {
      const h = v('O02');
      if (!h) return null;
      return [
        [0, -h],
        [0, 0],
      ];
    }
    case 'H01': {
      const h = v('H01');
      if (!h) return null;
      const top = (g.box.y0 - g.hpsY) / g.pxPerCm;
      return [
        [neckW / 2 + 1, top],
        [neckW / 2 + 1, backDrop],
      ];
    }
    case 'H02': {
      const w = v('H02');
      if (!w) return null;
      const top = (g.box.y0 - g.hpsY) / g.pxPerCm;
      const y = top + (v('H01') ?? 34) * 0.3;
      return [
        [-w / 2, y],
        [w / 2, y],
      ];
    }
    default:
      return null;
  }
}

/** Доли габарита → пиксели картинки. */
export function fromDrawing(pts: readonly { u: number; v: number }[], box: GarmentBox): PomPoint[] {
  return pts.map((p) => ({
    x: box.x0 + p.u * (box.x1 - box.x0),
    y: box.y0 + p.v * (box.y1 - box.y0),
  }));
}

/** Пиксели картинки → доли габарита: так место переживает перерисовку листа. */
export function toDrawing(pts: readonly PomPoint[], box: GarmentBox): { u: number; v: number }[] {
  const w = box.x1 - box.x0 || 1;
  const h = box.y1 - box.y0 || 1;
  return pts.map((p) => ({
    u: Math.round(((p.x - box.x0) / w) * 10000) / 10000,
    v: Math.round(((p.y - box.y0) / h) * 10000) / 10000,
  }));
}

/**
 * Линии точек табеля на виде: заданные человеком — по сохранённым долям,
 * остальные — по типовым местам. Точки без типового места и без своего —
 * не рисуются (их можно поставить вручную).
 */
export function pomLines(spec: StyleSpec, g: PlacementGeometry, view: PomView): PomLine[] {
  const out: PomLine[] = [];
  for (const p of spec.measurements.points) {
    const own: PomDrawing | undefined = p.drawing;
    if (own) {
      if (own.view !== view) continue;
      out.push({
        code: p.code,
        view,
        pts: fromDrawing(own.pts, g.box),
        custom: true,
        confirmed: !!own.confirmed_at,
        value: p.base.value,
        name_ru: p.name_ru,
      });
      continue;
    }
    const cm = typicalCm(spec, p.code, view, g);
    if (!cm) continue;
    out.push({
      code: p.code,
      view,
      pts: cm.map(([x, y]) => ({ x: g.cfX + x * g.pxPerCm, y: g.hpsY + y * g.pxPerCm })),
      custom: false,
      confirmed: false,
      value: p.base.value,
      name_ru: p.name_ru,
    });
  }
  return out;
}

/** Коды точек, у которых есть типовое место на этом виде. */
export function pomCodesWithPlace(spec: StyleSpec, g: PlacementGeometry, view: PomView): string[] {
  return spec.measurements.points
    .filter((p) => (p.drawing ? p.drawing.view === view : typicalCm(spec, p.code, view, g)))
    .map((p) => p.code);
}

/**
 * Сетка в сантиметрах: линии через середину переда и высшую точку плеча,
 * шаг 5 см, если клетка на картинке не мельче 26 px, иначе 10 см.
 */
export function pomGrid(g: PlacementGeometry, image: { w: number; h: number }): PomGrid {
  const stepCm = g.pxPerCm * 5 >= 26 ? 5 : 10;
  const step = stepCm * g.pxPerCm;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let x = g.cfX; x >= 0; x -= step) xs.unshift(x);
  for (let x = g.cfX + step; x <= image.w; x += step) xs.push(x);
  for (let y = g.hpsY; y >= 0; y -= step) ys.unshift(y);
  for (let y = g.hpsY + step; y <= image.h; y += step) ys.push(y);
  return { stepCm, xs, ys };
}

export interface PomDrawingOptions {
  /** Код выделенной точки — линия толще, подпись залита. */
  active?: string | null;
  grid?: boolean;
  /** Подписи кодов — можно снять для мелкой печати. */
  labels?: boolean;
  /** Только содержимое без обёртки <svg>: для сборки поверх трассировки. */
  inner?: boolean;
}

const INK = '#0E0E0E';
const GRID = '#D9D6D0';
const MUTED = '#6B6B67';

const fmt = (n: number): string => (Math.round(n * 100) / 100).toString();

/**
 * Слой чертежа замеров поверх картинки вида: сетка, размерные линии со
 * стрелками, подписи кодов. viewBox = картинка, так что слой ложится на
 * неё точно при любой ширине.
 */
export function pomDrawingSvg(
  lines: readonly PomLine[],
  grid: PomGrid | null,
  image: { w: number; h: number },
  options: PomDrawingOptions = {},
): string {
  const parts: string[] = [];
  if (grid && options.grid !== false) {
    const g = grid.xs
      .map((x) => `<line x1="${fmt(x)}" y1="0" x2="${fmt(x)}" y2="${image.h}"/>`)
      .concat(grid.ys.map((y) => `<line x1="0" y1="${fmt(y)}" x2="${image.w}" y2="${fmt(y)}"/>`))
      .join('');
    parts.push(`<g data-grid="${grid.stepCm}" stroke="${GRID}" stroke-width="1">${g}</g>`);
    const s = Math.max(8, Math.min(13, image.w / 48));
    parts.push(
      `<text x="${fmt(image.w - 6)}" y="${fmt(image.h - 6)}" text-anchor="end" ` +
        `font-family="Manrope,Sora,sans-serif" font-size="${fmt(s)}" fill="${MUTED}">сетка ${grid.stepCm} см</text>`,
    );
  }
  const fs = Math.max(9, Math.min(14, image.w / 44));
  for (const line of lines) {
    const active = options.active === line.code;
    const sw = active ? 2.2 : 1.2;
    const d = line.pts.map((p, i) => `${i ? 'L' : 'M'}${fmt(p.x)} ${fmt(p.y)}`).join(' ');
    const a = line.pts[0]!;
    const b = line.pts[line.pts.length - 1]!;
    const first = line.pts[1]!;
    const prev = line.pts[line.pts.length - 2]!;
    parts.push(
      `<g data-pom="${line.code}" data-custom="${line.custom ? 1 : 0}" ` +
        `data-confirmed="${line.confirmed ? 1 : 0}" fill="none" stroke="${INK}" stroke-width="${sw}" ` +
        `stroke-linecap="round" stroke-linejoin="round">` +
        `<path d="${d}"/>` +
        arrow(a, first, fs * 0.55) +
        arrow(b, prev, fs * 0.55) +
        `</g>`,
    );
    if (options.labels !== false) {
      // Подпись — у середины линии, чуть в сторону, чтобы не ложиться на неё.
      const mid = line.pts[Math.floor((line.pts.length - 1) / 2)]!;
      const nxt = line.pts[Math.floor((line.pts.length - 1) / 2) + 1]!;
      const mx = (mid.x + nxt.x) / 2;
      const my = (mid.y + nxt.y) / 2;
      const dx = nxt.x - mid.x;
      const dy = nxt.y - mid.y;
      const len = Math.hypot(dx, dy) || 1;
      const off = fs * 0.9;
      const lx = mx + (dy / len) * off;
      const ly = my - (dx / len) * off;
      const w = fs * 0.62 * line.code.length + fs * 0.7;
      const h = fs * 1.3;
      const fill = active || line.confirmed ? INK : '#fff';
      const color = active || line.confirmed ? '#fff' : INK;
      parts.push(
        `<g data-pom-label="${line.code}" style="cursor:pointer">` +
          `<rect x="${fmt(lx - w / 2)}" y="${fmt(ly - h / 2)}" width="${fmt(w)}" height="${fmt(h)}" rx="${fmt(h / 4)}" ` +
          `fill="${fill}" stroke="${INK}" stroke-width="1"/>` +
          `<text x="${fmt(lx)}" y="${fmt(ly + fs * 0.36)}" text-anchor="middle" ` +
          `font-family="JetBrains Mono,Menlo,monospace" font-size="${fmt(fs)}" font-weight="600" fill="${color}">${line.code}</text>` +
          `</g>`,
      );
    }
  }
  const body = parts.join('');
  if (options.inner) return body;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${image.w} ${image.h}" ` +
    `style="position:absolute;inset:0;width:100%;height:100%" data-pom-drawing="1">${body}</svg>`
  );
}

/** Стрелка размерной линии: остриё в точке tip, хвост в сторону from. */
function arrow(tip: PomPoint, from: PomPoint, size: number): string {
  const dx = from.x - tip.x;
  const dy = from.y - tip.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const bx = tip.x + ux * size;
  const by = tip.y + uy * size;
  const wing = size * 0.42;
  return (
    `<path d="M${fmt(bx + px * wing)} ${fmt(by + py * wing)} L${fmt(tip.x)} ${fmt(tip.y)} ` +
    `L${fmt(bx - px * wing)} ${fmt(by - py * wing)}"/>`
  );
}

/**
 * Полный SVG чертежа замеров: рисунок вида (трассировка или растр data-URI)
 * и слой линий одним файлом — на выгрузку и в документ.
 */
export function pomDrawingDocument(
  picture: { svgInner?: string; dataUri?: string },
  lines: readonly PomLine[],
  grid: PomGrid | null,
  image: { w: number; h: number },
  options: Omit<PomDrawingOptions, 'inner'> = {},
): string {
  const pic = picture.svgInner
    ? `<g data-picture="trace">${picture.svgInner}</g>`
    : picture.dataUri
      ? `<image href="${picture.dataUri}" x="0" y="0" width="${image.w}" height="${image.h}"/>`
      : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${image.w} ${image.h}" ` +
    `width="${image.w}" height="${image.h}" data-pom-drawing="1">` +
    `<title>Чертёж замеров</title><rect width="${image.w}" height="${image.h}" fill="#fff"/>` +
    pic +
    pomDrawingSvg(lines, grid, image, { ...options, inner: true }) +
    `</svg>`
  );
}
