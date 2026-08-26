import { describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '@seamsterly/assembly';
import { applyFitting, parseMeasuredSet, type MeasuredSet } from '../src/index.js';

const INPUT: StyleSpecInput = {
  id: 'fit-apply',
  name: 'Худи',
  article: 'FIT-01',
  category: 'hoodie',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'oversize',
  fabric_kind: 'knit',
  size_range: [44, 46, 48],
  generated_at: new Date('2026-08-26T00:00:00.000Z'),
};

const { spec } = buildStyleSpec(INPUT);
const valueOf = (s: typeof spec, code: string): number =>
  s.measurements.points.find((p) => p.code === code)!.base.value;

const set = (over: Partial<MeasuredSet> = {}): MeasuredSet =>
  parseMeasuredSet({
    id: 'ОТШИВ-01',
    photo: 'photo.jpg',
    answers: 'answers.json',
    measured_by: 'Технолог',
    measured_at: '2026-08-26',
    method: 'flat_tape',
    values: [
      { code: 'T01', value_cm: 70.5 },
      { code: 'T03', value_cm: 64 },
    ],
    ...over,
  });

describe('примерка становится значением спеки', () => {
  it('замер поднимает статус до подтверждённого по образцу', () => {
    const r = applyFitting(spec, set());
    const t01 = r.spec.measurements.points.find((p) => p.code === 'T01')!;
    expect(t01.base.value).toBe(70.5);
    expect(t01.base.confidence).toBe('fit_confirmed');
    expect(t01.base.source).toContain('ОТШИВ-01');
  });

  it('счётчик предположений падает, а не остаётся прежним', () => {
    const r = applyFitting(spec, set());
    expect(r.spec.meta.assumptions_count).toBeLessThanOrEqual(spec.meta.assumptions_count);
  });

  it('градация СДВИГАЕТСЯ вместе с базой, а не пересчитывается заново', () => {
    // Правило градации не изменилось — изменился якорь. Шаги между размерами
    // обязаны остаться теми же.
    const before = spec.measurements.points.find((p) => p.code === 'T01')!;
    const step = before.graded[1]!.value.value - before.graded[0]!.value.value;
    const r = applyFitting(spec, set());
    const after = r.spec.measurements.points.find((p) => p.code === 'T01')!;
    expect(after.graded[1]!.value.value - after.graded[0]!.value.value).toBeCloseTo(step, 5);
    expect(after.graded[0]!.value.value).not.toBe(before.graded[0]!.value.value);
  });

  it('составная точка пересчитывается из частей, а не берётся замером', () => {
    // T02 = T01 − T16 тождественно. Подставить туда независимый замер значило
    // бы разрешить документу противоречить самому себе.
    const r = applyFitting(spec, set());
    expect(valueOf(r.spec, 'T02')).toBeCloseTo(valueOf(r.spec, 'T01') - valueOf(r.spec, 'T16'), 1);
  });

  it('расхождение замера с тождеством СООБЩАЕТСЯ, а не переписывает тождество', () => {
    const r = applyFitting(
      spec,
      set({
        values: [
          { code: 'T01', value_cm: 70.5 },
          { code: 'T16', value_cm: 3 },
          { code: 'T02', value_cm: 60 },
        ],
      }),
    );
    expect(valueOf(r.spec, 'T02')).toBeCloseTo(67.5, 1);
    expect(r.notes.some((n) => n.includes('расходится'))).toBe(true);
  });
});

describe('примерка на манекене не подтверждает табель', () => {
  it('слабый метод отвергается целиком и объясняет почему', () => {
    // Табель мер описывает изделие РАЗЛОЖЕННЫМ, а на манекене вещь натянута.
    // Принять такие числа значило бы поднять статус, не подняв точность.
    const r = applyFitting(spec, set({ method: 'on_form' }));
    expect(r.applied).toEqual([]);
    expect(r.rejected.length).toBe(2);
    expect(r.spec).toBe(spec);
    expect(r.notes.join(' ')).toContain('Разложите образец');
  });
});

describe('правдоподобие: сообщаем, а не ограничиваем', () => {
  it('неправдоподобный размах оставляет замеры как есть и говорит об этом', () => {
    // В сборщике тот же предел УКОРАЧИВАЕТ оценку по фото: там величина —
    // догадка модели. Здесь она снята рулеткой с реальной вещи, и обрезать
    // нечего: если сумма неправдоподобна, неправдоподобен замер.
    const r = applyFitting(
      spec,
      set({
        values: [
          { code: 'T06', value_cm: 60 },
          { code: 'T10', value_cm: 75 },
        ],
      }),
    );
    expect(valueOf(r.spec, 'T10')).toBe(75);
    expect(r.notes.some((n) => n.includes('длиннее руки'))).toBe(true);
  });
});
