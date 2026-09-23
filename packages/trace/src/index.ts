import { trace, type PotraceOptions } from 'potrace';

/**
 * Трассировка технического эскиза в SVG.
 *
 * Эскиз рисует модель, и он растр. Фабрике и дизайнеру нужен вектор «как
 * нарисовано»: масштабируется без потерь, открывается в Illustrator, режется
 * на детали. Это классическая задача — Potrace (Selinger, 2003): порог
 * яркости → битовая карта → контуры → кривые Безье. Никакой модели здесь нет,
 * и результат воспроизводим байт в байт.
 *
 * Три режима — три набора настроек, как у любого трассировщика:
 *  - smart: порог по Оцу, средний шумодав, обычное сглаживание;
 *  - clean: выше порог (уходит светлая штриховка рубчика), сильный
 *    шумодав, мягче кривые — чистый контур для лекальщика;
 *  - detailed: ниже порог, шумодав почти выключен, кривые точнее —
 *    остаются пунктир строчек и тонкие линии.
 *
 * Вектор — иллюстрация, а не источник размеров: размеры живут в табеле.
 */
export const TRACE_MODES = ['smart', 'clean', 'detailed'] as const;
export type TraceMode = (typeof TRACE_MODES)[number];

export const TRACE_MODE_LABEL_RU: Record<TraceMode, string> = {
  smart: 'Умная',
  clean: 'Чистая',
  detailed: 'Детальная',
};

const INK = '#0E0E0E';

const PRESETS: Record<TraceMode, PotraceOptions> = {
  smart: { threshold: -1, turdSize: 8, alphaMax: 1.0, optCurve: true, optTolerance: 0.2 },
  clean: { threshold: 120, turdSize: 30, alphaMax: 1.25, optCurve: true, optTolerance: 0.35 },
  detailed: { threshold: 175, turdSize: 2, alphaMax: 0.7, optCurve: true, optTolerance: 0.08 },
};

export interface TraceResult {
  svg: string;
  mode: TraceMode;
  /** Сколько субконтуров получилось — грубая мера детализации. */
  subpaths: number;
}

/** Трассировать растр (PNG или JPEG) в SVG одним путём заливкой цветом линии. */
export function traceSketch(bytes: Buffer, mode: TraceMode = 'smart'): Promise<TraceResult> {
  const options: PotraceOptions = {
    ...PRESETS[mode],
    turnPolicy: 'minority',
    blackOnWhite: true,
    color: INK,
    background: 'transparent',
  };
  return new Promise((resolve, reject) => {
    trace(bytes, options, (error, svg) => {
      if (error) return reject(error);
      resolve({ svg: tidy(svg, mode), mode, subpaths: (svg.match(/M\s?-?\d/g) ?? []).length });
    });
  });
}

/**
 * Привести SVG к форме документа: viewBox вместо фиксированных размеров,
 * заголовок для чтения с экрана, цвет линии из токенов.
 */
function tidy(svg: string, mode: TraceMode): string {
  const size = /<svg[^>]*width="(\d+(?:\.\d+)?)"[^>]*height="(\d+(?:\.\d+)?)"/.exec(svg);
  let out = svg;
  if (size) {
    out = out.replace(
      /<svg[^>]*>/,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size[1]} ${size[2]}" width="100%" height="100%" ` +
        `preserveAspectRatio="xMidYMid meet" data-trace="${mode}">` +
        `<title>Технический эскиз, трассировка (${TRACE_MODE_LABEL_RU[mode]})</title>`,
    );
  }
  return out;
}
export * from './strokes.js';
