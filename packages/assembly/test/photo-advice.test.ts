import { describe, expect, it } from 'vitest';
import { kb } from '@seamster/kb';
import {
  buildStyleSpec,
  suggestViews,
  viewAdviceNotes,
  type StyleSpecInput,
} from '../src/index.js';

const base = kb();
const INPUT: StyleSpecInput = {
  id: 'advice',
  name: 'Худи',
  article: 'ADV-001',
  category: 'hoodie',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'oversize',
  fabric_kind: 'knit',
  size_range: [42, 44, 46, 48, 50, 52],
  generated_at: new Date('2026-08-25T00:00:00.000Z'),
};

const { spec } = buildStyleSpec(INPUT);

/**
 * Совет по досъёмке — единственный способ поднять точность, который стоит
 * человеку полминуты, а не денег и не двух недель ожидания образца.
 * Поэтому он обязан быть посчитанным по факту, а не общим напутствием.
 */
describe('какой кадр доснять', () => {
  it('без фотографий вообще первым идёт кадр, закрывающий больше точек', () => {
    const advice = suggestViews(spec, [], base);
    expect(advice.length).toBeGreaterThan(0);
    expect(advice[0]!.codes.length).toBeGreaterThanOrEqual(advice.at(-1)!.codes.length);
  });

  it('уже присланный ракурс не предлагается', () => {
    const all = suggestViews(spec, [], base);
    const withBack = suggestViews(spec, ['back_flat'], base);
    expect(all.map((a) => a.view)).toContain('back_flat');
    expect(withBack.map((a) => a.view)).not.toContain('back_flat');
  });

  it('кадры, не дающие замеров, в совете не участвуют', () => {
    // Изнанка и съёмка на фигуре открывают конструкцию, но ни одного
    // сантиметра — предлагать их ради точности значит врать про пользу.
    const views = suggestViews(spec, [], base).map((a) => a.view);
    expect(views).not.toContain('inside_out');
    expect(views).not.toContain('on_form');
  });

  it('когда слабых точек нет, совета нет', () => {
    const confirmed = {
      ...spec,
      measurements: {
        ...spec.measurements,
        points: spec.measurements.points.map((p) => ({
          ...p,
          base: { ...p.base, confidence: 'fit_confirmed' as const },
        })),
      },
    };
    expect(suggestViews(confirmed, [], base)).toEqual([]);
  });

  it('совет словами называет и выигрыш, и как снимать', () => {
    const [note] = viewAdviceNotes(suggestViews(spec, [], base).slice(0, 1));
    expect(note).toContain('переведёт');
    expect(note).toContain('Как снимать');
  });

  it('числительное согласовано — «1 замер», «2 замера», «6 замеров»', () => {
    const shape = (n: number) =>
      viewAdviceNotes([
        {
          view: 'back_flat',
          label_ru: 'Спинка',
          how_to_shoot_ru: 'x',
          codes: Array(n).fill('T01'),
        },
      ])[0]!;
    expect(shape(1)).toContain('1 замер ');
    expect(shape(2)).toContain('2 замера');
    expect(shape(6)).toContain('6 замеров');
  });
});
