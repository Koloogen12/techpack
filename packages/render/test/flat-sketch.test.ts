import { describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '@seamster/assembly';
import type { StyleSpec } from '@seamster/stylespec';
import {
  DEFAULT_SKETCH_MODELS,
  extractImagesApi,
  isImagesApiModel,
  sketchModels,
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
  it('просит три вида одним листом: порознь модель рисует разные вещи', () => {
    const p = buildSketchPrompt(HOODIE);
    expect(p).toContain('THREE views of the SAME');
    expect(p).toContain('front view on the left, side profile view in the middle');
    expect(p).toContain('identical body length');
  });

  it('профиль описан своими словами, а не переписанным передом', () => {
    // В профиль читается другое: не мешок кармана, а его боковой вход;
    // не капюшон вообще, а его глубина.
    const side = buildSketchPrompt(HOODIE).split('Side profile shows:')[1]?.split('.')[0] ?? '';
    expect(side).toContain('depth of the hood');
    expect(side).toContain('side opening of the front pocket');
    expect(side).toContain('down the side of the body');
  });

  it('профиль не дорисовывает лицевую фурнитуру', () => {
    // Люверсы и кулиска в профиль не видны; нарисованные там — вымысел.
    const side = buildSketchPrompt(HOODIE).split('Side profile shows:')[1]?.split('.')[0] ?? '';
    expect(side).not.toContain('eyelet');
    expect(side).not.toContain('drawcord');
  });

  it('у футболки профиль тоже описан — есть боковой шов и подгибка', () => {
    const side = buildSketchPrompt(TSHIRT).split('Side profile shows:')[1]?.split('.')[0] ?? '';
    expect(side).toContain('down the side of the body');
    expect(side).not.toContain('hood');
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

describe('платье — первая вещь вне стритвира', () => {
  const DRESS = spec({ category: 'dress', name: 'Платье', article: 'DR-1' });

  it('промпт называет изделие платьем, а не удлинённым верхом', () => {
    expect(buildSketchPrompt(DRESS)).toContain('knit dress');
  });

  it('длина рукава у платья не проверяется: её выбирает дизайнер, а не категория', () => {
    // У футболки короткий рукав — признак категории, и длинный ловится
    // отбраковкой. У платья бывает любой, и придирка выбрасывала бы верные эскизы.
    for (const sleeve of ['long', 'short', 'none'] as const)
      expect(
        sketchMismatch(DRESS, {
          category: 'dress',
          elements: { hood: false, closure: 'none', pocket: 'none', sleeve },
        }),
      ).toBeNull();
  });

  it('а вот подмена изделия у платья ловится по-прежнему', () => {
    expect(
      sketchMismatch(DRESS, {
        category: 'tshirt',
        elements: { hood: false, closure: 'none', pocket: 'none', sleeve: 'short' },
      }),
    ).toContain('tshirt');
  });
});

describe('длина подола — главный признак цельного изделия', () => {
  const withLength = (cm: number) => {
    const s = spec({ category: 'dress' });
    const t01 = s.measurements.points.find((p) => p.code === 'T01')!;
    return {
      ...s,
      measurements: {
        ...s.measurements,
        points: s.measurements.points.map((p) =>
          p.code === 'T01' ? { ...t01, base: { ...t01.base, value: cm } } : p,
        ),
      },
    };
  };

  it('короткое платье и миди перестали быть одним и тем же', () => {
    // Отношение к груди даёт обеим «long and lean»: 80/50 и 105/50 попадают
    // в один бакет. Именно на этом эскиз рисовал платье миди там, где
    // в табеле стояли 80 см — вещь до середины бедра.
    expect(buildSketchPrompt(withLength(80))).toContain('mid thigh');
    expect(buildSketchPrompt(withLength(105))).toContain('midi length');
  });

  it('весь ряд длин различим', () => {
    expect(buildSketchPrompt(withLength(70))).toContain('tunic length');
    expect(buildSketchPrompt(withLength(93))).toContain('at the knee');
    expect(buildSketchPrompt(withLength(130))).toContain('maxi length');
  });

  it('у верха длина подола не называется: там она следует из категории', () => {
    expect(buildSketchPrompt(HOODIE)).not.toContain('hem falls');
  });
});

describe('эскиз от фотографии', () => {
  it('со снимком промпт требует ЭТУ вещь, а не вещь с такими узлами', () => {
    const p = buildSketchPrompt(HOODIE, { fromPhoto: true });
    expect(p).toContain('Reference photographs');
    expect(p).toContain('EXACTLY this garment');
    expect(p).toContain('add nothing the photographs do not show');
    // Узлы остаются чек-листом: без них модель теряет карман за складкой.
    expect(p).toContain('Front shows:');
    expect(p).toContain('follow the photographs');
  });

  it('без снимка промпт остаётся описанием по узлам', () => {
    const p = buildSketchPrompt(HOODIE);
    expect(p).not.toContain('Reference photographs');
    expect(p).toContain('THREE views of the SAME');
  });

  it('лист просится колонками одной ширины с просветом — иначе виды не вырезать', () => {
    for (const p of [buildSketchPrompt(HOODIE), buildSketchPrompt(HOODIE, { fromPhoto: true })]) {
      expect(p).toContain('equal-width column');
      expect(p).toContain('clear white gutter');
    }
  });
});

describe('цепочка моделей эскиза', () => {
  it('по умолчанию впереди gpt-image-2.5-flare, запасной — Gemini', () => {
    const saved = { a: process.env.SEAMSTER_SKETCH_MODELS, b: process.env.SEAMSTER_SKETCH_MODEL };
    delete process.env.SEAMSTER_SKETCH_MODELS;
    delete process.env.SEAMSTER_SKETCH_MODEL;
    expect(sketchModels()).toEqual([...DEFAULT_SKETCH_MODELS]);
    process.env.SEAMSTER_SKETCH_MODEL = 'gemini-3-pro-image';
    // Явная голова не отменяет запасных: они остаются следом.
    expect(sketchModels()).toEqual(['gemini-3-pro-image', 'gpt-image-2.5-flare']);
    process.env.SEAMSTER_SKETCH_MODELS = ' a , b ';
    expect(sketchModels()).toEqual(['a', 'b']);
    if (saved.a === undefined) delete process.env.SEAMSTER_SKETCH_MODELS;
    else process.env.SEAMSTER_SKETCH_MODELS = saved.a;
    if (saved.b === undefined) delete process.env.SEAMSTER_SKETCH_MODEL;
    else process.env.SEAMSTER_SKETCH_MODEL = saved.b;
  });

  it('gpt-image идёт через Images API, ответ — base64 в data[0]', () => {
    expect(isImagesApiModel('gpt-image-2.5-flare')).toBe(true);
    expect(isImagesApiModel('gemini-3-pro-image')).toBe(false);
    const png = Buffer.from([137, 80, 78, 71]).toString('base64');
    const got = extractImagesApi({ data: [{ b64_json: png }] });
    expect(got?.mediaType).toBe('image/png');
    expect([...(got?.bytes ?? [])]).toEqual([137, 80, 78, 71]);
    expect(extractImagesApi({ data: [{ url: 'https://x' }] })).toBeNull();
    expect(extractImagesApi({})).toBeNull();
  });
});
