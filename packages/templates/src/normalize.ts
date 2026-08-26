import { boxHeight, boxWidth, readPaths, unionBox, type Box, type RawPath } from './svg.js';

/**
 * Приведение покупного силуэта к виду, пригодному для техпака.
 *
 * Датасет нарисован как мокап: перед и спинка на одном листе, детали залиты
 * серым, подкладка капюшона — чёрным. Для документа нужно ровно обратное:
 * два отдельных вида, контур без заливки, единая толщина линии. Три шага
 * ниже — это и есть разница между картинкой для маркетплейса и чертежом,
 * по которому кроят.
 */

export interface NormalizedView {
  /** Готовый SVG одного вида. */
  svg: string;
  /** Габарит содержимого в координатах исходного листа. */
  box: Box;
  paths: number;
}

export interface NormalizeResult {
  front: NormalizedView;
  back: NormalizedView | null;
  notes: string[];
}

export interface NormalizeOptions {
  /**
   * Поле вокруг силуэта, доля от большей стороны.
   *
   * Не ноль: обводка рисуется по центру линии, и при нулевом поле половина
   * её толщины срезается краем вида.
   */
  margin?: number;
  /** Толщина линии в единицах итогового viewBox. */
  strokeWidth?: number;
}

const DEFAULTS = { margin: 0.02, strokeWidth: 2 } as const;

/**
 * Разделение листа на перед и спинку.
 *
 * По СВЯЗНЫМ КЛАСТЕРАМ, а не по просвету в проекции. Просвет искали
 * сначала по середине листа, потом по гистограмме покрытия — и оба раза
 * ошибались об одно: расположение видов задаёт художник, а не холст.
 * В датасете виды стоят и рядом, и друг под другом, и почти вплотную;
 * любая проекция на одну ось такие случаи путает.
 *
 * Кластер — это то, что нарисовано вместе: пути, чьи габариты цепляются
 * друг за друга. Изделие связно по определению, два изделия — нет. Отсюда
 * правило: ровно два сопоставимых кластера значат перед и спинку, один —
 * что на листе один вид, и делить нечего.
 */
export function splitViews(paths: readonly RawPath[]): { front: RawPath[]; back: RawPath[] } {
  const total = unionBox(paths.map((p) => p.box));
  if (!total || paths.length < 6) return { front: [...paths], back: [] };

  const groups = clusterPaths(paths, total);
  // Мелочь в кластеры не считаем: одинокая точка или подпись не вид.
  const solid = groups.filter((g) => g.length >= 3);
  if (solid.length < 2) return { front: [...paths], back: [] };

  const area = (g: readonly RawPath[]): number => {
    const b = unionBox(g.map((p) => p.box))!;
    return boxWidth(b) * boxHeight(b);
  };
  const ranked = [...solid].sort((a, b) => area(b) - area(a));
  const [first, second] = [ranked[0]!, ranked[1]!];

  // Перед и спинка одного изделия занимают сопоставимое место. Если второй
  // кластер втрое мельче первого — это не вид, а деталь рядом с изделием:
  // бирка, увеличенный узел, отдельно нарисованный шнур.
  if (area(first) > area(second) * 3) return { front: [...paths], back: [] };

  const centre = (g: readonly RawPath[]): { x: number; y: number } => {
    const b = unionBox(g.map((p) => p.box))!;
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  };
  const c1 = centre(first);
  const c2 = centre(second);

  // Перед — слева, а при вертикальной раскладке сверху: отраслевая
  // условность подачи, ей следует весь датасет.
  const horizontal = Math.abs(c1.x - c2.x) >= Math.abs(c1.y - c2.y);
  const firstIsFront = horizontal ? c1.x <= c2.x : c1.y <= c2.y;
  const front = firstIsFront ? [...first] : [...second];
  const back = firstIsFront ? [...second] : [...first];

  // Мелкие кластеры не теряются: каждый уходит к тому виду, к чьему центру
  // он ближе. Иначе с листа пропадали бы шнур, люверс и бирка.
  const frontCentre = centre(front);
  const backCentre = centre(back);
  for (const g of groups) {
    if (g === first || g === second || g.length >= 3) continue;
    const c = centre(g);
    const df = (c.x - frontCentre.x) ** 2 + (c.y - frontCentre.y) ** 2;
    const db = (c.x - backCentre.x) ** 2 + (c.y - backCentre.y) ** 2;
    (df <= db ? front : back).push(...g);
  }
  // Оставшиеся крупные кластеры — редкий случай третьего вида на листе;
  // они тоже раскладываются по близости, а не выбрасываются.
  for (const g of ranked.slice(2)) {
    const c = centre(g);
    const df = (c.x - frontCentre.x) ** 2 + (c.y - frontCentre.y) ** 2;
    const db = (c.x - backCentre.x) ** 2 + (c.y - backCentre.y) ** 2;
    (df <= db ? front : back).push(...g);
  }

  return { front, back };
}

/**
 * Пути, сцепленные габаритами, в один кластер.
 *
 * Габариты сравниваются с УСАДКОЙ: рукава соседних видов почти касаются, а
 * габарит кривой всегда чуть шире самой кривой. Без усадки два вида
 * склеились бы по касанию габаритов там, где на рисунке между ними воздух.
 *
 * Перебор идёт заметающей прямой по левому краю: сравнивать каждый путь с
 * каждым на файле в шесть сотен путей значило бы триста тысяч проверок
 * ради нескольких настоящих пересечений.
 */
function clusterPaths(paths: readonly RawPath[], total: Box): RawPath[][] {
  const shrink = Math.max(boxWidth(total), boxHeight(total)) * 0.005;
  const order = paths.map((_, i) => i).sort((a, b) => paths[a]!.box.minX - paths[b]!.box.minX);

  const parent = paths.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r]!;
    let c = i;
    while (parent[c] !== c) {
      const next = parent[c]!;
      parent[c] = r;
      c = next;
    }
    return r;
  };

  const active: number[] = [];
  for (const i of order) {
    const bi = paths[i]!.box;
    // Активными остаются те, чей правый край ещё правее нашего левого:
    // всё, что закончилось раньше, пересечься с нами уже не может.
    for (let k = active.length - 1; k >= 0; k--) {
      const j = active[k]!;
      if (paths[j]!.box.maxX - shrink <= bi.minX) {
        active.splice(k, 1);
        continue;
      }
      const bj = paths[j]!.box;
      const touch =
        bi.minX + shrink < bj.maxX &&
        bj.minX + shrink < bi.maxX &&
        bi.minY + shrink < bj.maxY &&
        bj.minY + shrink < bi.maxY;
      if (touch) parent[find(i)] = find(j);
    }
    active.push(i);
  }

  const by = new Map<number, RawPath[]>();
  paths.forEach((p, i) => {
    const root = find(i);
    const bucket = by.get(root);
    if (bucket) bucket.push(p);
    else by.set(root, [p]);
  });
  return [...by.values()];
}

/**
 * Заливки убираются, обводка остаётся — но иерархия линий сохраняется.
 *
 * Серая заливка мокапа в техпаке означала бы цвет изделия, которого мы не
 * знаем; чёрная подкладка капюшона — и вовсе деталь картинки, а не кроя.
 * Технический рисунок — это контур: цвет на нём появляется только слоем
 * колорвея, и решает его наша заливка по BOM, а не художник датасета.
 *
 * А вот ТОЛЩИНА линии — это смысл, а не оформление. В датасете контур
 * изделия нарисован вдвое жирнее отделочной строчки, и уравнять их значило
 * бы стереть разницу между швом и краем детали. Поэтому толщина не
 * назначается, а пересчитывается: своя ширина каждой линии, приведённая к
 * нашей опорной. Пунктир строчки сохраняется по той же причине — по числу
 * и виду параллельных линий технолог определяет тип машины.
 */
export function lineArt(style: string, strokeWidth: number, sourceReference = 0): string {
  const parts = new Map<string, string>();
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    parts.set(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
  }

  const hadStroke = parts.has('stroke') && parts.get('stroke') !== 'none';
  const fill = parts.get('fill');
  // Путь без обводки, но с заливкой — это плашка: молния, рибана, тень.
  // Она несёт форму, поэтому превращается в контур той же линией.
  const keep = hadStroke || (fill !== undefined && fill !== 'none');
  if (!keep) return '';

  const own = Number(parts.get('stroke-width') ?? 'NaN');
  const factor = sourceReference > 0 && Number.isFinite(own) && own > 0 ? own / sourceReference : 1;
  const width = Math.round(strokeWidth * factor * 1000) / 1000;

  // Пунктир задан в единицах координат, а координаты мы не трогаем. Зато
  // трогаем толщину, и штрих короче собственной толщины сливается в
  // сплошную линию. Поэтому штрих растягивается ровно во столько же раз,
  // во сколько потолстела линия, — рисунок строчки остаётся читаемым.
  const dashScale = sourceReference > 0 ? strokeWidth / sourceReference : 1;
  const dash = parts.get('stroke-dasharray');
  const scaledDash =
    dash && dash !== 'none'
      ? dash
          .split(/[\s,]+/)
          .map(Number)
          .filter((n) => Number.isFinite(n) && n > 0)
          .map((n) => Math.round(n * dashScale * 1000) / 1000)
          .join(' ')
      : '';

  return (
    `fill:none;stroke:#0E0E0E;stroke-width:${width};` +
    (scaledDash ? `stroke-dasharray:${scaledDash};` : '') +
    `stroke-linejoin:${parts.get('stroke-linejoin') ?? 'round'};` +
    `stroke-linecap:${parts.get('stroke-linecap') ?? 'round'};` +
    'stroke-miterlimit:10'
  );
}

/**
 * Опорная толщина линии файла — самая частая среди обводок.
 *
 * Именно частая, а не средняя: контур изделия рисуется одной шириной по
 * всему силуэту и потому доминирует, а редкие толстые акценты среднее
 * сместили бы. Относительно этой опоры и пересчитываются остальные линии.
 */
export function referenceStrokeWidth(paths: readonly RawPath[]): number {
  const counts = new Map<number, number>();
  for (const p of paths) {
    const m = /stroke-width:\s*([\d.]+)/.exec(p.style);
    if (!m) continue;
    const w = Number(m[1]);
    if (!Number.isFinite(w) || w <= 0) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [w, c] of counts) {
    if (c > bestCount) {
      best = w;
      bestCount = c;
    }
  }
  return best;
}

function viewOf(
  paths: readonly RawPath[],
  options: Required<NormalizeOptions>,
  reference: number,
): NormalizedView | null {
  const box = unionBox(paths.map((p) => p.box));
  if (!box) return null;

  const pad = Math.max(boxWidth(box), boxHeight(box)) * options.margin;
  const minX = box.minX - pad;
  const minY = box.minY - pad;
  const width = boxWidth(box) + pad * 2;
  const height = boxHeight(box) + pad * 2;

  const body = paths
    .map((p) => {
      const style = lineArt(p.style, options.strokeWidth, reference);
      return style ? `<path style="${style}" d="${p.d}"/>` : '';
    })
    .filter(Boolean)
    .join('');

  return {
    // viewBox переносится на содержимое, а сами координаты путей не трогаются:
    // пересчитывать тысячи чисел значило бы копить ошибку округления там,
    // где та же задача решается системой координат.
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(minX)} ${round(minY)} ` +
      `${round(width)} ${round(height)}" role="img">${body}</svg>`,
    box,
    paths: paths.length,
  };
}

const round = (n: number): string => (Math.round(n * 100) / 100).toString();

export function normalizeTemplate(svg: string, options: NormalizeOptions = {}): NormalizeResult {
  const opts = { ...DEFAULTS, ...options };
  const notes: string[] = [];
  const paths = readPaths(svg);
  if (paths.length === 0) throw new Error('в файле нет путей');

  const { front, back } = splitViews(paths);
  if (back.length === 0) {
    notes.push('вид один: разделить перед и спинку по просвету не удалось');
  }

  // Опора считается по ВСЕМУ файлу, а не по каждому виду отдельно: перед и
  // спинка нарисованы одной рукой, и разная опора сделала бы их линии
  // разной толщины на соседних листах документа.
  const reference = referenceStrokeWidth(paths);
  const frontView = viewOf(front, opts, reference);
  if (!frontView) throw new Error('передний вид пуст после нормализации');
  const backView = back.length ? viewOf(back, opts, reference) : null;

  return { front: frontView, back: backView, notes };
}
