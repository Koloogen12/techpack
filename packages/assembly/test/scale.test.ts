import { describe, expect, it } from 'vitest';
import { kb } from '@seamster/kb';
import { buildMeasurements, type PomInput, type ScaleObservation } from '../src/index.js';

const base = kb();

const INPUT: PomInput = {
  category: 'tshirt',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'semi_fitted',
  fabric_kind: 'knit',
  size_range: [42, 44, 46, 48, 50, 52],
};

const A4_LONG = 29.7;

/** Наблюдение листа А4, дающее ровно `cm` по опорной величине. */
const sheet = (cm: number, over: Partial<ScaleObservation> = {}): ScaleObservation => ({
  kind: 'a4_sheet',
  side: 'long_side',
  ratio_to_anchor: A4_LONG / cm,
  coplanar: true,
  confidence: 'high',
  ...over,
});

const run = (scale?: ScaleObservation) =>
  buildMeasurements(scale ? { ...INPUT, scale } : INPUT, base);

const chestOf = (r: ReturnType<typeof run>) => r.measurements.points.find((p) => p.code === 'T03')!;

/**
 * Масштабный объект — единственное, что снимает монокулярную неоднозначность:
 * с одной фотографии абсолютный размер не получить в принципе. Поэтому здесь
 * проверяется не «похоже на правду», а арифметика: известный размер, делённый
 * на отношение, обязан давать ровно ту величину, которую туда положили.
 */
describe('масштаб по предмету известного размера', () => {
  it('пересчитывает кадр в сантиметры точно', () => {
    expect(chestOf(run(sheet(52))).base.value).toBe(52);
  });

  it('размер предмета берётся из справочника, а не со слов модели', () => {
    // Отношение то же, а сторона объявлена короткой — результат обязан
    // посчитаться от 21 см, а не от 29.7.
    const short = run({ ...sheet(52), side: 'short_side' });
    expect(chestOf(short).base.value).toBeCloseTo((21 / (A4_LONG / 52)) as number, 1);
  });

  it('поднимает статус опорной точки до измерения', () => {
    expect(chestOf(run(sheet(52))).base.confidence).toBe('measured_by_scale');
    expect(chestOf(run()).base.confidence).toBe('default_from_base');
  });

  it('остальные точки остаются оценкой — правильный масштаб не чинит пропорцию', () => {
    const withScale = run(sheet(52));
    const others = withScale.measurements.points.filter((p) => p.code !== 'T03');
    expect(others.every((p) => p.base.confidence !== 'measured_by_scale')).toBe(true);
  });

  it('предмет не в плоскости изделия отвергается и объясняется', () => {
    const r = run(sheet(52, { coplanar: false }));
    expect(chestOf(r).base.confidence).toBe('default_from_base');
    expect(r.notes.some((n) => n.includes('не в плоскости'))).toBe(true);
  });

  it('неуверенное распознавание краёв отвергается', () => {
    const r = run(sheet(52, { confidence: 'low' }));
    expect(chestOf(r).base.confidence).toBe('default_from_base');
    expect(r.notes.some((n) => n.includes('неуверенно'))).toBe(true);
  });

  it('неправдоподобный результат отвергается — предмет опознан неверно', () => {
    // Отношение вдесятеро меньше настоящего даёт изделие в три метра шириной.
    const r = run(sheet(500));
    expect(chestOf(r).base.confidence).toBe('default_from_base');
    expect(r.notes.some((n) => n.includes('опознан неверно'))).toBe(true);
  });

  it('нулевое отношение — не масштаб, а отсутствие предмета', () => {
    const r = run({ ...sheet(52), ratio_to_anchor: 0 });
    expect(chestOf(r).base.confidence).toBe('default_from_base');
  });

  it('kind none не порождает ни расчёта, ни жалоб', () => {
    const r = run({ ...sheet(52), kind: 'none' });
    expect(chestOf(r).base.value).toBe(chestOf(run()).base.value);
    expect(r.notes.some((n) => n.includes('масштаб'))).toBe(false);
  });

  it('расхождение с заявленным размером — находка, а не сбой', () => {
    // По сетке RU 46 обычная посадка даёт 50.5. Вещь на снимке — 44.
    const r = run(sheet(44));
    const note = r.notes.find((n) => n.includes('расходятся'));
    expect(note).toBeDefined();
    expect(note).toContain('%');
    // Документ всё равно собирается по измерению: оно ближе к факту.
    expect(chestOf(r).base.value).toBe(44);
  });

  it('совпадение в пределах пяти процентов о расхождении не сообщает', () => {
    const r = run(sheet(51));
    expect(r.notes.some((n) => n.includes('расходятся'))).toBe(false);
  });

  it('все точки следуют за измеренным якорем, а не за сеткой', () => {
    const wide = run(sheet(60));
    const narrow = run(sheet(40));
    const hem = (r: ReturnType<typeof run>) =>
      r.measurements.points.find((p) => p.code === 'T05')!.base.value;
    expect(hem(wide)).toBeGreaterThan(hem(narrow));
  });
});
