import { describe, expect, it } from 'vitest';
import { CATEGORIES, kb } from '../src/index.js';

const base = kb();

/**
 * Полотно — второй ключ справочника, а не вторая категория.
 *
 * Платье из трикотажа и платье из ткани — одно изделие для человека и два
 * разных для цеха: первое собирается оверлоком и распошивом, второе держится
 * на вытачках, обтачке и потайной молнии. Заводить ради этого вторую
 * категорию значило бы предложить в анкете выбрать между «платьем» и
 * «платьем»; вместо этого справочник ветвится по полотну, которое в анкете
 * и так спрашивается.
 */
describe('вариант справочника по полотну', () => {
  it('у платья есть тканый вариант, у трикотажного ядра — нет', () => {
    expect(base.hasFabricVariant('dress', 'woven')).toBe(true);
    for (const category of CATEGORIES.filter((c) => c !== 'dress'))
      expect(base.hasFabricVariant(category, 'woven'), category).toBe(false);
  });

  it('без своего варианта отдаётся базовый файл, а не ошибка', () => {
    // Футболки из ткани не бывает: это уже блузка. Пока варианта нет,
    // справочник обязан отдать то единственное исполнение, что описано.
    expect(base.pomTemplate('tshirt', 'woven').id).toBe('pom_templates/tshirt');
    expect(base.categoryDefaultsFor('tshirt', 'woven').id).toBe('category_defaults/tshirt');
  });

  it('тканое платье получает свой табель, трикотажное — свой', () => {
    expect(base.pomTemplate('dress', 'woven').id).toBe('pom_templates/dress.woven');
    expect(base.pomTemplate('dress', 'knit').id).toBe('pom_templates/dress');
    expect(base.categoryDefaultsFor('dress', 'woven').id).toBe('category_defaults/dress.woven');
    expect(base.categoryDefaultsFor('dress', 'knit').id).toBe('category_defaults/dress');
  });

  it('у тканого платья нет высоты бейки и есть длина застёжки', () => {
    const woven = base.pomTemplate('dress', 'woven').points.map((p) => p.code);
    const knit = base.pomTemplate('dress', 'knit').points.map((p) => p.code);
    expect(knit).toContain('T17');
    expect(woven).not.toContain('T17');
    expect(woven).toContain('Z01');
    expect(knit).not.toContain('Z01');
  });

  it('узлы тканого платья не пересекаются с трикотажными по способу сборки', () => {
    const woven = base.categoryDefaultsFor('dress', 'woven').default_nodes;
    const knit = base.categoryDefaultsFor('dress', 'knit').default_nodes;
    expect(woven).toContain('dart_waist');
    expect(woven).toContain('neck_facing');
    expect(woven).toContain('invisible_zip_back');
    expect(knit).toContain('neck_rib_band');
    expect(woven).not.toContain('neck_rib_band');
    expect(woven).not.toContain('hem_coverstitch');
  });

  it('каждый узел тканого платья заведён в справочнике и применим к платью', () => {
    for (const id of base.categoryDefaultsFor('dress', 'woven').default_nodes) {
      const node = base.node(id);
      expect(node.applies_to, id).toContain('dress');
    }
  });

  it('у тканого платья рибаны в спецификации нет вовсе', () => {
    expect(base.categoryDefaultsFor('dress', 'woven').default_materials.rib).toBeNull();
    expect(base.categoryDefaultsFor('dress', 'knit').default_materials.rib).not.toBeNull();
  });

  it('потайная подгибка требует машины, которой в базовом цеху нет, и знает замену', () => {
    const node = base.node('hem_blind');
    expect(node.requires_special_equipment).toBe(true);
    expect(base.checkMachinePark(node, 'base_shop').available).toBe(false);
    expect(base.checkMachinePark(node, 'base_shop').alternative?.id).toBe(
      'hem_topstitch_lockstitch',
    );
    expect(base.checkMachinePark(node, 'extended_shop').available).toBe(true);
  });

  it('прибавка ткани не уходит в минус, а трикотажная может', () => {
    // Ткань не тянется: посадка держится на вытачках, и отрицательная
    // прибавка означала бы платье, которое не застегнётся.
    expect(base.easeFor('dress', 'fitted', 'woven').entry.min).toBeGreaterThan(0);
    expect(base.easeFor('dress', 'fitted', 'knit').entry.min).toBeLessThan(0);
  });

  it('расход и выпады у ткани свои, поставки чулком нет', () => {
    const woven = base.consumptionFor('dress', 'woven');
    const knit = base.consumptionFor('dress', 'knit');
    expect(woven.marker_waste_percent.default).toBeGreaterThan(knit.marker_waste_percent.default);
    expect(woven.tube_consumption_m).toBeUndefined();
  });

  it('стандарт выпуска у тканого платья другой, чем у трикотажного', () => {
    const market = base.marketFor('zh');
    expect(market).not.toBeNull();
    const woven = base.productStandardFor(market!, 'dress', 'woven');
    const knit = base.productStandardFor(market!, 'dress', 'knit');
    expect(woven?.code).not.toBe(knit?.code);
    expect(woven?.code).toContain('81004');
  });
});
