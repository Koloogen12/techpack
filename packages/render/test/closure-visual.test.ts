import { describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '@seamster/assembly';
import {
  buildRenderPrompt,
  buildSketchPrompt,
  effectiveVisual,
  sketchMismatch,
} from '../src/index.js';

const INPUT: StyleSpecInput = {
  id: 'closure-visual',
  name: 'Джемпер с молнией',
  article: 'ZIP-V-001',
  category: 'cardigan',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'fitted',
  fabric_kind: 'knit',
  size_range: [44, 46, 48],
  generated_at: new Date('2026-09-23T00:00:00.000Z'),
};

/**
 * Слово категории несёт застёжку: «button-through cardigan». Когда по фото
 * планку заменила молния, ни художник эскиза, ни художник визуализации не
 * должны слышать про пуговицы — иначе на картинке появляются обе застёжки.
 */
describe('застёжка в словах художника идёт за узлами', () => {
  const zipped = buildStyleSpec({
    ...INPUT,
    visible_elements: [
      { key: 'closure_type', value: 'диагональная молния от горловины к боку', confidence: 'high' },
    ],
  }).spec;
  const buttoned = buildStyleSpec(INPUT).spec;

  it('кардиган с молнией не называется button-through', () => {
    expect(effectiveVisual(zipped)).toMatch(/zip/);
    expect(effectiveVisual(zipped)).not.toMatch(/button-through/);
    expect(effectiveVisual(buttoned)).toMatch(/button-through/);
  });

  it('сторож не бракует свитер, увиденный как лонгслив: семья одна, а различия ловят узлы', () => {
    const sweater = buildStyleSpec({ ...INPUT, category: 'sweater', article: 'SW-1' }).spec;
    const seen = (category: string, hood = false) => ({
      category,
      elements: {
        hood,
        closure: 'none' as const,
        pocket: 'none' as const,
        sleeve: 'long' as const,
      },
    });
    expect(sketchMismatch(sweater, seen('longsleeve'))).toBeNull();
    expect(sketchMismatch(sweater, seen('sweatshirt'))).toBeNull();
    // Капюшон на листе свитера — другая вещь, семья не спасает.
    expect(sketchMismatch(sweater, seen('hoodie', true))).not.toBeNull();
    // Платье на листе свитера — другая семья.
    expect(sketchMismatch(sweater, seen('dress'))).toMatch(/dress/);
  });

  it('промпты эскиза и визуализации не упоминают пуговицы у молнии', () => {
    for (const prompt of [buildSketchPrompt(zipped), buildRenderPrompt(zipped)]) {
      expect(prompt).toMatch(/zipper/);
      expect(prompt).not.toMatch(/button/);
    }
    expect(buildRenderPrompt(buttoned)).toMatch(/button placket/);
  });
});
