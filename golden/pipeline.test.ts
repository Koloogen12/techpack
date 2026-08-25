import { describe, expect, it } from 'vitest';
import { buildStyleSpec } from '@specform/assembly';
import { parseStyleSpec, specFingerprint } from '@specform/stylespec';
import { SCENARIOS } from './scenarios.js';
import { checkSpec, confidenceBreakdown } from './invariants.js';

/**
 * Голден-сет: полный пайплайн на матрице реальных входов.
 *
 * Правило CTO-SPEC.md §4.7: голден-сет священен, деградация точности блокирует
 * мерж. Здесь проверяется не «работает ли код», а «остаётся ли документ
 * пригодным для фабрики» — на каждом сценарии одни и те же инварианты.
 */

describe.each(SCENARIOS)('$name', ({ why, input }) => {
  const { spec, notes } = buildStyleSpec(input);

  it(`собирается и проходит валидацию схемы — ${why}`, () => {
    expect(() => parseStyleSpec(spec)).not.toThrow();
  });

  it('не нарушает ни одного инварианта продукта', () => {
    const violations = checkSpec(spec);
    // Отчёт человеческим языком: тест-раннер показывает, ЧТО сломалось.
    expect(violations.map((v) => `${v.rule}: ${v.detail}`)).toEqual([]);
  });

  it('воспроизводится побайтово', () => {
    const again = buildStyleSpec(input);
    expect(specFingerprint(again.spec)).toBe(specFingerprint(spec));
    expect(JSON.stringify(again.spec.measurements)).toBe(JSON.stringify(spec.measurements));
  });

  it('содержит полный комплект разделов', () => {
    expect(spec.measurements.points.length).toBeGreaterThan(0);
    expect(spec.construction?.nodes.length).toBeGreaterThan(0);
    expect(spec.bom?.lines.length).toBeGreaterThan(0);
    expect(spec.labels?.requisites.length).toBeGreaterThan(0);
  });

  it('каждое решение движка объяснено пользователю', () => {
    for (const note of notes) expect(note.length).toBeGreaterThan(10);
  });
});

describe('чувствительность к входу', () => {
  const spec = (i: number) => buildStyleSpec(SCENARIOS[i]!.input).spec;

  it('каждый сценарий даёт свой документ — иначе часть входа игнорируется', () => {
    const seen = new Map<string, string>();
    for (const s of SCENARIOS) {
      const fp = specFingerprint(buildStyleSpec(s.input).spec);
      const clash = seen.get(fp);
      expect(clash, `${s.name} совпал с ${clash}`).toBeUndefined();
      seen.set(fp, s.name);
    }
  });

  it('прилегающая посадка уже, чем oversize, на всех точках ширины', () => {
    const fitted = spec(2);
    const oversize = spec(3);
    for (const code of ['T03', 'T04', 'T05']) {
      const a = fitted.measurements.points.find((p) => p.code === code)!.base.value;
      const b = oversize.measurements.points.find((p) => p.code === code)!.base.value;
      expect(b, code).toBeGreaterThan(a);
    }
  });

  it('низкий рост укорачивает изделие, не сужая его', () => {
    const short = spec(6);
    const tall = spec(7);
    const len = (s: typeof short, c: string) =>
      s.measurements.points.find((p) => p.code === c)!.base.value;
    expect(len(tall, 'T01')).toBeGreaterThan(len(short, 'T01'));
    expect(len(tall, 'T03')).toBe(len(short, 'T03'));
  });
});

describe('честность на всей матрице', () => {
  it('ни один сценарий не выдаёт документ без предположений', () => {
    // Ноль предположений означал бы, что мы где-то соврали: припуски и состав
    // полотна с фотографии не определяются никогда.
    for (const s of SCENARIOS) {
      const spec = buildStyleSpec(s.input).spec;
      expect(spec.meta.assumptions_count, s.name).toBeGreaterThan(0);
    }
  });

  it('без профиля бренда пробелы маркировки видны', () => {
    const noBrand = SCENARIOS.find((s) => s.name === 'без профиля бренда')!;
    const spec = buildStyleSpec(noBrand.input).spec;
    const gaps = spec.labels!.requisites.filter((r) => r.required && r.value === null);
    expect(gaps.length).toBeGreaterThan(1);
    for (const g of gaps) expect(g.action_ru).toBeTruthy();
  });

  it('с профилем бренда остаётся только дата выпуска', () => {
    const withBrand = SCENARIOS.find((s) => s.name === 'полный профиль бренда')!;
    const spec = buildStyleSpec(withBrand.input).spec;
    const gaps = spec.labels!.requisites.filter((r) => r.required && r.value === null);
    expect(gaps.map((g) => g.id)).toEqual(['production_date']);
  });

  it('в каждом документе есть значения хотя бы двух разных происхождений', () => {
    for (const s of SCENARIOS) {
      const breakdown = confidenceBreakdown(buildStyleSpec(s.input).spec);
      const used = Object.values(breakdown).filter((n) => n > 0).length;
      expect(used, s.name).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('замена узла по числу строчек', () => {
  const threeRows = SCENARIOS.find((s) => s.name === 'три параллельные строчки по низу')!;
  const extended = SCENARIOS.find((s) => s.name === 'расширенный парк машин')!;

  it('на базовом парке узел заменяется и об этом сказано', () => {
    const { spec, notes } = buildStyleSpec(threeRows.input);
    const hem = spec.construction!.nodes.find((n) => n.node_id === 'hem_coverstitch_3n')!;
    expect(hem.requires_special_equipment).toBe(true);
    expect(hem.alternative).not.toBeNull();
    expect(notes.join(' ')).toContain('Подтвердите у фабрики');
  });

  it('на расширенном парке замена не нужна', () => {
    const spec = buildStyleSpec(extended.input).spec;
    const hem = spec.construction!.nodes.find((n) => n.node_id === 'hem_coverstitch_3n')!;
    expect(hem.requires_special_equipment).toBe(false);
  });

  it('чертёж рисует три строчки, а не две', () => {
    const spec = buildStyleSpec(threeRows.input).spec;
    const hem = spec.construction!.nodes.find((n) => n.zone === 'hem')!;
    expect(hem.stitch_code).toBe('407');
  });
});
