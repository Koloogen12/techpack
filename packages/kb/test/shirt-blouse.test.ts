import { describe, expect, it } from 'vitest';
import { CATEGORY_CLASS, CATEGORY_FABRIC, kb } from '../src/index.js';

const base = kb();

/**
 * Рубашка и блузка — первый тканый верх.
 *
 * Полотно здесь не пометка, а способ сборки: рубашка держится на воротнике
 * со стойкой, планке с петлями и кокетке. Трикотажной рубашки не бывает —
 * бывает поло, и оно заведено отдельной категорией.
 */
describe('рубашка и блузка', () => {
  it('обе — тканый верх', () => {
    for (const c of ['shirt', 'blouse'] as const) {
      expect(CATEGORY_CLASS[c], c).toBe('top');
      expect(CATEGORY_FABRIC[c], c).toBe('woven');
    }
  });

  it('у рубашки есть воротник, кокетка и спуск полочки, у блузки — нет', () => {
    const shirt = base.pomTemplate('shirt', 'woven').points.map((p) => p.code);
    const blouse = base.pomTemplate('blouse', 'woven').points.map((p) => p.code);
    for (const code of ['S01', 'S02', 'S03', 'S04', 'S08']) {
      expect(shirt, code).toContain(code);
      expect(blouse, code).not.toContain(code);
    }
    // Планка, манжета и шаг петель есть у обеих: без них не застегнуть.
    for (const code of ['S05', 'S06', 'S07', 'S09']) {
      expect(shirt, code).toContain(code);
      expect(blouse, code).toContain(code);
    }
  });

  it('корпус меряется теми же точками, что у трикотажного верха', () => {
    // Мерить грудь и пройму иначе не от чего: заводить свои коды значило бы
    // держать два источника правды об одном плече.
    const shirt = base.pomTemplate('shirt', 'woven').points.map((p) => p.code);
    for (const code of ['T01', 'T03', 'T06', 'T09', 'T10']) expect(shirt).toContain(code);
    expect(
      base.pomTemplate('shirt', 'woven').points.filter((p) => p.derivation === 'anchor'),
    ).toHaveLength(1);
  });

  it('рубашка собирается кокеткой и запошивочным швом, блузка — обтачкой и обмёткой', () => {
    const shirt = base.categoryDefaultsFor('shirt', 'woven').default_nodes;
    const blouse = base.categoryDefaultsFor('blouse', 'woven').default_nodes;
    expect(shirt).toContain('yoke_double');
    expect(shirt).toContain('seam_felled');
    expect(shirt).toContain('collar_stand_set_in');
    expect(blouse).not.toContain('yoke_double');
    expect(blouse).not.toContain('seam_felled');
    expect(blouse).toContain('neck_facing');
    expect(blouse).toContain('edge_finish_overlock');
    // Планка и манжета — общее: обе застёгиваются на пуговицы.
    for (const id of ['front_placket', 'cuff_barrel', 'placket_buttonholes', 'button_sew'])
      for (const nodes of [shirt, blouse]) expect(nodes).toContain(id);
  });

  it('каждый узел заведён в справочнике и применим к своей категории', () => {
    for (const c of ['shirt', 'blouse'] as const)
      for (const id of base.categoryDefaultsFor(c, 'woven').default_nodes)
        expect(base.node(id).applies_to, `${c}/${id}`).toContain(c);
  });

  it('запошивочный шов требует машины вне базового цеха и знает замену', () => {
    const node = base.node('seam_felled');
    expect(node.requires_special_equipment).toBe(true);
    expect(base.checkMachinePark(node, 'base_shop').alternative?.id).toBe('side_seam_plain');
    expect(base.checkMachinePark(node, 'extended_shop').available).toBe(true);
  });

  it('рибаны в спецификации нет ни у той, ни у другой', () => {
    for (const c of ['shirt', 'blouse'] as const)
      expect(base.categoryDefaultsFor(c, 'woven').default_materials.rib, c).toBeNull();
  });

  it('прибавка тканого верха не уходит в минус', () => {
    // Сорочечная ткань не тянется: рубашка обязана застёгиваться.
    for (const c of ['shirt', 'blouse'] as const)
      expect(base.easeFor(c, 'fitted', 'woven').entry.min, c).toBeGreaterThan(0);
  });

  it('расход у рубашки больше, чем у блузки, и выпады выше футболочных', () => {
    const shirt = base.consumptionFor('shirt', 'woven');
    const blouse = base.consumptionFor('blouse', 'woven');
    const tee = base.consumptionFor('tshirt', 'knit');
    expect(shirt.consumption_m.default).toBeGreaterThan(blouse.consumption_m.default);
    // Воротник, стойка, манжеты и планка раскладываются в выпадах.
    expect(shirt.marker_waste_percent.default).toBeGreaterThan(tee.marker_waste_percent.default);
  });

  it('стандарт выпуска у сорочек свой', () => {
    const market = base.marketFor('zh')!;
    for (const c of ['shirt', 'blouse'] as const)
      expect(base.productStandardFor(market, c, 'woven')?.code, c).toContain('2660');
  });
});
