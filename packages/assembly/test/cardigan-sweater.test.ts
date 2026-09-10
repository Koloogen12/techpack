import { describe, expect, it } from 'vitest';
import { kb } from '@seamster/kb';
import { buildStyleSpec, type StyleSpecInput } from '../src/index.js';

const base = kb();

const input = (category: 'cardigan' | 'sweater'): StyleSpecInput => ({
  id: category,
  name: category === 'cardigan' ? 'Кардиган на пуговицах' : 'Свитер',
  article: 'KN-001',
  category,
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'semi_fitted',
  fabric_kind: 'knit',
  size_range: [44, 46, 48],
  generated_at: new Date('2026-09-10T00:00:00.000Z'),
});

const value = (spec: ReturnType<typeof buildStyleSpec>['spec'], code: string): number =>
  spec.measurements.points.find((p) => p.code === code)!.base.value;

/**
 * Собранная спецификация вязаного верха.
 *
 * Справочник проверяется отдельно; здесь важно, что из него ВЫШЛО: кардиган
 * обязан прийти к фабрике распашным и с пуговицами в закупке, свитер —
 * цельным и без единой строки фурнитуры. Разница между ними должна быть
 * видна числом, а не только словом в названии.
 */
describe('кардиган и свитер: собранная спецификация', () => {
  const cardigan = buildStyleSpec(input('cardigan')).spec;
  const sweater = buildStyleSpec(input('sweater')).spec;

  it('масштаб считается от обхвата груди сетки плюс прибавка категории', () => {
    // RU 46 женская: грудь 92 см. Свитер полуприлегающий +10 → (92+10)/2 = 51.
    // Кардиган на той же посадке +12 → 52: он надевается поверх свитера.
    expect(value(sweater, 'T03')).toBe(51);
    expect(value(cardigan, 'T03')).toBe(52);
  });

  it('кардиган шире свитера на каждой посадке — лишний слой виден числом', () => {
    for (const fit of ['fitted', 'semi_fitted', 'loose', 'oversize'] as const) {
      const c = buildStyleSpec({ ...input('cardigan'), fit_intent: fit }).spec;
      const s = buildStyleSpec({ ...input('sweater'), fit_intent: fit }).spec;
      expect(value(c, 'T03'), fit).toBeGreaterThan(value(s, 'T03'));
    }
  });

  it('длина планки равна длине от плеча минус глубина горловины переда', () => {
    // Тождество, а не приближение: планка идёт от края горловины до низа.
    // Пока такое считалось своей пропорцией, документ противоречил сам себе
    // на несколько сантиметров внутри одной таблицы.
    expect(value(cardigan, 'Z01')).toBeCloseTo(value(cardigan, 'T01') - value(cardigan, 'T15'), 5);
  });

  it('в размерном ряду растёт планка, а не пуговица и не шаг петель', () => {
    const graded = (code: string): number[] =>
      cardigan.measurements.points.find((p) => p.code === code)!.graded.map((g) => g.value.value);
    // Планка длиннее на большем размере: с ней растёт и лента петель.
    const lengths = graded('Z01');
    expect(lengths.length).toBeGreaterThan(1);
    expect(lengths.at(-1)!).toBeGreaterThan(lengths[0]!);
    // Ширина планки и шаг петель в ряду не двигаются: oversize не делает
    // пуговицу больше. На длинной планке просто помещается лишняя петля.
    for (const code of ['Z02', 'Z03']) expect(graded(code), code).toEqual([]);
  });

  it('у свитера точек застёжки нет ни одной', () => {
    const codes = sweater.measurements.points.map((p) => p.code);
    for (const code of ['Z01', 'Z02', 'Z03']) expect(codes, code).not.toContain(code);
  });

  it('в конструкции кардигана есть застёжка, у свитера этой зоны нет вовсе', () => {
    const zones = (spec: typeof cardigan): string[] =>
      (spec.construction?.nodes ?? []).map((n) => n.zone);
    expect(zones(cardigan)).toContain('closure');
    expect(zones(sweater)).not.toContain('closure');

    const ids = (spec: typeof cardigan): string[] =>
      (spec.construction?.nodes ?? []).map((n) => n.node_id);
    expect(ids(cardigan)).toContain('cardigan_placket');
    expect(ids(cardigan)).toContain('button_sew');
    expect(ids(sweater)).not.toContain('cardigan_placket');
  });

  it('технологическая последовательность идёт подряд и кончается упаковкой', () => {
    for (const [name, category] of [
      ['кардиган', 'cardigan'],
      ['свитер', 'sweater'],
    ] as const) {
      const seq = base.categoryDefaultsFor(category, 'knit').tech_sequence;
      expect(
        seq.map((o) => o.step),
        name,
      ).toEqual(seq.map((_, i) => i + 1));
      expect(seq[0]!.operation_ru, name).toContain('плечев');
      expect(seq.at(-1)!.operation_ru, name).toContain('упаков');
      // Операция без узла обязана называть оборудование, иначе цеху нечем
      // её нормировать.
      for (const op of seq) {
        if (op.node_id === null) expect(op.machine, `${name}/${op.step}`).toBeTruthy();
      }
    }
  });

  it('в закупке кардигана есть пуговица, у свитера фурнитуры нет', () => {
    const hardware = (spec: typeof cardigan): string[] =>
      (spec.bom?.lines ?? []).filter((l) => l.role === 'hardware').map((l) => l.material_id);
    expect(hardware(cardigan)).toContain('button_cardigan');
    expect(hardware(sweater)).toEqual([]);
  });

  it('основное полотно у обоих — вязаное из пряжи, и его состав предположение', () => {
    for (const [name, spec] of [
      ['кардиган', cardigan],
      ['свитер', sweater],
    ] as const) {
      const shell = (spec.bom?.lines ?? []).find((l) => l.role === 'shell')!;
      expect(shell.material_id, name).toBe('wool_knit_jersey');
      // Состав и плотность с фото не определяются никогда — они обязаны
      // уходить в документ предположением, а не типовым артикулом.
      expect(shell.composition.confidence, name).toBe('assumption');
    }
  });

  it('длина следует за ростом, ширина — за размером', () => {
    const at = (height: number, size: number, code: string): number =>
      value(
        buildStyleSpec({ ...input('sweater'), base_height_cm: height, base_size_ru: size }).spec,
        code,
      );
    expect(at(182, 46, 'T01')).toBeGreaterThan(at(158, 46, 'T01'));
    expect(at(170, 48, 'T03')).toBeGreaterThan(at(170, 44, 'T03'));
  });

  it('градация не убывает ни в одной точке', () => {
    for (const [name, spec] of [
      ['кардиган', cardigan],
      ['свитер', sweater],
    ] as const) {
      for (const p of spec.measurements.points) {
        const values = p.graded.map((g) => g.value.value);
        for (let i = 1; i < values.length; i++) {
          expect(values[i], `${name}/${p.code}`).toBeGreaterThanOrEqual(values[i - 1]! - 0.001);
        }
      }
    }
  });
});
