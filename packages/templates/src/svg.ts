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
 * Все пути файла с их стилями и габаритами, разложенные до подпутей.
 *
 * Дальше по конвейеру подпуть — единица работы: его можно отнести к переду
 * или к спинке, посчитать его габарит, выбросить как мусор. Слитый путь
 * такой возможности не даёт вовсе.
 */
export function readPaths(svg: string): RawPath[] {
  const out: RawPath[] = [];
  for (const m of svg.matchAll(/<path\b([^>]*?)\/?>/gi)) {
    const attrs = m[1] ?? '';
    const d = /\bd="([^"]*)"/i.exec(attrs)?.[1];
    if (!d) continue;
    const style = /\bstyle="([^"]*)"/i.exec(attrs)?.[1] ?? '';
    for (const sub of splitSubpaths(d)) {
      const box = pathBox(sub);
      if (!box) continue;
      out.push({ d: sub, style, box });
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
