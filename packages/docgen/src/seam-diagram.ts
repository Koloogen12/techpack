import type { SeamDiagram } from '@seamster/kb';

/**
 * Схема шва в разрезе.
 *
 * Технолог читает шов не по названию, а по картинке: сколько слоёв, куда
 * отогнут срез, где идёт строчка. Текстовая строка «1.01.01 · 514 · оверлок
 * 4-ниточный» это знание не передаёт — её приходится держать в голове.
 *
 * Рисуется ИЗ ОПИСАНИЯ справочника, а не берётся картинкой: одна геометрия
 * на все размеры листа и все языки, и правка толщины линии не требует
 * перерисовывать тридцать два файла.
 *
 * Схема иллюстративная. Она показывает УСТРОЙСТВО шва — порядок слоёв и
 * положение строчек, — но не масштаб: припуск в сантиметрах живёт в таблице
 * рядом, и лист об этом говорит прямо.
 */

/** Сколько параллельных линий кладёт стежок этого класса. */
const STITCH_ROWS: Record<string, number> = {
  '101': 1,
  '103': 1,
  '301': 1,
  '304': 1,
  '401': 1,
  '406': 2,
  '407': 3,
  '503': 1,
  '504': 1,
  '512': 2,
  '514': 2,
  '602': 2,
  '605': 3,
  '607': 4,
};

/** Обмёточные стежки: край не просто прошит, а обмётан через срез. */
const OVERLOCK = new Set(['503', '504', '512', '514']);

/**
 * Машины, которые не шьют шов, а ставят фурнитуру или обрабатывают отверстие.
 *
 * У таких узлов в справочнике всё равно стоит код шва — 8.03.01, «шлевка», —
 * и схема нарисовала бы подогнутую полоску там, где на изделии люверс или
 * пуговица. Шва там нет, и рисунка быть не должно: код в таблице остаётся,
 * а расхождение помечено как пробел справочника.
 */
const NOT_A_SEAM = new Set(['eyelet_press', 'button_sew', 'buttonhole']);

export interface SeamDiagramOptions {
  /** Код стежка: от него зависит число линий и обмётка среза. */
  stitchCode?: string;
  /** Ширина рисунка в миллиметрах листа. */
  widthMm?: number;
  /** Машина узла. Установка фурнитуры схемы шва не получает. */
  machine?: string;
}

const W = 100;
const H = 46;
/**
 * Расстояние между слоями. Меньше семи слои сливаются в одну толстую линию,
 * и «два слоя, стачанные вместе» становится неотличимо от «один слой».
 */
const PLY = 7;

interface Pt {
  x: number;
  y: number;
}

/** Слой материала: ломаная средней линии, по которой рисуется полоса. */
function ply(points: Pt[], cls: string): string {
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return `<path class="${cls}" d="${d}"/>`;
}

/**
 * Профиль слоя с подгибом.
 *
 * Подогнутый край рисуется возвратом ломаной: материал уходит вправо, затем
 * складывается и идёт обратно. Два подгиба прячут срез внутрь — именно этим
 * «вподгибку с закрытым срезом» отличается от «с открытым».
 */
function folded(y: number, turns: number, from: number): Pt[] {
  const step = 13;
  if (turns <= 0)
    return [
      { x: from, y },
      { x: W - 6, y },
    ];
  if (turns === 1) {
    return [
      { x: from + step, y: y + PLY },
      { x: from, y: y + PLY },
      { x: from, y },
      { x: W - 6, y },
    ];
  }
  return [
    { x: from + step, y: y + PLY * 2 },
    { x: from + step * 0.55, y: y + PLY * 2 },
    { x: from + step * 0.55, y: y + PLY },
    { x: from, y: y + PLY },
    { x: from, y },
    { x: W - 6, y },
  ];
}

function stitches(
  diagram: SeamDiagram,
  stitchCode: string | undefined,
  yTop: number,
  yBottom: number,
): string {
  const rows = STITCH_ROWS[stitchCode ?? ''] ?? 1;
  const gap = 4.5;
  const out: string[] = [];
  for (const at of diagram.stitch_at) {
    const cx = 6 + (W - 12) * at;
    for (let i = 0; i < rows; i++) {
      const x = cx + (i - (rows - 1) / 2) * gap;
      out.push(
        `<line class="st" x1="${x.toFixed(1)}" y1="${(yTop - 4).toFixed(1)}" ` +
          `x2="${x.toFixed(1)}" y2="${(yBottom + 4).toFixed(1)}"/>`,
      );
    }
  }
  return out.join('');
}

/**
 * Обмётка среза: нить огибает торец пакета слоёв. Рисуется петлями через
 * край, а не зигзагом рядом с ним — обмёточная строчка тем и отличается от
 * обычной, что проходит ЧЕРЕЗ срез.
 */
function overlockEdge(x: number, yTop: number, yBottom: number): string {
  const loops = 4;
  const span = yBottom - yTop;
  const out: string[] = [];
  for (let i = 0; i < loops; i++) {
    const y1 = yTop + (span / loops) * i;
    const y2 = yTop + (span / loops) * (i + 1);
    out.push(
      `<path class="ov" d="M${(x + 7).toFixed(1)},${y1.toFixed(1)} ` +
        `C${(x - 3).toFixed(1)},${y1.toFixed(1)} ${(x - 3).toFixed(1)},${y2.toFixed(1)} ` +
        `${(x + 7).toFixed(1)},${y2.toFixed(1)}"/>`,
    );
  }
  return out.join('');
}

/**
 * SVG схемы шва. Возвращает null, когда устройство неизвестно: пустая рамка
 * честнее выдуманной картинки, а таблица рядом всё равно называет код.
 */
export function seamDiagramSvg(
  diagram: SeamDiagram | undefined,
  options: SeamDiagramOptions = {},
): string | null {
  if (!diagram) return null;
  if (options.machine && NOT_A_SEAM.has(options.machine)) return null;
  const { stitchCode } = options;
  const mid = H / 2;
  const layers: string[] = [];
  const foldOf = (i: number): number => diagram.folds.find((f) => f.ply === i)?.turns ?? 0;

  let yTop = mid;
  let yBottom = mid;

  if (diagram.kind === 'bound') {
    // Основной слой идёт справа и обрывается; окантовка огибает его срез.
    const edge = 34;
    layers.push(
      ply(
        [
          { x: edge, y: mid },
          { x: W - 6, y: mid },
        ],
        'pl',
      ),
    );
    const wrap = foldOf(0) > 0 ? 3 : 0;
    layers.push(
      ply(
        [
          { x: W - 30, y: mid - PLY - wrap },
          { x: edge - 7, y: mid - PLY - wrap },
          { x: edge - 7, y: mid + PLY + wrap },
          { x: W - 30, y: mid + PLY + wrap },
        ],
        'bind',
      ),
    );
    yTop = mid - PLY - wrap;
    yBottom = mid + PLY + wrap;
  } else if (diagram.kind === 'ornamental') {
    layers.push(
      ply(
        [
          { x: 6, y: mid },
          { x: W - 6, y: mid },
        ],
        'pl',
      ),
    );
  } else if (diagram.kind === 'single_ply') {
    // Одна деталь, подогнутая с обеих сторон: шлевка, бейка, пояс.
    layers.push(
      ply(
        [
          { x: 22, y: mid + PLY },
          { x: 14, y: mid + PLY },
          { x: 14, y: mid },
          { x: W - 14, y: mid },
          { x: W - 14, y: mid + PLY },
          { x: W - 22, y: mid + PLY },
        ],
        'pl',
      ),
    );
    yTop = mid;
    yBottom = mid + PLY;
  } else if (diagram.kind === 'edge_fold') {
    layers.push(ply(folded(mid, foldOf(0), 14), 'pl'));
    yTop = mid;
    yBottom = mid + PLY * Math.max(1, foldOf(0));
  } else if (diagram.kind === 'lapped' || diagram.kind === 'patch') {
    // Нижний слой идёт насквозь, верхний ложится поверх с подогнутым краем.
    const drop = diagram.kind === 'patch' ? PLY : PLY;
    layers.push(
      ply(
        [
          { x: 6, y: mid + drop },
          { x: W - 6, y: mid + drop },
        ],
        'pl',
      ),
    );
    const start = diagram.kind === 'patch' ? 14 : 26;
    layers.push(ply(folded(mid, foldOf(1) || 1, start), 'pl'));
    yTop = mid;
    yBottom = mid + drop + PLY;
  } else {
    // superimposed: слои наложены и стачаны у среза.
    for (let i = 0; i < diagram.plies; i++) {
      layers.push(
        ply(
          [
            { x: 10, y: mid + (i - (diagram.plies - 1) / 2) * PLY },
            { x: W - 6, y: mid + (i - (diagram.plies - 1) / 2) * PLY },
          ],
          'pl',
        ),
      );
    }
    yTop = mid - ((diagram.plies - 1) / 2) * PLY;
    yBottom = mid + ((diagram.plies - 1) / 2) * PLY;
  }

  // Обмёточный стежок показывается везде, где есть открытый срез: он и есть
  // то, чем оверлок отличается от челночной машины на той же операции.
  const edgeOverlock =
    stitchCode &&
    OVERLOCK.has(stitchCode) &&
    diagram.kind !== 'bound' &&
    diagram.kind !== 'ornamental'
      ? overlockEdge(diagram.kind === 'superimposed' ? 8 : 12, yTop - 1.5, yBottom + 1.5)
      : '';

  return (
    `<svg viewBox="0 0 ${W} ${H}" width="${options.widthMm ?? 26}mm" preserveAspectRatio="xMidYMid meet" role="img">` +
    `<style>` +
    `.pl{fill:none;stroke:#0E0E0E;stroke-width:2.6;stroke-linejoin:round;stroke-linecap:round}` +
    `.bind{fill:none;stroke:#0E0E0E;stroke-width:2.6;stroke-linejoin:round;stroke-linecap:round}` +
    `.st{stroke:#C0392B;stroke-width:1.6;stroke-linecap:round}` +
    `.ov{fill:none;stroke:#C0392B;stroke-width:1.4;stroke-linecap:round}` +
    `</style>` +
    layers.join('') +
    edgeOverlock +
    stitches(diagram, stitchCode, yTop, yBottom) +
    `</svg>`
  );
}
