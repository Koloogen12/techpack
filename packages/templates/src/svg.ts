/**
 * Разбор SVG ровно настолько, насколько нужно конвейеру библиотеки.
 *
 * Полноценный парсер здесь не нужен и вреден: файлы приходят из одного
 * экспортёра Illustrator, структура у них одинаковая, а тянуть зависимость
 * ради разбора атрибутов — это чужой код в цепочке, работающей с покупным
 * датасетом. А вот путь разбирается ПО-НАСТОЯЩЕМУ: Illustrator пишет
 * относительными командами, и наивный «взять все числа парами» превращает
 * смещение −8.6 в координату −8.6. Каждый путь тогда растягивается на весь
 * лист, и разделить перед и спинку становится нечем.
 */

export interface RawPath {
  /** Полное содержимое атрибута d. */
  d: string;
  /** Инлайн-стиль пути, как он записан в файле. */
  style: string;
  /** Габарит по опорным и контрольным точкам, в координатах viewBox файла. */
  box: Box;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Сколько чисел принимает команда пути. */
const ARITY: Record<string, number> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
};

const TOKENS = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi;

/**
 * Габарит пути.
 *
 * Считается по опорным И контрольным точкам кривых. Настоящий габарит кривой
 * Безье лежит внутри выпуклой оболочки этих точек, то есть оценка не меньше
 * истинной. Для того, ради чего она нужна — разделить виды по просвету и
 * обрезать поля — этого достаточно; точный расчёт потребовал бы решать
 * производную кубики на каждом сегменте ради долей процента.
 */
export function pathBox(d: string): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const see = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  // Токенизация: команды и числа вперемешку, как их пишет экспортёр.
  const tokens: (string | number)[] = [];
  for (const m of d.matchAll(TOKENS)) {
    tokens.push(m[1] ? m[1] : Number(m[2]));
  }

  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let command = '';
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];
    if (typeof token === 'string') {
      command = token;
      i++;
      if (command.toLowerCase() === 'z') {
        x = startX;
        y = startY;
      }
      continue;
    }
    if (!command) return null;

    const lower = command.toLowerCase();
    const relative = command === lower;
    const need = ARITY[lower] ?? 0;
    if (need === 0) {
      i++;
      continue;
    }
    const args = tokens.slice(i, i + need);
    if (args.length < need || args.some((a) => typeof a !== 'number')) break;
    const n = args as number[];
    i += need;

    switch (lower) {
      case 'm':
      case 'l':
      case 't': {
        x = relative ? x + n[0]! : n[0]!;
        y = relative ? y + n[1]! : n[1]!;
        see(x, y);
        if (lower === 'm') {
          startX = x;
          startY = y;
          // Повтор координат после moveto означает lineto — это правило
          // спецификации, и без него хвост подпути потерялся бы.
          command = relative ? 'l' : 'L';
        }
        break;
      }
      case 'h': {
        x = relative ? x + n[0]! : n[0]!;
        see(x, y);
        break;
      }
      case 'v': {
        y = relative ? y + n[0]! : n[0]!;
        see(x, y);
        break;
      }
      case 'c': {
        const x1 = relative ? x + n[0]! : n[0]!;
        const y1 = relative ? y + n[1]! : n[1]!;
        const x2 = relative ? x + n[2]! : n[2]!;
        const y2 = relative ? y + n[3]! : n[3]!;
        x = relative ? x + n[4]! : n[4]!;
        y = relative ? y + n[5]! : n[5]!;
        see(x1, y1);
        see(x2, y2);
        see(x, y);
        break;
      }
      case 's':
      case 'q': {
        const cx = relative ? x + n[0]! : n[0]!;
        const cy = relative ? y + n[1]! : n[1]!;
        x = relative ? x + n[2]! : n[2]!;
        y = relative ? y + n[3]! : n[3]!;
        see(cx, cy);
        see(x, y);
        break;
      }
      case 'a': {
        // У дуги координаты — только последние два числа; радиусы и флаги
        // координатами не являются, и принять их за точку значило бы
        // растянуть габарит к началу листа.
        x = relative ? x + n[5]! : n[5]!;
        y = relative ? y + n[6]! : n[6]!;
        see(x, y);
        break;
      }
      default:
        break;
    }
  }

  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Разбиение пути на подпути.
 *
 * Illustrator охотно кладёт в один <path> и перед, и спинку — одной командой
 * заливки на весь лист. Пока такой путь неделим, между видами нет просвета,
 * и разделить их нечем: половина датасета приезжала одним видом именно
 * поэтому. Каждый подпуть получает СВОЙ абсолютный moveto, поэтому дальше
 * его можно переносить и мерить независимо от соседей.
 */
export function splitSubpaths(d: string): string[] {
  const tokens: (string | number)[] = [];
  for (const m of d.matchAll(TOKENS)) tokens.push(m[1] ? m[1] : Number(m[2]));

  const out: string[] = [];
  let current: string[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let command = '';
  let i = 0;

  const flush = (): void => {
    if (current.length) out.push(current.join(' '));
    current = [];
  };

  while (i < tokens.length) {
    const token = tokens[i];
    if (typeof token === 'string') {
      command = token;
      i++;
      if (command.toLowerCase() === 'z') {
        current.push('Z');
        x = startX;
        y = startY;
      }
      continue;
    }
    if (!command) return [d];

    const lower = command.toLowerCase();
    const relative = command === lower;
    const need = ARITY[lower] ?? 0;
    if (need === 0) {
      i++;
      continue;
    }
    const args = tokens.slice(i, i + need);
    if (args.length < need || args.some((a) => typeof a !== 'number')) break;
    const n = args as number[];
    i += need;

    if (lower === 'm') {
      // Новый подпуть: закрываем предыдущий и открываем следующий
      // АБСОЛЮТНЫМ moveto — иначе он поедет вслед за соседом.
      flush();
      x = relative ? x + n[0]! : n[0]!;
      y = relative ? y + n[1]! : n[1]!;
      startX = x;
      startY = y;
      current.push(`M ${x} ${y}`);
      command = relative ? 'l' : 'L';
      continue;
    }

    current.push(command + ' ' + n.join(' '));
    switch (lower) {
      case 'h':
        x = relative ? x + n[0]! : n[0]!;
        break;
      case 'v':
        y = relative ? y + n[0]! : n[0]!;
        break;
      case 'c':
        x = relative ? x + n[4]! : n[4]!;
        y = relative ? y + n[5]! : n[5]!;
        break;
      case 's':
      case 'q':
        x = relative ? x + n[2]! : n[2]!;
        y = relative ? y + n[3]! : n[3]!;
        break;
      case 'a':
        x = relative ? x + n[5]! : n[5]!;
        y = relative ? y + n[6]! : n[6]!;
        break;
      default:
        x = relative ? x + n[0]! : n[0]!;
        y = relative ? y + n[1]! : n[1]!;
        break;
    }
  }
  flush();
  return out.length ? out : [d];
}

/**
 * Перевод примитива в путь.
 *
 * Illustrator пишет чертёж не одними путями: контур корпуса — путь, шов —
 * <line>, люверс — <circle>, а рибана нередко <polygon>. Читать только
 * <path> значит выбросить две трети рисунка: в датасете 42 тысячи путей
 * против 32 тысяч полигонов, 20 тысяч окружностей и 8 тысяч линий. Именно
 * из-за этого у половины силуэтов пропадали боковые швы и вся отстрочка.
 */
function shapeToPath(tag: string, attrs: string): string | null {
  const num = (name: string): number => Number(attr(attrs, name) ?? 'NaN');
  const points = (): number[] =>
    (attr(attrs, 'points') ?? '')
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => Number.isFinite(n));

  switch (tag) {
    case 'line': {
      const [x1, y1, x2, y2] = [num('x1'), num('y1'), num('x2'), num('y2')];
      if ([x1, y1, x2, y2].some((n) => !Number.isFinite(n))) return null;
      return `M ${x1} ${y1} L ${x2} ${y2}`;
    }
    case 'polyline':
    case 'polygon': {
      const p = points();
      if (p.length < 4) return null;
      const parts = [`M ${p[0]} ${p[1]}`];
      for (let i = 2; i + 1 < p.length; i += 2) parts.push(`L ${p[i]} ${p[i + 1]}`);
      if (tag === 'polygon') parts.push('Z');
      return parts.join(' ');
    }
    case 'rect': {
      const [x, y, w, h] = [num('x') || 0, num('y') || 0, num('width'), num('height')];
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
      return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
    }
    case 'circle':
    case 'ellipse': {
      const cx = num('cx') || 0;
      const cy = num('cy') || 0;
      const rx = tag === 'circle' ? num('r') : num('rx');
      const ry = tag === 'circle' ? num('r') : num('ry');
      if (!Number.isFinite(rx) || !Number.isFinite(ry) || rx <= 0 || ry <= 0) return null;
      // Две полудуги: одной командой дуги полный круг не описать —
      // начальная и конечная точки совпали бы, и дуга выродилась бы.
      return (
        `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} ` +
        `A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`
      );
    }
    default:
      return null;
  }
}

const attr = (attrs: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(attrs)?.[1];

/** Фигуры, которые встречаются в датасете. Порядок не важен: читаем все. */
const SHAPES = ['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse'] as const;

/**
 * Все фигуры файла с их стилями и габаритами, разложенные до подпутей.
 *
 * Дальше по конвейеру подпуть — единица работы: его можно отнести к переду
 * или к спинке, посчитать его габарит, выбросить как мусор. Слитый путь
 * такой возможности не даёт вовсе.
 */
export function readPaths(svg: string): RawPath[] {
  const out: RawPath[] = [];
  const re = new RegExp(`<(${SHAPES.join('|')})\\b([^>]*?)/?>`, 'gi');
  for (const m of svg.matchAll(re)) {
    const tag = (m[1] ?? '').toLowerCase();
    const attrs = m[2] ?? '';
    const d = tag === 'path' ? attr(attrs, 'd') : shapeToPath(tag, attrs);
    if (!d) continue;
    const style = attr(attrs, 'style') ?? '';
    for (const sub of splitSubpaths(d)) {
      const box = pathBox(sub);
      if (!box) continue;
      out.push({ d: sub, style, box });
    }
  }
  return out;
}

/**
 * Точки вдоль пути.
 *
 * Габарит для профиля по высоте не годится: контур корпуса — один путь, и
 * его габарит покрывает весь силуэт, отчего каждая полоса высоты выходит
 * во всю ширину. Нужны точки САМОЙ кривой, поэтому кубики и квадратики
 * считаются по формуле Безье в трёх долях, а не берутся по контрольным
 * точкам — те лежат снаружи кривой и раздували бы силуэт.
 */
export function pathPoints(d: string): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const tokens: (string | number)[] = [];
  for (const m of d.matchAll(TOKENS)) tokens.push(m[1] ? m[1] : Number(m[2]));

  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let command = '';
  let i = 0;
  const see = (px: number, py: number): void => {
    if (Number.isFinite(px) && Number.isFinite(py)) out.push({ x: px, y: py });
  };
  /** Кубика в долях пути. Три доли достаточно: узлов в контуре и так много. */
  const cubic = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
  ): void => {
    for (const t of [0.25, 0.5, 0.75]) {
      const u = 1 - t;
      see(
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      );
    }
  };

  while (i < tokens.length) {
    const token = tokens[i];
    if (typeof token === 'string') {
      command = token;
      i++;
      if (command.toLowerCase() === 'z') {
        x = startX;
        y = startY;
      }
      continue;
    }
    if (!command) break;

    const lower = command.toLowerCase();
    const relative = command === lower;
    const need = ARITY[lower] ?? 0;
    if (need === 0) {
      i++;
      continue;
    }
    const args = tokens.slice(i, i + need);
    if (args.length < need || args.some((a) => typeof a !== 'number')) break;
    const n = args as number[];
    i += need;

    switch (lower) {
      case 'm':
      case 'l':
      case 't': {
        x = relative ? x + n[0]! : n[0]!;
        y = relative ? y + n[1]! : n[1]!;
        see(x, y);
        if (lower === 'm') {
          startX = x;
          startY = y;
          command = relative ? 'l' : 'L';
        }
        break;
      }
      case 'h':
        x = relative ? x + n[0]! : n[0]!;
        see(x, y);
        break;
      case 'v':
        y = relative ? y + n[0]! : n[0]!;
        see(x, y);
        break;
      case 'c': {
        const x1 = relative ? x + n[0]! : n[0]!;
        const y1 = relative ? y + n[1]! : n[1]!;
        const x2 = relative ? x + n[2]! : n[2]!;
        const y2 = relative ? y + n[3]! : n[3]!;
        const nx = relative ? x + n[4]! : n[4]!;
        const ny = relative ? y + n[5]! : n[5]!;
        cubic(x, y, x1, y1, x2, y2, nx, ny);
        x = nx;
        y = ny;
        see(x, y);
        break;
      }
      case 's':
      case 'q': {
        const cx = relative ? x + n[0]! : n[0]!;
        const cy = relative ? y + n[1]! : n[1]!;
        const nx = relative ? x + n[2]! : n[2]!;
        const ny = relative ? y + n[3]! : n[3]!;
        // Квадратика — та же кубика с двумя третями до контрольной точки.
        cubic(
          x,
          y,
          x + (2 / 3) * (cx - x),
          y + (2 / 3) * (cy - y),
          nx + (2 / 3) * (cx - nx),
          ny + (2 / 3) * (cy - ny),
          nx,
          ny,
        );
        x = nx;
        y = ny;
        see(x, y);
        break;
      }
      case 'a':
        x = relative ? x + n[5]! : n[5]!;
        y = relative ? y + n[6]! : n[6]!;
        see(x, y);
        break;
      default:
        break;
    }
  }
  return out;
}

export function unionBox(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  return boxes.reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }));
}

export const boxWidth = (b: Box): number => b.maxX - b.minX;
export const boxHeight = (b: Box): number => b.maxY - b.minY;
