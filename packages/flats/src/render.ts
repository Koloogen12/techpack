import type { Centimeters } from '@seamster/core';
import type { StyleSpec } from '@seamster/stylespec';
import { buildPaths, DEFAULT_PATH_OPTIONS, type PathOptions } from './paths.js';
import { buildSidePaths, garmentDepth, type SideGeometry } from './side.js';
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

export const FLAT_LAYERS = [
  'outline',
  'seams',
  'stitches',
  'hardware',
  'callouts',
  'artwork',
  'pattern',
  'color',
] as const;
export type FlatLayer = (typeof FLAT_LAYERS)[number];

export interface Callout {
  /** Номер выноски. Совпадает с номером узла в разделе конструкции. */
  number: number;
  /** Точка на чертеже, к которой ведёт выноска. */
  at: { x: number; y: number };
  node_id: string;
}

export type FlatView = 'front' | 'back' | 'side';

export interface RenderOptions {
  view: FlatView;
  /**
   * Глубина изделия на уровне груди, см. Обязательна для бокового вида
   * и бессмысленна для остальных.
   *
   * Приходит снаружи намеренно: её нельзя вычислить из табеля мер, она
   * выводится из размерной сетки и прибавки (см. `garmentDepth`). Чертёж
   * не должен уметь ходить в справочники — иначе он перестанет быть
   * чистой проекцией спеки.
   */
  depthCm?: Centimeters;
  /**
   * Ниже этого угла рукав не отводится, градусы. Из справочника условностей.
   */
  minSleeveAngleDeg?: number;
  /**
   * Доля замера H01, на которую капюшон поднимается на чертеже.
   * Условность рисунка из того же справочника.
   */
  hoodDrawFactor?: number;
  /**
   * Подпись вида внутри SVG — заголовок и текст для чтения с экрана.
   *
   * Приходит снаружи, потому что чертёж живёт внутри документа, а документ
   * бывает на трёх языках. Русское слово внутри китайского техпака —
   * это не мелочь оформления: его читает программа чтения с экрана
   * и печатает поиск по файлу.
   */
  viewLabel?: string;
  /** Какие слои показывать. По умолчанию все, кроме выносок. */
  layers?: readonly FlatLayer[];
  callouts?: readonly Callout[];
  /**
   * Зоны нанесения. Рисуются ПРЯМОУГОЛЬНИКОМ с размерами, а не картинкой:
   * печатник отмеряет рулеткой от высшей точки плеча, и ему нужны границы
   * и сантиметры, а не то, как выглядит рисунок. Сам макет уходит отдельным
   * файлом — подменять его изображением на чертеже значит потерять и то,
   * и другое.
   */
  artwork?: readonly ArtworkZone[];
  /**
   * Заливка сплошным раппортом — превью, а не чертёж.
   *
   * Чертёж рисуется в сантиметрах, поэтому шаг раппорта здесь РАЗМЕРНО ТОЧЕН:
   * 12 см на изделии дают 12 см на рисунке. У конкурента превью декоративное —
   * ползунок «×4 повтора» ни к чему не привязан, и по нему нельзя понять,
   * будет мотив с ладонь или с монету.
   *
   * Слой по умолчанию ВЫКЛЮЧЕН: технический чертёж должен оставаться чертежом,
   * а заливка живёт на странице нанесения с пометкой «не для замеров».
   */
  patternFill?: { dataUri: string; repeatCm: number };
  /**
   * Цвет-компаньон для рибан.
   *
   * Пояс, манжеты и бейка кроятся из ДРУГОГО полотна — в спецификации это
   * отдельная позиция, кашкорсе. При печати полотна до раскроя оно
   * не печатается, и заливать его рисунком значит обещать фабрике то,
   * чего она не сделает.
   */
  ribFill?: string;
  /**
   * Заливка изделия цветом колорвея.
   *
   * В отличие от фотореалистичной визуализации — детерминированная и точная:
   * это ровно тот hex, что стоит в спецификации, без участия модели и без
   * платы за генерацию. Драпировки она не покажет, зато не соврёт в цвете
   * и не потребует интернета.
   *
   * Слой по умолчанию ВЫКЛЮЧЕН: технический чертёж остаётся чёрно-белым,
   * а цвет живёт на странице колорвеев.
   */
  colorFill?: string;
  paths?: PathOptions;
  /** Поле вокруг чертежа, см. */
  margin?: number;
}

/**
 * Извлечение замеров чертежа из табеля мер.
 *
 * Точки, которых у категории нет, возвращают undefined, а не подставное
 * значение: у худи горловина закрыта капюшоном, и рисовать ей бейку значило бы
 * показать фабрике изделие, которого нет.
 */
export function measurementsFrom(spec: StyleSpec): FlatMeasurements {
  const value = (code: string, fallback: number): number =>
    spec.measurements.points.find((p) => p.code === code)?.base.value ?? fallback;
  const optional = (code: string): number | undefined =>
    spec.measurements.points.find((p) => p.code === code)?.base.value;

  const detail = {
    // Бейка горловины — деталь, а не обязательный замер: у худи её нет,
    // горловину закрывает капюшон.
    neckRibHeight: optional('T17'),
    cuffRibHeight: optional('H08'),
    waistRibHeight: optional('H07'),
    hoodHeight: optional('H01'),
    hoodWidth: optional('H02'),
    hoodOpening: optional('H03'),
    pocketWidth: optional('H04') ?? optional('H09'),
    pocketHeight: optional('H05') ?? optional('H10'),
    // Застёжка и воротник: величины есть только у тех категорий, где деталь
    // существует, — рисунок не догадывается, а читает табель мер.
    zipPlacketWidth: optional('Z02'),
    collarLength: optional('P01'),
    collarSpread: optional('P03'),
    placketLength: optional('P04'),
    placketWidth: optional('P05'),
  };

  return {
    bodyLength: value('T01', 70),
    chestFlat: value('T03', 51),
    waistFlat: value('T04', 49),
    hemFlat: value('T05', 51),
    shoulderWidth: value('T06', optional('K02') ?? 44),
    armhole: value('T09', 22),
    sleeveLength: value('T10', 20),
    bicep: value('T12', 20),
    sleeveOpening: value('T13', 17),
    neckWidth: value('T14', 18),
    frontNeckDrop: value('T15', 8),
    backNeckDrop: value('T16', 2.5),
    shoulderSlope: value('T18', 4),
    // Ключи с undefined не добавляются: их отсутствие — значимая информация.
    ...Object.fromEntries(Object.entries(detail).filter(([, v]) => v !== undefined)),
    // Безрукавка объявляется прямо: у майки ширина плеч есть, а рукава нет,
    // и вывести одно из другого нельзя.
    ...(spec.style.category === 'tank_top' ? { sleeveless: true } : {}),
  };
}

export interface RenderResult {
  svg: string;
  geometry: FlatGeometry | SideGeometry;
  /**
   * Габариты области рисования в САНТИМЕТРАХ изделия.
   *
   * Нужны вёрстке: три вида на одном листе обязаны стоять в одном масштабе,
   * а для этого ширины колонок должны относиться так же, как ширины видов.
   * Бок узкий, и растянутый на треть листа он выглядел бы шире переда —
   * то есть врал бы ровно в том, что показывает.
   */
  viewBox: { width: number; height: number };
}

/** Прямоугольник зоны нанесения на чертеже, в сантиметрах изделия. */
export interface ArtworkZone {
  id: string;
  /** Отступ верхнего края от высшей точки плеча вниз, см. */
  offsetFromTop: Centimeters;
  widthCm: Centimeters;
  heightCm: Centimeters;
  /** На каком виде показывать. Зона спины на переде не рисуется. */
  view: 'front' | 'back';
}

export function renderFlat(m0: FlatMeasurements, options: RenderOptions): RenderResult {
  const m: FlatMeasurements =
    options.hoodDrawFactor === undefined ? m0 : { ...m0, hoodDrawFactor: options.hoodDrawFactor };
  const layers = options.layers ?? ['outline', 'seams', 'stitches', 'hardware', 'artwork'];
  const margin = options.margin ?? 4;
  const isSide = options.view === 'side';

  if (isSide && options.depthCm === undefined) {
    throw new Error('боковой вид требует глубины изделия: её не задаёт ни один замер');
  }

  const built = isSide
    ? buildSidePaths(m, options.depthCm!, options.paths ?? DEFAULT_PATH_OPTIONS)
    : buildPaths(m, options.view as 'front' | 'back', options.paths ?? DEFAULT_PATH_OPTIONS);
  const geometry = built.geometry;
  const paths = built.paths;

  // Перед и спинка симметричны: рисуется правая половина, левая берётся
  // зеркалом (knowledge-base/02 §6, правило 2). Бок несимметричен по сути —
  // у него перед спереди, спинка сзади, — и зеркалить его значит стереть
  // единственное, что он показывает.
  const b = geometry.bounds;
  const left = ('left' in b ? b.left : -b.width) - margin;
  const right = ('right' in b ? b.right : b.width) + margin;
  const top = b.top - margin;
  const boxWidth = right - left;
  const boxHeight = b.bottom - b.top + margin * 2;
  const viewBox = `${left} ${top} ${boxWidth} ${boxHeight}`;

  const half = (content: string): string =>
    isSide ? content : `<g>${content}</g><g transform="scale(-1,1)">${content}</g>`;

  const layer = (name: FlatLayer, content: string): string =>
    layers.includes(name) && content
      ? `\n  <g class="layer-${name}" data-layer="${name}">${content}</g>`
      : '';

  const path = (d: string, width: number, dash?: string): string =>
    `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${width}"` +
    ` stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;

  // Идентификаторы уникальны на вид: три чертежа живут на одном листе HTML,
  // а ссылки url(#…) резолвятся по всему документу. С общим именем спинка
  // и бок брали бы определения переда — и обрезались бы по чужому контуру.
  const uid = `${options.view}`;

  // --- Заливка по ДЕТАЛЯМ КРОЯ, а не по силуэту ------------------------------
  // Рисунок ложится только на печатаемые детали, и на каждой он повёрнут
  // по её долевой. Клип по силуэту нужен потому, что детали намеренно
  // нарисованы с запасом: пояс шире изделия у низа, и без клипа он вылез бы
  // за контур.
  const shell = paths.panels.filter((p) => p.material === 'shell');
  const ribs = paths.panels.filter((p) => p.material === 'rib');
  const angles = [...new Set(shell.map((p) => Math.round(p.grain_deg * 100) / 100))];
  const tileId = (deg: number, mirrored: boolean): string =>
    `tile-${uid}-${angles.indexOf(Math.round(deg * 100) / 100)}${mirrored ? 'm' : ''}`;

  const patternDefs =
    options.patternFill && layers.includes('pattern')
      ? `<defs>` +
        angles
          .flatMap((deg) =>
            [false, true].map((mirrored) => {
              // Зеркальная половина рисуется через scale(-1,1); без обратного
              // преобразования мотив на ней тоже зеркалился бы. Полотно
              // печатается один раз и не бывает зеркальным — а несимметричный
              // мотив на левой половине выдал бы это с головой.
              const t = mirrored ? `scale(-1,1) rotate(${-deg})` : `rotate(${deg})`;
              return (
                `<pattern id="${tileId(deg, mirrored)}" patternUnits="userSpaceOnUse" ` +
                `patternTransform="${t}" ` +
                `width="${options.patternFill!.repeatCm}" height="${options.patternFill!.repeatCm}">` +
                `<image href="${options.patternFill!.dataUri}" x="0" y="0" ` +
                `width="${options.patternFill!.repeatCm}" height="${options.patternFill!.repeatCm}"/>` +
                `</pattern>`
              );
            }),
          )
          .join('') +
        `<clipPath id="clip-${uid}">` +
        paths.fill.map((d) => `<path d="${d}"/>`).join('') +
        `</clipPath></defs>`
      : '';

  // Цвет идёт под раппортом и под линиями: он фон, а не рисунок.
  const colorFill = layer(
    'color',
    options.colorFill
      ? half(
          paths.fill
            .map((d) => `<path d="${d}" fill="${options.colorFill}" stroke="none"/>`)
            .join(''),
        )
      : '',
  );

  const RIB_NEUTRAL = '#DCD6CC';
  const panelFill = (mirrored: boolean): string =>
    shell
      .map((p) => `<path d="${p.d}" fill="url(#${tileId(p.grain_deg, mirrored)})" stroke="none"/>`)
      .join('') +
    ribs
      .map(
        (p) =>
          `<path d="${p.d}" fill="${options.ribFill ?? RIB_NEUTRAL}" stroke="none" ` +
          `data-panel="${p.id}"/>`,
      )
      .join('');

  const clipped = (content: string, mirrored: boolean): string =>
    `<g${mirrored ? ' transform="scale(-1,1)"' : ''} clip-path="url(#clip-${uid})">${content}</g>`;

  const patternFill = layer(
    'pattern',
    options.patternFill
      ? clipped(panelFill(false), false) + (isSide ? '' : clipped(panelFill(true), true))
      : '',
  );

  const outline = layer(
    'outline',
    half(
      `<g data-line="outline">${path(paths.outline, STROKE.outline)}</g>` +
        paths.hood.map((h) => `<g data-line="${h.id}">${path(h.d, STROKE.outline)}</g>`).join('') +
        paths.parts.map((d) => path(d, STROKE.outline)).join(''),
    ),
  );

  const seams = layer(
    'seams',
    half(
      paths.seams.map((s) => `<g data-line="${s.id}">${path(s.d, STROKE.seam)}</g>`).join('') +
        // Карман настрочной: его край — видимый шов, а не отстрочка.
        paths.pocket.map((p) => `<g data-line="${p.id}">${path(p.d, STROKE.seam)}</g>`).join('') +
        paths.ribs.map((d) => path(d, STROKE.hidden)).join('') +
        // Точками — то, что закрыто другой деталью (knowledge-base/02 §3).
        paths.hidden.map((d) => path(d, STROKE.seam, '0.35 0.55')).join(''),
    ) + (paths.center ? path(paths.center, STROKE.center, '1.2 0.8') : ''),
  );

  const stitches = layer(
    'stitches',
    half(
      paths.stitches
        .map((st) => `<g data-line="${st.id}">${path(st.d, STROKE.stitch, '0.7 0.5')}</g>`)
        .join(''),
    ),
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

  // Зона нанесения: рамка пунктиром, крестик в центре и подпись с размерами.
  // Пунктир намеренно — это не деталь изделия, а место на нём.
  const artwork = layer(
    'artwork',
    (options.artwork ?? [])
      .filter((z) => z.view === options.view)
      .map((z) => {
        const x = -z.widthCm / 2;
        // Отсчёт от ВЫСШЕЙ ТОЧКИ ПЛЕЧА — она в геометрии лежит на y = 0.
        // Считать от верха габарита нельзя: у худи туда попадает капюшон,
        // и зона уехала бы вниз на всю его высоту, разойдясь с таблицей.
        const y = geometry.hps.y + z.offsetFromTop;
        return (
          `<g data-artwork="${z.id}">` +
          `<rect x="${x}" y="${y}" width="${z.widthCm}" height="${z.heightCm}" ` +
          `fill="none" stroke="currentColor" stroke-width="${STROKE.stitch}" ` +
          `stroke-dasharray="1.5 1"/>` +
          `<path d="M ${-1} ${y + z.heightCm / 2} H 1 M 0 ${y + z.heightCm / 2 - 1} V ${
            y + z.heightCm / 2 + 1
          }" stroke="currentColor" stroke-width="${STROKE.stitch}"/>` +
          `<text x="0" y="${y + z.heightCm + 2.4}" text-anchor="middle" font-size="1.8" ` +
          `font-family="JetBrains Mono, monospace" fill="currentColor">` +
          `${z.id} · ${z.widthCm}×${z.heightCm}</text>` +
          `</g>`
        );
      })
      .join(''),
  );

  const title = options.viewLabel ?? { front: 'ПЕРЕД', back: 'СПИНКА', side: 'БОК' }[options.view];

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" ` +
    `role="img" aria-label="${title}" ` +
    `data-view="${options.view}" color="#0E0E0E">` +
    `<title>${title}</title>` +
    patternDefs +
    colorFill +
    patternFill +
    outline +
    seams +
    stitches +
    layer('hardware', '') +
    artwork +
    callouts +
    `\n</svg>`;

  return { svg, geometry, viewBox: { width: boxWidth, height: boxHeight } };
}

/**
 * Нужен ли изделию боковой вид.
 *
 * Правило не по списку категорий, а по СОСТАВУ ИЗДЕЛИЯ, и это принципиально:
 * список пришлось бы дополнять на каждую новую категорию, а забытая строчка
 * в списке тихо отнимает у документа целый вид. Здесь же куртка и бомбер
 * получат бок в тот день, когда у них появится капюшон или объёмный карман, —
 * без правки этого кода.
 *
 * Условие: у изделия есть деталь, форму которой перед и спинка показать
 * не могут. Капюшон на переде лежит разложенным вверх — условность, по
 * построению скрывающая профиль. Настрочной карман виден плоским
 * прямоугольником, хотя он лежит ПОВЕРХ полотна.
 *
 * Гладкая футболка бока не получает, и это не экономия: у разложенной футболки
 * сбоку нечего показать, а лист с пустым чертежом — ровно та болезнь эталона,
 * которую мы не берём.
 */
export function needsSideView(spec: StyleSpec): boolean {
  const has = (code: string): boolean => spec.measurements.points.some((p) => p.code === code);
  return has('H01') || has('H04');
}

/** Рендер видов из спеки. Основной вход для документа и веб-вьювера. */
export function renderFlatsFromSpec(
  spec: StyleSpec,
  options: Omit<RenderOptions, 'view' | 'viewLabel'> & {
    /** Подписи видов на языке комплекта. */
    viewLabels?: Record<FlatView, string>;
  } = {},
): { front: RenderResult; back: RenderResult; side?: RenderResult } {
  const m = measurementsFrom(spec);
  const label = (view: FlatView): { viewLabel: string } | object =>
    options.viewLabels ? { viewLabel: options.viewLabels[view] } : {};

  // Зоны нанесения берутся из спеки сами: чертёж — её проекция, и требовать
  // передавать их отдельно значило бы разрешить чертежу разойтись с таблицей.
  const artwork: ArtworkZone[] = (spec.artwork?.placements ?? []).map((a) => ({
    id: a.id,
    offsetFromTop: a.offset_from_anchor_cm.value,
    widthCm: a.size_cm.width.value,
    heightCm: a.size_cm.height.value,
    // Спина рисуется на виде спинки, всё остальное — на переде.
    view: a.zone.startsWith('back') ? ('back' as const) : ('front' as const),
  }));

  const hem = spec.construction?.nodes.find((n) => n.zone === 'hem');
  const sleeveHem = spec.construction?.nodes.find((n) => n.node_id.startsWith('sleeve_hem'));

  // Число пунктирных линий берётся из кода стежка узла: 406 — две строчки,
  // 407 — три. Замена узла на чертеже видна, а не только в таблице.
  const rows = (stitch: string | undefined): number => (stitch === '407' ? 3 : 2);

  const paths: PathOptions = {
    ...DEFAULT_PATH_OPTIONS,
    ...(options.minSleeveAngleDeg === undefined
      ? {}
      : { minSleeveAngleDeg: options.minSleeveAngleDeg }),
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

  const side =
    needsSideView(spec) && options.depthCm !== undefined
      ? renderFlat(m, { ...options, view: 'side', paths, ...label('side') })
      : undefined;

  return {
    front: renderFlat(m, { ...options, view: 'front', paths, artwork, ...label('front') }),
    back: renderFlat(m, { ...options, view: 'back', paths, artwork, ...label('back') }),
    ...(side ? { side } : {}),
  };
}

/**
 * Глубина изделия для бокового вида по спеке и размерной сетке.
 *
 * Живёт здесь, а не в `renderFlatsFromSpec`, чтобы чертёж остался чистой
 * проекцией спеки: справочник в него не входит. Вызывающая сторона берёт
 * число тут и передаёт вниз явным аргументом — видно, что оно ПРИШЛО
 * ИЗВНЕ табеля мер, а не выведено из него.
 */
export function depthForSpec(
  spec: StyleSpec,
  bodyChestCm: Centimeters,
  widthToDepth: number,
): Centimeters {
  return garmentDepth(measurementsFrom(spec).chestFlat, {
    bodyChest: bodyChestCm,
    widthToDepth,
  });
}
