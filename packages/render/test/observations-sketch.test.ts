import { describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '@seamster/assembly';
import {
  buildRenderPrompt,
  buildSketchPrompt,
  observationLines,
  sketchChecklist,
  sketchCorrections,
  sketchMismatch,
} from '../src/index.js';

/**
 * Словари наблюдений доходят до художника и до сторожа теми же словами.
 */
const INPUT: StyleSpecInput = {
  id: 'obs-sketch',
  name: 'Джемпер',
  article: 'OBS-SK-1',
  category: 'sweater',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'fitted',
  fabric_kind: 'knit',
  size_range: [44, 46, 48],
  generated_at: new Date('2026-09-24T00:00:00.000Z'),
  observations: {
    neckline: { value: 'v_notch_zip', confidence: 'high' },
    closure: { value: 'zip_asymmetric', confidence: 'high' },
    cuff: { value: 'turned_hem', confidence: 'medium' },
    hem: { value: 'turned_hem', confidence: 'medium' },
    pocket: { value: 'none', confidence: 'high' },
    sleeve: { value: 'set_in', confidence: 'low' },
    sleeve_length: { value: 'long', confidence: 'high' },
    hood: { value: 'not_visible', confidence: 'high' },
  },
};

describe('наблюдения в задании художнику и у сторожа', () => {
  const spec = buildStyleSpec(INPUT).spec;

  it('спека хранит наблюдения, задание перечисляет уверенные и видимые', () => {
    expect(spec.design?.observations?.neckline.value).toBe('v_notch_zip');
    const lines = observationLines(spec);
    expect(lines.some((l) => /collarless V-notch/.test(l))).toBe(true);
    expect(lines.some((l) => /asymmetric off-centre zipper/.test(l))).toBe(true);
    // low и not_visible не идут.
    expect(lines.some((l) => /set-in sleeves/.test(l))).toBe(false);
    expect(lines.some((l) => /hood/.test(l))).toBe(false);
    const prompt = buildSketchPrompt(spec, { fromPhoto: true });
    expect(prompt).toContain('Observed on the garment and mandatory on the drawing');
    expect(prompt).toContain('collarless V-notch neckline');
    expect(buildRenderPrompt(spec)).toContain('Observed on the garment');
  });

  it('чек-лист сторожа начинается с наблюдений, уверенность — из словаря', () => {
    const list = sketchChecklist(spec);
    const neck = list.find((i) => i.id === 'o_neckline')!;
    expect(neck.certainty).toBe('high');
    expect(neck.ru).toMatch(/горловина/);
    expect(list.find((i) => i.id === 'o_cuff')!.certainty).toBe('medium');
    expect(list.find((i) => i.id === 'o_sleeve')).toBeUndefined();
  });

  it('уверенное наблюдение, которого на листе нет, бракует лист и даёт поправку', () => {
    const seen = {
      category: 'sweater',
      elements: {
        hood: false,
        closure: 'zip' as const,
        pocket: 'none' as const,
        sleeve: 'long' as const,
      },
      features: [{ id: 'o_neckline', seen: 'no' as const }],
    };
    expect(sketchMismatch(spec, seen)).toMatch(/горловина/);
    const fixes = sketchCorrections(spec, seen);
    expect(fixes.some((f) => /collarless V-notch/.test(f))).toBe(true);
  });

  it('поправки называют и структурные расхождения — капюшон, застёжку, рукав', () => {
    const seen = {
      category: 'hoodie',
      elements: {
        hood: true,
        closure: 'none' as const,
        pocket: 'kangaroo' as const,
        sleeve: 'short' as const,
      },
    };
    const fixes = sketchCorrections(spec, seen);
    expect(fixes).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/not a hoodie/),
        'it has no hood',
        'it has a visible zipper',
        'it has no pockets',
        expect.stringMatching(/long, to the wrist/),
      ]),
    );
    const corrected = buildSketchPrompt(spec, { fromPhoto: true, corrections: fixes });
    expect(corrected).toContain('A previous drawing of this garment was rejected');
    expect(corrected).toContain('it has no hood');
  });
});
