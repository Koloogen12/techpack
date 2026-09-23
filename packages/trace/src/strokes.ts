import Jimp from 'jimp';

/**
 * Трассировка по осевым линиям: штрихи, а не заливка.
 *
 * Potrace обводит пятна краски контуром и заливает — для просмотра этого
 * достаточно, для правки нет: в Illustrator каждая линия оказывается узким
 * замкнутым многоугольником, толщину не поменять, точку не подвинуть.
 * Здесь растр утончается до скелета (Zhang–Suen), скелет режется на ветви,
 * ветви упрощаются (Дуглас–Пекер) и выходят кривыми со штрихом. Толщина
 * исходной линии меряется по расстоянию до фона и делит штрихи на слои:
 * контур, внутренние линии, пунктир строчек, штриховка полотна.
 *
 * Никакой модели: один растр — один и тот же SVG, байт в байт.
 */
export interface StrokePolyline {
  pts: { x: number; y: number }[];
  /** Средняя толщина исходной линии, px. */
  width: number;
  length: number;
  closed: boolean;
}

export type StrokeLayer = 'outline' | 'inner' | 'stitch' | 'hatch';

export interface StrokesResult {
  svg: string;
  layers: Record<StrokeLayer, number>;
  width: number;
  height: number;
}

export interface StrokesOptions {
  /** Порог яркости: ниже — краска. По умолчанию — Оцу по гистограмме. */
  threshold?: number;
  /** Штрихи короче (px) отбрасываются как шум. */
  minLength?: number;
  /** Допуск упрощения, px. */
  tolerance?: number;
}

const INK = '#0E0E0E';

export async function traceStrokes(
  bytes: Buffer,
  options: StrokesOptions = {},
): Promise<StrokesResult> {
  const image = await Jimp.read(bytes);
  const w = image.bitmap.width;
  const h = image.bitmap.height;
  const luma = new Uint8Array(w * h);
  const data = image.bitmap.data;
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3]! / 255;
    const r = data[i * 4]! * a + 255 * (1 - a);
    const g = data[i * 4 + 1]! * a + 255 * (1 - a);
    const b = data[i * 4 + 2]! * a + 255 * (1 - a);
    luma[i] = (r * 299 + g * 587 + b * 114) / 1000;
  }
  // Линейный рисунок на белом: тонкие линии после JPEG — серые (150–200),
  // и порог Оцу их теряет. Краска — всё, что заметно темнее бумаги.
  const threshold = options.threshold ?? Math.max(otsu(luma), 200);
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = luma[i]! < threshold ? 1 : 0;

  const dist = distanceToBackground(ink, w, h, 12);
  const skeleton = thin(ink, w, h);
  const polylines = tracePolylines(skeleton, dist, w, h);
  const minLength = options.minLength ?? Math.max(3, w / 400);
  const tolerance = options.tolerance ?? Math.max(0.6, w / 2000);
  const bridged = bridgeGaps(polylines, Math.max(3, w / 180));
  const kept = bridged
    .filter((p) => p.length >= minLength)
    .map((p) => ({ ...p, pts: simplify(p.pts, tolerance) }));

  const { layers, counts } = classify(kept, w);
  const scale = w / 1000;
  const style: Record<StrokeLayer, string> = {
    outline: `stroke-width="${fmt(1.8 * scale)}"`,
    inner: `stroke-width="${fmt(1.0 * scale)}"`,
    stitch: `stroke-width="${fmt(0.8 * scale)}" stroke-dasharray="${fmt(4 * scale)} ${fmt(3 * scale)}"`,
    hatch: `stroke-width="${fmt(0.45 * scale)}" opacity="0.35"`,
  };
  const groups = (Object.keys(layers) as StrokeLayer[])
    .filter((k) => layers[k].length)
    .map(
      (k) =>
        `<g id="${k}" data-layer="${k}" fill="none" stroke="${INK}" stroke-linecap="round" stroke-linejoin="round" ${style[k]}>` +
        layers[k].map((p) => `<path d="${pathOf(p)}"/>`).join('') +
        `</g>`,
    )
    .join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%" ` +
    `preserveAspectRatio="xMidYMid meet" data-trace="strokes">` +
    `<title>Технический эскиз, трассировка по осевым линиям</title>${groups}</svg>`;
  return { svg, layers: counts, width: w, height: h };
}

/** Порог Оцу по гистограмме яркости. */
export function otsu(luma: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of luma) hist[v]!++;
  const total = luma.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i]!;
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  // Линейный рисунок: краски мало, фон белый. Оцу тянется к серому фону
  // штриховки; ниже 90 и выше 200 порог не нужен никому.
  return Math.min(200, Math.max(90, threshold));
}

/** Расстояние до фона для пикселей краски, ограниченное радиусом. */
function distanceToBackground(ink: Uint8Array, w: number, h: number, radius: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!ink[i]) continue;
      let best = radius;
      for (let r = 1; r <= radius && r < best; r++) {
        // Кольцо радиуса r: достаточно проверить квадрат периметра.
        let found = false;
        for (let dx = -r; dx <= r && !found; dx++) {
          for (const dy of [-r, r]) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h || !ink[yy * w + xx]) found = true;
            if (found) break;
          }
        }
        for (let dy = -r + 1; dy <= r - 1 && !found; dy++) {
          for (const dx of [-r, r]) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h || !ink[yy * w + xx]) found = true;
            if (found) break;
          }
        }
        if (found) best = r;
      }
      out[i] = best;
    }
  }
  return out;
}

/** Утончение Zhang–Suen до однопиксельного скелета. */
export function thin(ink: Uint8Array, w: number, h: number): Uint8Array {
  const a = new Uint8Array(ink);
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= w || y >= h ? 0 : a[y * w + x]!;
  let changed = true;
  const toClear: number[] = [];
  let iterations = 0;
  while (changed && iterations < 60) {
    changed = false;
    iterations++;
    for (let step = 0; step < 2; step++) {
      toClear.length = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (!a[y * w + x]) continue;
          const p2 = at(x, y - 1);
          const p3 = at(x + 1, y - 1);
          const p4 = at(x + 1, y);
          const p5 = at(x + 1, y + 1);
          const p6 = at(x, y + 1);
          const p7 = at(x - 1, y + 1);
          const p8 = at(x - 1, y);
          const p9 = at(x - 1, y - 1);
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let transitions = 0;
          for (let k = 0; k < 8; k++) if (seq[k] === 0 && seq[k + 1] === 1) transitions++;
          if (transitions !== 1) continue;
          const c1 = step === 0 ? p2 * p4 * p6 : p2 * p4 * p8;
          const c2 = step === 0 ? p4 * p6 * p8 : p2 * p6 * p8;
          if (c1 !== 0 || c2 !== 0) continue;
          toClear.push(y * w + x);
        }
      }
      if (toClear.length) changed = true;
      for (const i of toClear) a[i] = 0;
    }
  }
  return a;
}

/** Ветви скелета: от концов и узлов по пикселям степени два; остаток — петли. */
function tracePolylines(
  skel: Uint8Array,
  dist: Float32Array,
  w: number,
  h: number,
): StrokePolyline[] {
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= w || y >= h ? 0 : skel[y * w + x]!;
  const N8: [number, number][] = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  const degree = (x: number, y: number): number => {
    let d = 0;
    for (const [dx, dy] of N8) d += at(x + dx, y + dy);
    return d;
  };
  const visited = new Uint8Array(w * h);
  const out: StrokePolyline[] = [];

  const walk = (sx: number, sy: number, fromJunction: boolean): void => {
    const pts: { x: number; y: number }[] = [{ x: sx, y: sy }];
    let widths = dist[sy * w + sx]! * 2;
    let x = sx;
    let y = sy;
    if (!fromJunction) visited[sy * w + sx] = 1;
    let px = -1;
    let py = -1;
    for (let guard = 0; guard < w * h; guard++) {
      let nx = -1;
      let ny = -1;
      // Сначала прямые соседи, потом диагональные: скелет 8-связный, и
      // диагональ через прямого соседа — тот же путь.
      for (const [dx, dy] of N8) {
        const xx = x + dx;
        const yy = y + dy;
        if (!at(xx, yy) || visited[yy * w + xx] || (xx === px && yy === py)) continue;
        if (nx < 0) {
          nx = xx;
          ny = yy;
        }
      }
      if (nx < 0) break;
      const d = degree(nx, ny);
      px = x;
      py = y;
      x = nx;
      y = ny;
      pts.push({ x, y });
      widths += dist[y * w + x]! * 2;
      if (d >= 3) break; // узел — ветвь кончилась, узел общий для ветвей
      visited[y * w + x] = 1;
      if (d <= 1) break;
    }
    if (pts.length < 2) return;
    let length = 0;
    for (let i = 1; i < pts.length; i++)
      length += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    out.push({ pts, width: widths / pts.length, length, closed: false });
  };

  // Концы (степень 1) и узлы (степень ≥ 3) — старты ветвей.
  const starts: { x: number; y: number; junction: boolean }[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!skel[y * w + x]) continue;
      const d = degree(x, y);
      if (d === 1) starts.push({ x, y, junction: false });
      else if (d >= 3) starts.push({ x, y, junction: true });
    }
  for (const s of starts.filter((s) => !s.junction))
    if (!visited[s.y * w + s.x]) walk(s.x, s.y, false);
  for (const s of starts.filter((s) => s.junction)) {
    // Из узла — по каждому ещё не пройденному соседу.
    for (const [dx, dy] of N8) {
      const xx = s.x + dx;
      const yy = s.y + dy;
      if (at(xx, yy) && !visited[yy * w + xx] && degree(xx, yy) <= 2) {
        visited[yy * w + xx] = 1;
        const branch = walkFrom(s.x, s.y, xx, yy);
        if (branch) out.push(branch);
      }
    }
  }
  // Остались замкнутые петли без концов и узлов.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (skel[y * w + x] && !visited[y * w + x]) {
        visited[y * w + x] = 1;
        const loop = walkFrom(x, y, x, y);
        if (loop) out.push({ ...loop, closed: true });
      }
    }
  return out;

  function walkFrom(jx: number, jy: number, x0: number, y0: number): StrokePolyline | null {
    const pts: { x: number; y: number }[] = [{ x: jx, y: jy }];
    if (x0 !== jx || y0 !== jy) pts.push({ x: x0, y: y0 });
    let widths = dist[jy * w + jx]! * 2 + dist[y0 * w + x0]! * 2;
    let x = x0;
    let y = y0;
    let px = jx;
    let py = jy;
    for (let guard = 0; guard < w * h; guard++) {
      let nx = -1;
      let ny = -1;
      for (const [dx, dy] of N8) {
        const xx = x + dx;
        const yy = y + dy;
        if (!at(xx, yy) || (xx === px && yy === py)) continue;
        if (visited[yy * w + xx] && degree(xx, yy) < 3) continue;
        nx = xx;
        ny = yy;
        break;
      }
      if (nx < 0) break;
      px = x;
      py = y;
      x = nx;
      y = ny;
      pts.push({ x, y });
      widths += dist[y * w + x]! * 2;
      if (degree(x, y) >= 3) break;
      if (visited[y * w + x]) break;
      visited[y * w + x] = 1;
      if (degree(x, y) <= 1) break;
    }
    if (pts.length < 2) return null;
    let length = 0;
    for (let i = 1; i < pts.length; i++)
      length += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    return { pts, width: widths / pts.length, length, closed: false };
  }
}

/**
 * Сшивка разрывов: концы двух ветвей ближе gap px и направления согласны —
 * это одна линия, порванная сжатием или сглаживанием растра.
 */
function bridgeGaps(lines: StrokePolyline[], gap: number): StrokePolyline[] {
  const items = lines.map((l) => ({ ...l, pts: [...l.pts] }));
  const heading = (pts: { x: number; y: number }[], atEnd: boolean) => {
    const n = pts.length;
    const a = atEnd ? pts[Math.max(0, n - 4)]! : pts[Math.min(n - 1, 3)]!;
    const b = atEnd ? pts[n - 1]! : pts[0]!;
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  let merged = true;
  let rounds = 0;
  while (merged && rounds < 6) {
    merged = false;
    rounds++;
    outer: for (let i = 0; i < items.length; i++) {
      const a = items[i]!;
      if (a.closed || a.pts.length < 2) continue;
      for (let j = 0; j < items.length; j++) {
        if (i === j) continue;
        const b = items[j]!;
        if (b.closed || b.pts.length < 2) continue;
        // Четыре сочетания концов: конец a → начало b, конец a → конец b, …
        const combos: [boolean, boolean][] = [
          [true, false],
          [true, true],
          [false, false],
          [false, true],
        ];
        for (const [aEnd, bEnd] of combos) {
          const pa = aEnd ? a.pts[a.pts.length - 1]! : a.pts[0]!;
          const pb = bEnd ? b.pts[b.pts.length - 1]! : b.pts[0]!;
          const d = Math.hypot(pb.x - pa.x, pb.y - pa.y);
          if (d > gap) continue;
          // Направление выхода из a должно смотреть в сторону pb, и вход в b
          // — продолжать его: иначе сшиваются соседние параллельные штрихи.
          const ha = heading(a.pts, aEnd) + (aEnd ? 0 : Math.PI);
          const toB = Math.atan2(pb.y - pa.y, pb.x - pa.x);
          const hb = heading(b.pts, bEnd) + (bEnd ? Math.PI : 0);
          const turn = (x: number, y: number) => {
            let t = Math.abs(x - y) % (Math.PI * 2);
            if (t > Math.PI) t = Math.PI * 2 - t;
            return t;
          };
          if (d > 1.5 && turn(ha, toB) > 0.6) continue;
          if (turn(ha, hb) > 0.8) continue;
          const first = aEnd ? a.pts : [...a.pts].reverse();
          const second = bEnd ? [...b.pts].reverse() : b.pts;
          const pts = [...first, ...second];
          const length = a.length + b.length + d;
          const width =
            (a.width * a.pts.length + b.width * b.pts.length) / (a.pts.length + b.pts.length);
          items[i] = { pts, length, width, closed: false };
          items.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return items;
}

/** Дуглас–Пекер. */
export function simplify(
  pts: { x: number; y: number }[],
  tolerance: number,
): { x: number; y: number }[] {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = pts[a]!;
    const B = pts[b]!;
    let maxD = 0;
    let idx = -1;
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const P = pts[i]!;
      const d = Math.abs(dy * P.x - dx * P.y + B.x * A.y - B.y * A.x) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * Слои по толщине и характеру: контур — самые толстые линии, внутренние —
 * средние, пунктир — цепочки коротких коллинеарных штрихов, штриховка —
 * пучки тонких параллельных линий с малым шагом.
 */
function classify(
  lines: StrokePolyline[],
  w: number,
): { layers: Record<StrokeLayer, StrokePolyline[]>; counts: Record<StrokeLayer, number> } {
  const layers: Record<StrokeLayer, StrokePolyline[]> = {
    outline: [],
    inner: [],
    stitch: [],
    hatch: [],
  };
  if (!lines.length) return { layers, counts: { outline: 0, inner: 0, stitch: 0, hatch: 0 } };
  const shortLen = w / 60;
  const allWidths = lines.map((l) => l.width).sort((a, b) => a - b);
  const medianAll = allWidths[Math.floor(allWidths.length / 2)]!;

  // Штриховка: тонкие, почти вертикальные или горизонтальные, длиннее
  // пунктира, с соседями на расстоянии до 1% ширины листа.
  const dir = (l: StrokePolyline) => {
    const a = l.pts[0]!;
    const b = l.pts[l.pts.length - 1]!;
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  const mid = (l: StrokePolyline) => {
    const a = l.pts[0]!;
    const b = l.pts[l.pts.length - 1]!;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  const isThin = (l: StrokePolyline) => l.width <= medianAll * 1.1 + 0.2;
  const nearParallel = (a: number, b: number) => {
    let d = Math.abs(a - b) % Math.PI;
    if (d > Math.PI / 2) d = Math.PI - d;
    return d < 0.12;
  };
  const hatchStep = w / 55;
  const candidates = lines.map((l, i) => ({ l, i, d: dir(l), m: mid(l), thin: isThin(l) }));
  const hatchIdx = new Set<number>();
  for (const c of candidates) {
    if (!c.thin || c.l.length < shortLen * 0.5) continue;
    let neighbours = 0;
    for (const o of candidates) {
      if (o.i === c.i || !o.thin) continue;
      if (!nearParallel(c.d, o.d)) continue;
      const dx = o.m.x - c.m.x;
      const dy = o.m.y - c.m.y;
      // Расстояние поперёк направления.
      const across = Math.abs(dx * Math.sin(c.d) - dy * Math.cos(c.d));
      const along = Math.abs(dx * Math.cos(c.d) + dy * Math.sin(c.d));
      if (across <= hatchStep && along <= Math.max(c.l.length, o.l.length)) neighbours++;
      if (neighbours >= 2) break;
    }
    if (neighbours >= 2) hatchIdx.add(c.i);
  }
  // Толщина контура — по линиям, которые не штриховка: на рисунке с рубчиком
  // штриховки в десять раз больше, чем швов, и медиана по всем — её толщина.
  const rest = lines
    .filter((_, i) => !hatchIdx.has(i))
    .map((l) => l.width)
    .sort((a, b) => a - b);
  const median = rest.length ? rest[Math.floor(rest.length / 2)]! : medianAll;
  const thick = Math.max(median * 1.35, median + 0.8);

  // Пунктир: короткие штрихи с коллинеарным соседом на расстоянии до
  // трёх своих длин — сшиваются в одну ломаную со штриховым узором.
  const stitchIdx = new Set<number>();
  const shortOnes = candidates.filter(
    (c) => !hatchIdx.has(c.i) && c.l.length <= shortLen && !c.l.closed,
  );
  const used = new Set<number>();
  const chains: StrokePolyline[] = [];
  for (const c of shortOnes) {
    if (used.has(c.i)) continue;
    const chain = [c];
    used.add(c.i);
    let grown = true;
    while (grown) {
      grown = false;
      const last = chain[chain.length - 1]!;
      const lastEnd = last.l.pts[last.l.pts.length - 1]!;
      for (const o of shortOnes) {
        if (used.has(o.i) || !nearParallel(last.d, o.d)) continue;
        const start = o.l.pts[0]!;
        const gap = Math.hypot(start.x - lastEnd.x, start.y - lastEnd.y);
        const across = Math.abs(
          (start.x - lastEnd.x) * Math.sin(last.d) - (start.y - lastEnd.y) * Math.cos(last.d),
        );
        if (gap <= Math.max(last.l.length, o.l.length) * 3 && across <= hatchStep * 0.4) {
          chain.push(o);
          used.add(o.i);
          grown = true;
          break;
        }
      }
    }
    if (chain.length >= 3) {
      for (const x of chain) stitchIdx.add(x.i);
      const pts = [
        chain[0]!.l.pts[0]!,
        chain[chain.length - 1]!.l.pts[chain[chain.length - 1]!.l.pts.length - 1]!,
      ];
      const length = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
      chains.push({ pts, width: chain[0]!.l.width, length, closed: false });
    }
  }
  layers.stitch = chains;

  lines.forEach((l, i) => {
    if (stitchIdx.has(i)) return;
    if (hatchIdx.has(i)) layers.hatch.push(l);
    else if (l.width >= thick && l.length > shortLen) layers.outline.push(l);
    else layers.inner.push(l);
  });
  return {
    layers,
    counts: {
      outline: layers.outline.length,
      inner: layers.inner.length,
      stitch: layers.stitch.length,
      hatch: layers.hatch.length,
    },
  };
}

/** Ломаная → гладкий путь кубическими Безье (Catmull–Rom), короткая — отрезками. */
function pathOf(l: StrokePolyline): string {
  const p = l.pts;
  if (p.length < 3)
    return `M${fmt(p[0]!.x)} ${fmt(p[0]!.y)} L${fmt(p[p.length - 1]!.x)} ${fmt(p[p.length - 1]!.y)}`;
  let d = `M${fmt(p[0]!.x)} ${fmt(p[0]!.y)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i]!;
    const p1 = p[i]!;
    const p2 = p[i + 1]!;
    const p3 = p[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${fmt(c1x)} ${fmt(c1y)}, ${fmt(c2x)} ${fmt(c2y)}, ${fmt(p2.x)} ${fmt(p2.y)}`;
  }
  return l.closed ? `${d} Z` : d;
}

const fmt = (n: number): string => (Math.round(n * 100) / 100).toString();
