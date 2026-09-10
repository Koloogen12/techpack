import { describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '@seamster/assembly';
import { confirmMeasurement, setCareProfile } from '../src/index.js';

const INPUT: StyleSpecInput = {
  id: 'confirm',
  name: 'Футболка',
  article: 'CNF-001',
  category: 'tshirt',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'semi_fitted',
  fabric_kind: 'knit',
  size_range: [44, 46, 48],
  generated_at: new Date('2026-09-10T00:00:00.000Z'),
};

const { spec } = buildStyleSpec(INPUT);

/**
 * Подтверждение по образцу — не правка числа, а смена того, откуда мы это
 * число знаем. Для фабрики разница практическая: по подтверждённому замеру
 * она шьёт партию, по указанному ждёт образец.
 */
describe('подтверждение замера по образцу', () => {
  it('меняет статус, но не значение', () => {
    const before = spec.measurements.points.find((p) => p.code === 'T03')!;
    const { spec: after, rejected } = confirmMeasurement(spec, 'T03', true);
    const point = after.measurements.points.find((p) => p.code === 'T03')!;
    expect(rejected).toBeNull();
    expect(point.base.value).toBe(before.base.value);
    expect(point.base.confidence).toBe('fit_confirmed');
    expect(point.base.source).toContain('sample');
  });

  it('снятие возвращает «указано вами», а не оценку по фото', () => {
    // Прежний уровень восстановить неоткуда, а число человек видел
    // и оставил: занижать его до догадки значило бы соврать в другую сторону.
    const on = confirmMeasurement(spec, 'T03', true).spec;
    const off = confirmMeasurement(on, 'T03', false).spec;
    expect(off.measurements.points.find((p) => p.code === 'T03')!.base.confidence).toBe(
      'user_input',
    );
  });

  it('повторное подтверждение ничего не меняет', () => {
    const on = confirmMeasurement(spec, 'T03', true).spec;
    const again = confirmMeasurement(on, 'T03', true);
    expect(again.rejected).toBeNull();
    expect(again.spec).toBe(on);
  });

  it('составную точку подтвердить нельзя — она тождество своих частей', () => {
    const composed = spec.measurements.points.find((p) => ['T02', 'T10'].includes(p.code))!;
    const r = confirmMeasurement(spec, composed.code, true);
    expect(r.rejected).toContain('подтверждайте их');
  });

  it('несуществующая точка — отказ, а не молчание', () => {
    expect(confirmMeasurement(spec, 'Z99', true).rejected).toContain('нет в этом изделии');
  });

  it('счётчик предположений пересчитывается', () => {
    const after = confirmMeasurement(spec, 'T03', true).spec;
    expect(after.meta.assumptions_count).toBeGreaterThanOrEqual(0);
  });
});

/**
 * Набор символов ухода по умолчанию считается из состава полотна. Но бренд
 * знает про изделие то, чего состав не знает: вышивку, фурнитуру, отделку.
 */
describe('набор символов ухода', () => {
  it('деликатный набор заменяет типовой и попадает в маркировку', () => {
    const { spec: after, rejected } = setCareProfile(spec, 'delicate');
    expect(rejected).toBeNull();
    const ids = after.labels!.care_symbols.map((s) => s.id);
    expect(ids).toContain('tumble_none');
    expect(ids).toContain('iron_110');
    expect(ids).not.toEqual(spec.labels!.care_symbols.map((s) => s.id));
  });

  it('возврат к набору по составу работает', () => {
    const delicate = setCareProfile(spec, 'delicate').spec;
    const back = setCareProfile(delicate, 'cotton_knit').spec;
    expect(back.labels!.care_symbols.map((s) => s.id)).toEqual(
      spec.labels!.care_symbols.map((s) => s.id),
    );
  });

  it('неизвестный набор — отказ словами, а не пустой ярлык', () => {
    expect(setCareProfile(spec, 'нет-такого').rejected).toContain('нет в справочнике');
  });
});
