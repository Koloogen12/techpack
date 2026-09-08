/**
 * Слой правок поверх технического эскиза.
 *
 * Эскиз рисует модель, и ошибиться она может в узле. Правки человека живут
 * ОТДЕЛЬНЫМ слоем: векторные штрихи в долях листа, рисуются SVG поверх растра
 * — в кабинете, в документе и в вырезках видов одинаково. Ничего не
 * запекается: исходный эскиз не трогается, любую правку можно снять через год.
 * Референс запекает правки в растр и после сохранения не даёт их трогать;
 * его ластик закрашивает исходник. Здесь ластик — такой же штрих слоя,
 * только белый.
 *
 * Пресеты — типы строчек из справочника стежков (ГОСТ 12807 = ISO 4915):
 * на чертеже они читаются условными линиями, и технолог по ним узнаёт
 * операцию, а не «пунктир ради красоты».
 */

export type EditPreset =
  'seam' | 'lockstitch' | 'twin' | 'zigzag' | 'coverstitch' | 'overlock' | 'flatlock';

export type EditKind = 'line' | 'erase';

/** Точка в долях листа (0..1). cx/cy — контрольная точка сегмента, ВХОДЯЩЕГО в неё. */
export interface EditPoint {
  x: number;
  y: number;
  cx?: number;
  cy?: number;
}

export interface EditStroke {
  id: string;
  kind: EditKind;
  preset: EditPreset;
  /** Толщина в пикселях листа. */
  width: number;
  points: EditPoint[];
}

export interface SketchEdits {
  version: 1;
  sheet: { w: number; h: number };
  strokes: EditStroke[];
  saved_at?: string;
}

/** Границы вида в долях листа — те же, что режут эскиз на виды. */
export interface EditBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface EditPresetInfo {
  id: EditPreset;
  label_ru: string;
  /** Код стежка по ГОСТ 12807 / ISO 4915; у контурной линии кода нет. */
  code: string;
  hint_ru: string;
}

export const EDIT_PRESETS: readonly EditPresetInfo[] = [
  { id: 'seam', label_ru: 'Шов · сплошная', code: '', hint_ru: 'Контур детали или шов стачивания' },
  {
    id: 'lockstitch',
    label_ru: 'Отстрочка · 301',
    code: '301',
    hint_ru: 'Однострочная отстрочка: пунктир вдоль края',
  },
  {
    id: 'twin',
    label_ru: 'Двухигольная · 301×2',
    code: '301',
    hint_ru: 'Две параллельные отстрочки одной машиной',
  },
  { id: 'zigzag', label_ru: 'Зигзаг · 304', code: '304', hint_ru: 'Зигзагообразная строчка' },
  {
    id: 'coverstitch',
    label_ru: 'Распошив · 406',
    code: '406',
    hint_ru: 'Плоский шов подгибки: две строчки сверху, петельная снизу',
  },
  {
    id: 'overlock',
    label_ru: 'Оверлок · 504',
    code: '504',
    hint_ru: 'Краеобмёточная строчка по срезу',
  },
  {
    id: 'flatlock',
    label_ru: 'Плоский шов · 607',
    code: '607',
    hint_ru: 'Плоский декоративный шов встык',
  },
];

export const EDIT_MAX_STROKES = 500;
export const EDIT_MAX_POINTS = 400;
export const EDIT_MIN_WIDTH = 1;
export const EDIT_MAX_WIDTH = 40;

const INK = '#0E0E0E';
const PAPER = '#FFFFFF';

export function emptyEdits(sheet: { w: number; h: number }): SketchEdits {
  return { version: 1, sheet: { w: sheet.w, h: sheet.h }, strokes: [] };
}

/**
 * Разбор внешнего JSON в слой правок. Отказ — словами: файл приходит из
 * кабинета, и «invalid input» человеку ничего не скажет.
 */
export function parseSketchEdits(input: unknown): SketchEdits {
  const fail = (why: string): never => {
    throw new Error(`Слой правок не принят: ${why}.`);
  };
  if (!input || typeof input !== 'object') fail('это не объект');
  const o = input as Record<string, unknown>;
  if (o['version'] !== 1) fail('неизвестная версия формата');
  const sheet = o['sheet'] as Record<string, unknown> | undefined;
  const w = Number(sheet?.['w']);
  const h = Number(sheet?.['h']);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0 || w > 8000 || h > 8000)
    fail('размер листа должен быть целым числом пикселей до 8000');
  if (!Array.isArray(o['strokes'])) fail('нет списка штрихов');
  const strokes = o['strokes'] as unknown[];
  if (strokes.length > EDIT_MAX_STROKES) fail(`штрихов больше ${EDIT_MAX_STROKES}`);
  const presets = new Set<string>(EDIT_PRESETS.map((p) => p.id));
  const seen = new Set<string>();
  const parsed = strokes.map((raw, i): EditStroke => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const id = typeof s['id'] === 'string' ? s['id'] : '';
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) fail(`штрих ${i + 1}: неверный идентификатор`);
    if (seen.has(id)) fail(`штрих ${i + 1}: повтор идентификатора ${id}`);
    seen.add(id);
    const kind: EditKind | null =
      s['kind'] === 'line' ? 'line' : s['kind'] === 'erase' ? 'erase' : null;
    if (!kind) fail(`штрих ${id}: неизвестный род`);
    const preset = typeof s['preset'] === 'string' && presets.has(s['preset']) ? s['preset'] : null;
    if (!preset) fail(`штрих ${id}: неизвестный тип строчки`);
    const width = Number(s['width']);
    if (!Number.isFinite(width) || width < EDIT_MIN_WIDTH || width > EDIT_MAX_WIDTH)
      fail(`штрих ${id}: толщина вне ${EDIT_MIN_WIDTH}–${EDIT_MAX_WIDTH} px`);
    if (!Array.isArray(s['points']) || s['points'].length < 1) fail(`штрих ${id}: нет точек`);
    const pts = s['points'] as unknown[];
    if (pts.length > EDIT_MAX_POINTS) fail(`штрих ${id}: точек больше ${EDIT_MAX_POINTS}`);
    const points = pts.map((raw2, j): EditPoint => {
      const p = (raw2 ?? {}) as Record<string, unknown>;
      const x = Number(p['x']);
      const y = Number(p['y']);
      const inside = (v: number): boolean => Number.isFinite(v) && v >= -0.2 && v <= 1.2;
      if (!inside(x) || !inside(y)) fail(`штрих ${id}, точка ${j + 1}: координата вне листа`);
      const out: EditPoint = { x: round4(x), y: round4(y) };
      if (p['cx'] !== undefined || p['cy'] !== undefined) {
        const cx = Number(p['cx']);
        const cy = Number(p['cy']);
        if (!inside(cx) || !inside(cy))
          fail(`штрих ${id}, точка ${j + 1}: контрольная точка вне листа`);
        out.cx = round4(cx);
        out.cy = round4(cy);
      }
      return out;
    });
    return {
      id,
      kind: kind as EditKind,
      preset: preset as EditPreset,
      width: Math.round(width * 10) / 10,
      points,
    };
  });
  const savedAt = typeof o['saved_at'] === 'string' ? o['saved_at'] : undefined;
  return {
    version: 1,
    sheet: { w, h },
    strokes: parsed,
    ...(savedAt ? { saved_at: savedAt } : {}),
  };
}

const round4 = (v: number): number => Math.round(v * 10000) / 10000;

// ------------------------------------------------------------------ геометрия

interface Px {
  x: number;
  y: number;
}

/** Ломаная штриха в пикселях листа: кривые сегменты выпрямлены в 16 шагов. */
export function flattenStroke(stroke: EditStroke, sheet: { w: number; h: number }): Px[] {
  const pts = stroke.points;
  if (pts.length === 0) return [];
  const toPx = (p: { x: number; y: number }): Px => ({ x: p.x * sheet.w, y: p.y * sheet.h });
  const out: Px[] = [toPx(pts[0]!)];
  for (let i = 1; i < pts.length; i++) {
    const a = toPx(pts[i - 1]!);
    const b = toPx(pts[i]!);
    const p = pts[i]!;
    if (p.cx !== undefined && p.cy !== undefined) {
      const c = toPx({ x: p.cx, y: p.cy });
      for (let k = 1; k <= 16; k++) {
        const t = k / 16;
        const u = 1 - t;
        out.push({
          x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
          y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
        });
      }
    } else {
      out.push(b);
    }
  }
  return out;
}

/** Путь SVG с настоящими кривыми — для сплошных и пунктирных линий. */
function pathD(stroke: EditStroke, sheet: { w: number; h: number }): string {
  const pts = stroke.points;
  if (pts.length === 0) return '';
  const f = (v: number): string => String(Math.round(v * 100) / 100);
  let d = `M${f(pts[0]!.x * sheet.w)} ${f(pts[0]!.y * sheet.h)}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    if (p.cx !== undefined && p.cy !== undefined)
      d += `Q${f(p.cx * sheet.w)} ${f(p.cy * sheet.h)} ${f(p.x * sheet.w)} ${f(p.y * sheet.h)}`;
    else d += `L${f(p.x * sheet.w)} ${f(p.y * sheet.h)}`;
  }
  return d;
}

function polyD(pts: readonly Px[]): string {
  const f = (v: number): string => String(Math.round(v * 100) / 100);
  return pts.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join('');
}

/** Ломаная, сдвинутая по нормали на d (плюс — вправо от направления). */
function offsetPolyline(pts: readonly Px[], d: number): Px[] {
  if (pts.length < 2) return pts.map((p) => ({ ...p }));
  const normals: Px[] = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
  });
  return pts.map((p, i) => ({ x: p.x + normals[i]!.x * d, y: p.y + normals[i]!.y * d }));
}

/** Точки через равные шаги длины с касательной: по ним ложатся узоры строчек. */
function samplesAlong(pts: readonly Px[], step: number): { p: Px; t: Px }[] {
  const out: { p: Px; t: Px }[] = [];
  if (pts.length < 2 || step <= 0) return out;
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const t = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    let s = carry;
    while (s <= len) {
      out.push({ p: { x: a.x + t.x * s, y: a.y + t.y * s }, t });
      s += step;
    }
    carry = s - len;
  }
  return out;
}

function zigzag(pts: readonly Px[], amp: number, step: number, offset = 0): Px[] {
  return samplesAlong(pts, step).map(({ p, t }, i) => {
    const side = (i % 2 === 0 ? 1 : -1) * amp + offset;
    return { x: p.x - t.y * side, y: p.y + t.x * side };
  });
}

// ---------------------------------------------------------------------- SVG

const esc = (s: string): string => s.replace(/"/g, '&quot;');

/**
 * Разметка одного штриха. Ластик — белый штрих: он закрывает линии растра
 * под собой, но сам остаётся штрихом слоя и снимается как любой другой.
 */
export function strokeSvg(stroke: EditStroke, sheet: { w: number; h: number }): string {
  const w = stroke.width;
  const base = `fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  if (stroke.kind === 'erase')
    return `<path d="${pathD(stroke, sheet)}" ${base} stroke="${PAPER}" stroke-width="${w}"/>`;
  const line = (d: string, width: number, dash?: string): string =>
    `<path d="${d}" ${base} stroke="${INK}" stroke-width="${round2(width)}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  const dash = `${round2(3 * w)} ${round2(2 * w)}`;
  switch (stroke.preset) {
    case 'seam':
      return line(pathD(stroke, sheet), w);
    case 'lockstitch':
      return line(pathD(stroke, sheet), w, dash);
    case 'twin': {
      const flat = flattenStroke(stroke, sheet);
      return (
        line(polyD(offsetPolyline(flat, -0.9 * w)), 0.9 * w, dash) +
        line(polyD(offsetPolyline(flat, 0.9 * w)), 0.9 * w, dash)
      );
    }
    case 'zigzag':
      return line(polyD(zigzag(flattenStroke(stroke, sheet), 1.6 * w, 2.2 * w)), 0.8 * w);
    case 'coverstitch': {
      const flat = flattenStroke(stroke, sheet);
      return (
        line(polyD(offsetPolyline(flat, -1.4 * w)), 0.9 * w, dash) +
        line(polyD(offsetPolyline(flat, 1.4 * w)), 0.9 * w, dash) +
        line(polyD(flat), 0.6 * w)
      );
    }
    case 'overlock': {
      const flat = flattenStroke(stroke, sheet);
      return line(polyD(flat), w) + line(polyD(zigzag(flat, 1.2 * w, 2 * w, 1.8 * w)), 0.7 * w);
    }
    case 'flatlock': {
      const flat = flattenStroke(stroke, sheet);
      const rails =
        line(polyD(offsetPolyline(flat, -1.4 * w)), 0.9 * w) +
        line(polyD(offsetPolyline(flat, 1.4 * w)), 0.9 * w);
      const rungs = samplesAlong(flat, 2.4 * w)
        .map(({ p, t }) => {
          const a = { x: p.x - t.y * -1.4 * w, y: p.y + t.x * -1.4 * w };
          const b = { x: p.x - t.y * 1.4 * w, y: p.y + t.x * 1.4 * w };
          return polyD([a, b]);
        })
        .join('');
      return rails + (rungs ? line(rungs, 0.7 * w) : '');
    }
  }
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

export interface EditsSvgOptions {
  /** Вырезка: viewBox сужается до вида, и слой ложится на его картинку без пересчёта. */
  box?: EditBox;
  /** Дополнительные атрибуты корневого <svg> (класс, стиль). */
  attrs?: string;
}

/**
 * Весь слой одним SVG. viewBox в пикселях листа: тот же слой ложится и на
 * целый лист, и на любую вырезку — меняется только окно, не координаты.
 * Ластик рисуется первым: линии, проведённые поверх стёртого, остаются видны.
 */
export function editsToSvg(edits: SketchEdits, options: EditsSvgOptions = {}): string {
  const { w, h } = edits.sheet;
  const b = options.box ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
  const vb = [b.x0 * w, b.y0 * h, (b.x1 - b.x0) * w, (b.y1 - b.y0) * h]
    .map((v) => Math.round(v * 100) / 100)
    .join(' ');
  const erase = edits.strokes.filter((s) => s.kind === 'erase');
  const lines = edits.strokes.filter((s) => s.kind !== 'erase');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="100%" height="100%" ` +
    `preserveAspectRatio="xMidYMid meet" shape-rendering="geometricPrecision"${options.attrs ? ` ${esc(options.attrs)}` : ''}>` +
    [...erase, ...lines].map((s) => strokeSvg(s, edits.sheet)).join('') +
    `</svg>`
  );
}

/**
 * Слой как data-URI для CSS-фона поверх картинки листа.
 *
 * Без `;charset=…`: рантайм кабинета режет строку инлайн-стиля по точке с
 * запятой, и URI с ней обрывался на «svg+xml». encodeURIComponent точку с
 * запятой кодирует, так что внутри данных её не бывает.
 */
export function editsDataUri(edits: SketchEdits, options: EditsSvgOptions = {}): string {
  return `data:image/svg+xml,${encodeURIComponent(editsToSvg(edits, options))}`;
}

/** Образец пресета для галереи: короткий горизонтальный штрих в маленьком окне. */
export function presetSwatchSvg(preset: EditPreset, width = 56, height = 24): string {
  const sheet = { w: width, h: height };
  const stroke: EditStroke = {
    id: 'swatch',
    kind: 'line',
    preset,
    width: 2,
    points: [
      { x: 0.12, y: 0.5 },
      { x: 0.88, y: 0.5 },
    ],
  };
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    strokeSvg(stroke, sheet) +
    `</svg>`
  );
}
