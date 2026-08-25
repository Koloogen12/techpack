/**
 * Промпт генерации бесшовного раппорта.
 *
 * Версия входит в ключ кэша: правка текста меняет ключ и требует пересборки
 * тайлов. То же правило, что у vision и у визуализации (ADR-0003).
 */
export const TILE_PROMPT_VERSION = 'v1';

export interface TilePromptOptions {
  /** Что нарисовать. Приходит от пользователя своими словами. */
  brief: string;
  /** Плотность раскладки мотивов. */
  density?: 'sparse' | 'balanced' | 'dense';
  /** Ограничение палитры: сколько цветов держать. */
  colors?: number;
}

const DENSITY_EN: Record<string, string> = {
  sparse: 'motifs placed sparsely with generous empty ground between them',
  balanced: 'motifs evenly distributed with a balanced amount of ground showing',
  dense: 'motifs packed densely with very little empty ground',
};

/**
 * Описание тайла на английском.
 *
 * Требование бесшовности повторено трижды и разными словами намеренно:
 * это единственное свойство, ради которого тайл вообще существует, и модель
 * теряет его первым. Проверяем мы всё равно пикселями — но чем чаще она
 * попадает с первого раза, тем дешевле модуль.
 */
export function buildTilePrompt(options: TilePromptOptions): string {
  const density = DENSITY_EN[options.density ?? 'balanced']!;
  const palette =
    options.colors !== undefined
      ? `Use a limited palette of about ${options.colors} colours — flat, printable colours.`
      : 'Use a limited, flat, printable palette.';

  return [
    'A seamless repeating tile for textile printing, drawn from the reference images.',
    'The pattern must tile perfectly: the right edge continues exactly into the left edge,',
    'and the bottom edge continues exactly into the top edge, with no visible seam, no border,',
    'no frame and no fade at any edge. Motifs that touch an edge are cut there and continue',
    'on the opposite side.',
    '',
    `Take the motifs from the reference images and lay them out as a repeat: ${density}.`,
    'Keep the motifs recognisable and keep their character — this is the same artwork,',
    'arranged into a repeat, not a new drawing.',
    palette,
    '',
    'Flat, even, front-on view of the pattern only. No garment, no fabric folds, no shadows,',
    'no lighting gradient, no perspective, no mockup, no text, no watermark, no signature.',
    'Fill the entire square frame edge to edge. Square 1:1 format.',
  ].join('\n');
}
