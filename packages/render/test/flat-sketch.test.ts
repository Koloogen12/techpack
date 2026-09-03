import { describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '@seamster/assembly';
import type { StyleSpec } from '@seamster/stylespec';
import {
  buildSketchPrompt,
  sketchFileName,
  sketchFingerprint,
  sketchMismatch,
  type SketchSeen,
} from '../src/index.js';

const AT = new Date('2026-09-03T00:00:00.000Z');

const INPUT: StyleSpecInput = {
  id: 'sketch-test',
  name: 'Худи',
  article: 'SK-001',
  category: 'hoodie',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'oversize',
  fabric_kind: 'knit',
  size_range: [42, 44, 46, 48, 50, 52],
  generated_at: AT,
};

const spec = (over: Partial<StyleSpecInput> = {}): StyleSpec =>
  buildStyleSpec({ ...INPUT, ...over }).spec;

const HOODIE = spec();
const TSHIRT = spec({ category: 'tshirt' });

const seen = (over: Partial<SketchSeen['elements']> = {}, category = 'hoodie'): SketchSeen => ({
  category,
  elements: { hood: true, closure: 'none', pocket: 'kangaroo', sleeve: 'long', ...over },
});

describe('промпт эскиза — проекция узлов', () => {
  it('просит два вида одним листом: порознь модель рисует две разные вещи', () => {
    const p = buildSketchPrompt(HOODIE);
    expect(p).toContain('TWO views of the SAME');
    expect(p).toContain('identical width and length');
  });

  it('узлы худи названы поимённо, а не категорией вообще', () => {
    const p = buildSketchPrompt(HOODIE);
    expect(p).toContain('kangaroo pocket');
    expect(p).toContain('drawcord casing');
    expect(p).toContain('eyelets');
  });

  it('на спинке нет кармана, шнура и люверсов', () => {
    const back = buildSketchPrompt(HOODIE).split('Back shows:')[1] ?? '';
    expect(back).not.toContain('pocket');
    expect(back).not.toContain('drawcord');
    expect(back).not.toContain('eyelet');
  });

  it('у футболки нет ни капюшона, ни кармана', () => {
    const p = buildSketchPrompt(TSHIRT);
    expect(p).not.toContain('hood');
    expect(p).not.toContain('kangaroo');
  });

  it('посадка попадает в описание', () => {
    expect(buildSketchPrompt(spec({ fit_intent: 'oversize' }))).toContain('oversized');
    expect(buildSketchPrompt(spec({ fit_intent: 'fitted' }))).toContain('close-fitting');
  });

  it('рисунок просится без текста, манекена и цвета: это чертёж, а не съёмка', () => {
    const p = buildSketchPrompt(HOODIE);
    for (const forbidden of ['no text', 'no mannequin', 'no colour', 'no shadow'])
      expect(p).toContain(forbidden);
  });

  it('артикул и имя отпечаток не меняют — иначе кэш промахивается впустую', () => {
    expect(sketchFingerprint(spec({ article: 'OTHER-9', name: 'Другое' }))).toBe(
      sketchFingerprint(HOODIE),
    );
  });

  it('смена категории отпечаток меняет', () => {
    expect(sketchFingerprint(TSHIRT)).not.toBe(sketchFingerprint(HOODIE));
  });
});

describe('сторож эскиза', () => {
  it('сошёлся — причины нет', () => {
    expect(sketchMismatch(HOODIE, seen())).toBeNull();
  });

  it('на входе худи, на выходе свитер — эскиз не принят', () => {
    expect(sketchMismatch(HOODIE, seen({}, 'sweatshirt'))).toContain('sweatshirt');
  });

  it('пропавший капюшон ловится', () => {
    expect(sketchMismatch(HOODIE, seen({ hood: false }))).toBe('на эскизе нет капюшона');
  });

  it('лишняя молния ловится: это ровно та ошибка, из-за которой всё затевалось', () => {
    expect(sketchMismatch(HOODIE, seen({ closure: 'zip' }))).toBe('на эскизе лишняя застёжка');
  });

  it('пропавший карман ловится', () => {
    expect(sketchMismatch(HOODIE, seen({ pocket: 'none' }))).toBe('на эскизе нет кармана');
  });

  it('подтип кармана не придирка: накладной вместо кенгуру проходит', () => {
    // Взгляд их путает, и отбраковка по подтипу выбрасывала бы верные эскизы.
    expect(sketchMismatch(HOODIE, seen({ pocket: 'patch' }))).toBeNull();
  });

  it('короткий рукав у худи ловится, у футболки — норма', () => {
    expect(sketchMismatch(HOODIE, seen({ sleeve: 'short' }))).toContain('рукав short');
    expect(
      sketchMismatch(TSHIRT, {
        category: 'tshirt',
        elements: { hood: false, closure: 'none', pocket: 'none', sleeve: 'short' },
      }),
    ).toBeNull();
  });

  it('неуверенное «other» по рукаву отказом не считается', () => {
    expect(sketchMismatch(HOODIE, seen({ sleeve: 'other' }))).toBeNull();
  });

  it('у футболки лишний капюшон ловится', () => {
    expect(
      sketchMismatch(TSHIRT, {
        category: 'tshirt',
        elements: { hood: true, closure: 'none', pocket: 'none', sleeve: 'short' },
      }),
    ).toBe('на эскизе лишний капюшон');
  });
});

describe('имя файла', () => {
  it('совпадает с типом картинки — расширению доверяют', () => {
    expect(sketchFileName('image/png')).toBe('sketch.png');
    expect(sketchFileName('image/jpeg')).toBe('sketch.jpg');
  });
});
