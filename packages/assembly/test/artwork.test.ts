import { describe, expect, it } from 'vitest';
import { kb } from '@seamsterly/kb';
import { buildArtwork, type ArtworkEngineInput } from '../src/index.js';

const base = kb();

const run = (over: Partial<ArtworkEngineInput> = {}) =>
  buildArtwork(
    {
      category: 'tshirt',
      placements: [{ zone: 'chest_center' }],
      fabric_class: 'single_jersey',
      quantity: 100,
      ...over,
    },
    base,
  )!;

const first = (r: ReturnType<typeof run>) => r.artwork.placements[0]!;

/**
 * Заказ с принтом спотыкается всегда об одно и то же: положение указано
 * словами, техника выбрана не под полотно, файл пришёл без физического
 * размера. Здесь проверяется, что каждый из трёх случаев закрыт.
 */
describe('движок нанесения', () => {
  it('без макетов раздела нет вовсе', () => {
    expect(buildArtwork({ category: 'tshirt', placements: [] }, base)).toBeNull();
  });

  it('положение всегда в сантиметрах от названной точки', () => {
    const a = first(run());
    expect(a.anchor_label_ru).toContain('высшей точки плеча');
    expect(typeof a.offset_from_anchor_cm.value).toBe('number');
  });

  it('не заданные заказчиком размер и отступ помечены предположением', () => {
    const a = first(run());
    expect(a.offset_from_anchor_cm.confidence).toBe('assumption');
    expect(a.size_cm.width.confidence).toBe('assumption');
  });

  it('заданные заказчиком — его словом', () => {
    const a = first(run({ placements: [{ zone: 'chest_center', width_cm: 20, offset_cm: 7 }] }));
    expect(a.size_cm.width.confidence).toBe('user_input');
    expect(a.offset_from_anchor_cm.value).toBe(7);
  });
});

describe('подбор техники', () => {
  it('на большом тираже выбирает шелкографию, на штучном — нет', () => {
    expect(first(run({ quantity: 200 })).technique.value).toBe('screen');
    expect(first(run({ quantity: 5 })).technique.value).not.toBe('screen');
  });

  it('сублимацию на хлопок не ставит — это химия, а не предпочтение', () => {
    const chosen = first(run({ fabric_class: 'single_jersey' })).technique.value;
    expect(chosen).not.toBe('sublimation');
  });

  it('выбор заказчика уважает, но о несовместимости говорит вслух', () => {
    const r = run({
      fabric_class: 'single_jersey',
      placements: [{ zone: 'chest_center', technique: 'sublimation' }],
    });
    expect(first(r).technique.value).toBe('sublimation');
    expect(first(r).technique.confidence).toBe('user_input');
    expect(r.notes.some((n) => n.includes('не ложится'))).toBe(true);
  });

  it('подобранная техника несёт указание согласовать с печатником', () => {
    expect(first(run()).technique.note).toContain('печатник');
  });
});

describe('цвета', () => {
  it('у плашечной техники число цветов не указано — считаем за один и говорим почему', () => {
    const a = first(run({ quantity: 200 }));
    expect(a.colors.model).toBe('spot');
    expect(a.colors.count?.confidence).toBe('assumption');
  });

  it('перебор цветов для плашечной печати попадает в предупреждения', () => {
    const a = first(
      run({ quantity: 200, placements: [{ zone: 'chest_center', color_count: 12 }] }),
    );
    expect(a.warnings_ru.some((w) => w.includes('12'))).toBe(true);
  });

  it('у полноцветной техники число цветов ни на что не влияет и об этом сказано', () => {
    const a = first(run({ quantity: 5, placements: [{ zone: 'chest_center', color_count: 8 }] }));
    expect(a.colors.model).toBe('full');
    expect(a.colors.count).toBeNull();
    expect(a.warnings_ru.some((w) => w.includes('полноцветная'))).toBe(true);
  });

  it('коды цветов не выдумываются', () => {
    expect(first(run()).colors.codes).toEqual([]);
  });
});

describe('светофор макета', () => {
  const withFile = (over: Record<string, unknown>) =>
    first(
      run({
        placements: [
          {
            zone: 'chest_center',
            width_cm: 25,
            height_cm: 30,
            file: { name: 'art.png', format: 'png', ...over },
          },
        ],
      }),
    ).checks;

  const status = (checks: ReturnType<typeof withFile>, id: string) =>
    checks.find((c) => c.id === id)?.status;

  it('без файла печатать нельзя, и это сказано прямо', () => {
    expect(status(first(run()).checks, 'file_present')).toBe('fail');
  });

  it('разрешение считается НА ЗАДАННЫЙ размер отпечатка, а не само по себе', () => {
    // 3000 px на 25 см — это 305 dpi, годится. Тот же файл на 60 см — нет.
    expect(status(withFile({ pixels: { width: 3000, height: 3600 } }), 'dpi')).toBe('ok');
    const big = first(
      run({
        placements: [
          {
            zone: 'chest_center',
            width_cm: 60,
            height_cm: 70,
            file: { name: 'art.png', format: 'png', pixels: { width: 3000, height: 3600 } },
          },
        ],
      }),
    ).checks;
    expect(status(big, 'dpi')).not.toBe('ok');
  });

  it('у вектора разрешения нет и вопроса о нём тоже', () => {
    const checks = first(
      run({
        placements: [{ zone: 'chest_center', file: { name: 'art.svg', format: 'svg' } }],
      }),
    ).checks;
    expect(status(checks, 'vector')).toBe('ok');
    expect(status(checks, 'dpi')).toBeUndefined();
  });

  it('непрозрачный фон напечатается прямоугольником, и об этом предупреждают', () => {
    expect(status(withFile({ transparent: false }), 'transparency')).toBe('warn');
  });

  it('физический размер отпечатка есть всегда — это главный вопрос печатника', () => {
    expect(status(first(run()).checks, 'physical_size')).toBeUndefined();
    expect(status(withFile({}), 'physical_size')).toBe('ok');
  });

  it('вышивка требует программы, и это отдельная работа', () => {
    const checks = first(
      run({
        placements: [
          { zone: 'chest_center', technique: 'embroidery', file: { name: 'a.svg', format: 'svg' } },
        ],
      }),
    ).checks;
    expect(checks.some((c) => c.id === 'embroidery_program')).toBe(true);
  });
});

describe('зоны', () => {
  it('ограничения по швам едут в документ, а не остаются в справочнике', () => {
    expect(first(run()).warnings_ru.length).toBeGreaterThan(0);
  });

  it('карман кенгуру срезает низ грудной зоны — у худи об этом сказано', () => {
    const a = first(run({ category: 'hoodie', placements: [{ zone: 'pocket_front' }] }));
    expect(a.warnings_ru.join(' ')).toContain('карман');
  });

  it('зона чужой категории не роняет сборку, а предупреждает', () => {
    const a = first(run({ category: 'tshirt', placements: [{ zone: 'hood' }] }));
    expect(a.warnings_ru.some((w) => w.includes('не предусмотрена'))).toBe(true);
  });

  it('нанесение всегда помечено как работа подрядчика', () => {
    expect(run().artwork.subcontracted).toBe(true);
    expect(run().notes.some((n) => n.includes('отдельный подрядчик'))).toBe(true);
  });
});
