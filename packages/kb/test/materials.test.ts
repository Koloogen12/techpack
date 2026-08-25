import { describe, expect, it } from 'vitest';
import { kb } from '../src/index.js';

const base = kb();

describe('материалы', () => {
  it('для футболки есть основное полотно и отделочное', () => {
    const roles = new Set(base.materialsFor('tshirt').map((m) => m.role));
    expect(roles).toContain('shell');
    expect(roles).toContain('rib');
  });

  it('плотность нигде не объявлена определимой по фото', () => {
    for (const m of base.materialsFor('tshirt')) {
      if (m.gsm) expect(m.gap?.toLowerCase()).toContain('плотность');
    }
  });

  it('плотность по умолчанию лежит внутри диапазона', () => {
    for (const id of ['single_jersey', 'rib_1x1', 'french_terry_3t']) {
      const m = base.material(id);
      expect(m.gsm!.default).toBeGreaterThanOrEqual(m.gsm!.min);
      expect(m.gsm!.default).toBeLessThanOrEqual(m.gsm!.max);
    }
  });

  it('каждое полотно ссылается на существующий профиль ухода', () => {
    for (const m of base.materialsFor('tshirt')) {
      if (m.care_profile_id) expect(() => base.careProfile(m.care_profile_id!)).not.toThrow();
    }
  });
});

describe('расход полотна', () => {
  it('худи расходует больше футболки — иначе перепутаны категории', () => {
    expect(base.consumptionFor('hoodie').consumption_m.default).toBeGreaterThan(
      base.consumptionFor('tshirt').consumption_m.default,
    );
  });

  it('чулок экономичнее рулона', () => {
    const tee = base.consumptionFor('tshirt');
    expect(tee.tube_consumption_m!.default).toBeLessThan(tee.consumption_m.default);
  });

  it('всегда несёт оговорку про раскладку — иначе фабрика примет оценку за расчёт', () => {
    for (const c of ['tshirt', 'hoodie'] as const) {
      expect(base.consumptionFor(c).gap).toContain('раскладке');
    }
  });
});

describe('символы ухода', () => {
  const symbols = base.careSymbolsOrdered('cotton_knit');

  it('идут в порядке ГОСТ ISO 3758: стирка → отбеливание → сушка → глажение → чистка', () => {
    expect(symbols.map((s) => s.group)).toEqual([
      'wash',
      'bleach',
      'tumble_dry',
      'natural_dry',
      'iron',
      'professional',
    ]);
  });

  it('типовой профиль хлопкового трикотажа соответствует правилу базы знаний', () => {
    const byGroup = Object.fromEntries(symbols.map((s) => [s.group, s.id]));
    expect(byGroup.wash).toBe('wash_30_delicate');
    expect(byGroup.bleach).toBe('bleach_none');
    expect(byGroup.tumble_dry).toBe('tumble_none');
    expect(byGroup.iron).toBe('iron_150');
  });
});

describe('обязательная маркировка', () => {
  const requisites = base.labelRequisites();

  it('покрывает статью 9 ТР ТС 017 полностью', () => {
    const ids = requisites.map((r) => r.id);
    for (const id of [
      'product_name',
      'country',
      'manufacturer',
      'size',
      'composition',
      'trademark',
      'production_date',
      'care_symbols',
      'eac',
    ]) {
      expect(ids).toContain(id);
    }
  });

  it('импортёр — единственный необязательный реквизит', () => {
    expect(requisites.filter((r) => !r.required).map((r) => r.id)).toEqual(['importer']);
  });

  it('каждый реквизит знает, откуда берётся значение', () => {
    for (const r of requisites) {
      expect(['brand_profile', 'style', 'kb', 'manual']).toContain(r.fills_from);
    }
  });
});
