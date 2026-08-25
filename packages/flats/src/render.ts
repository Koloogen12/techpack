import type { StyleSpec } from '@specform/stylespec';
import { buildPaths, DEFAULT_PATH_OPTIONS, type PathOptions } from './paths.js';
import type { FlatGeometry, FlatMeasurements } from './geometry.js';

/**
 * Рендер технического чертежа в SVG.
 *
 * Чистая функция StyleSpec → SVG, без побочных состояний: это делает диффы
 * версий и визуальные снапшот-тесты тривиальными (CTO-SPEC.md §2).
 *
 * Слои — outline / seams / stitches / hardware / callouts (knowledge-base/02 §6).
 * Послойный SVG есть у нас и отсутствует у конкурента: его чертёж —
 * растровая картинка, трассированная в плоский вектор.
 */

/** Толщины линий в пунктах при масштабе 1 см = 1 единица (knowledge-base/02 §3). */
const STROKE = {
  outline: 0.36,
  seam: 0.18,
  stitch: 0.1,
  hidden: 0.08,
  center: 0.07,
} as const;

export const FLAT_LAYERS = ['outline', 'seams', 'stitches', 'hardware', 'callouts'] as const;
export type FlatLayer = (typeof FLAT_LAYERS)[number];

export interface Callout {
  /** Номер выноски. Совпадает с номером узла в разделе конструкции. */
  number: number;
  /** Точка на чертеже, к которой ведёт выноска. */
  at: { x: number; y: number };
  node_id: string;
}

export interface RenderOptions {
  view: 'front' | 'back';
  /** Какие слои показывать. По умолчанию все, кроме выносок. */
  layers?: readonly FlatLayer[];
  callouts?: readonly Callout[];
  paths?: PathOptions;
  /** Поле вокруг чертежа, см. */
  margin?: number;
}

/** Извлечение замеров чертежа из табеля мер. */
export function measurementsFrom(spec: StyleSpec): FlatMeasurements {
  const value = (code: string, fallback: number): number =>
    spec.measurements.points.find((p) => p.code === code)?.base.value ?? fallback;

  return {
    bodyLength: value('T01', 70),
    chestFlat: value('T03', 51),
    waistFlat: value('T04', 49),
    hemFlat: value('T05', 51),
    shoulderWidth: value('T06', 44),
    armhole: value('T09', 22),
    sleeveLength: value('T10', 20),
    bicep: value('T12', 20),
    sleeveOpening: value('T13', 17),
    neckWidth: value('T14', 18),
    frontNeckDrop: value('T15', 8),
    backNeckDrop: value('T16', 2.5),
    neckRibHeight: value('T17', 2),
    shoulderSlope: value('T18', 4),
  };
}

export interface RenderResult {
  svg: string;
  geometry: FlatGeometry;
}

export function renderFlat(m: FlatMeasurements, options: RenderOptions): RenderResult {
  const layers = options.layers ?? ['outline', 'seams', 'stitches', 'hardware'];
  const margin = options.margin ?? 4;
  const { geometry, paths } = buildPaths(m, options.view, options.paths ?? DEFAULT_PATH_OPTIONS);

  const halfWidth = geometry.bounds.width + margin;
  const height = geometry.bounds.height + margin * 2;
  const viewBox = `${-halfWidth} ${-margin} ${halfWidth * 2} ${height}`;

  // Правая половина рисуется один раз, левая — зеркалом: симметрия точная
  // по построению, а не по совпадению чисел (knowledge-base/02 §6, правило 2).
  const half = (content: string): string =>
    `<g>${content}</g><g transform="scale(-1,1)">${content}</g>`;

  const layer = (name: FlatLayer, content: string): string =>
    layers.includes(name) && content
      ? `\n  <g class="layer-${name}" data-layer="${name}">${content}</g>`
      : '';

  const path = (d: string, width: number, dash?: string): string =>
    `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${width}"` +
    ` stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;

  const outline = layer('outline', half(path(paths.outline, STROKE.outline)));

  const seams = layer(
    'seams',
    half(
      paths.seams.map((d) => path(d, STROKE.seam)).join('') +
        paths.ribs.map((d) => path(d, STROKE.hidden)).join(''),
    ) + path(paths.center, STROKE.center, '1.2 0.8'),
  );

  const stitches = layer(
    'stitches',
    half(paths.stitches.map((d) => path(d, STROKE.stitch, '0.7 0.5')).join('')),
  );

  const callouts = layer(
    'callouts',
    (options.callouts ?? [])
      .map(
        (c) =>
          `<g data-node="${c.node_id}">` +
          `<circle cx="${c.at.x}" cy="${c.at.y}" r="1.6" fill="none" stroke="currentColor" stroke-width="${STROKE.seam}"/>` +
          `<text x="${c.at.x}" y="${c.at.y + 0.55}" text-anchor="middle" font-size="2" ` +
          `font-family="JetBrains Mono, monospace" fill="currentColor">${c.number}</text>` +
          `</g>`,
      )
      .join(''),
  );

  const title = options.view === 'front' ? 'ПЕРЕД' : 'СПИНКА';

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" ` +
    `role="img" aria-label="Технический чертёж, вид: ${title.toLowerCase()}" ` +
    `data-view="${options.view}" color="#0E0E0E">` +
    `<title>${title}</title>` +
    outline +
    seams +
    stitches +
    layer('hardware', '') +
    callouts +
    `\n</svg>`;

  return { svg, geometry };
}

/** Рендер обоих видов из спеки. Основной вход для документа и веб-вьювера. */
export function renderFlatsFromSpec(
  spec: StyleSpec,
  options: Omit<RenderOptions, 'view'> = {},
): { front: RenderResult; back: RenderResult } {
  const m = measurementsFrom(spec);
  const hem = spec.construction?.nodes.find((n) => n.zone === 'hem');
  const sleeveHem = spec.construction?.nodes.find((n) => n.node_id.startsWith('sleeve_hem'));

  // Число пунктирных линий берётся из кода стежка узла: 406 — две строчки,
  // 407 — три. Замена узла на чертеже видна, а не только в таблице.
  const rows = (stitch: string | undefined): number => (stitch === '407' ? 3 : 2);

  const paths: PathOptions = {
    ...DEFAULT_PATH_OPTIONS,
    ...(hem
      ? { hemAllowance: hem.seam_allowance_cm.value, hemStitchRows: rows(hem.stitch_code) }
      : {}),
    ...(sleeveHem
      ? {
          sleeveHemAllowance: sleeveHem.seam_allowance_cm.value,
          sleeveStitchRows: rows(sleeveHem.stitch_code),
        }
      : {}),
  };

  return {
    front: renderFlat(m, { ...options, view: 'front', paths }),
    back: renderFlat(m, { ...options, view: 'back', paths }),
  };
}
