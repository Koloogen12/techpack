import { describe, expect, it } from 'vitest';
import { CATEGORY_CLASS, CATEGORY_FABRIC, kb } from '../src/index.js';

const base = kb();

const KNITWEAR = ['cardigan', 'sweater'] as const;

/**
 * Кардиган и свитер — первые изделия из ВЯЗАНОГО полотна.
 *
 * Со свитшотом их роднит сборка и разводит сырьё: там футер с начёсом,
 * здесь полотно из пряжи, а значит другой уход, другой расход и другая цена.
 * Между собой их разводит одна вещь, которую нельзя смазать: кардиган
 * распашной и застёгивается, свитер надевается через голову и застёжки
 * не имеет вовсе. Спутать их значит прислать фабрике не ту вещь целиком.
 */
describe('кардиган и свитер', () => {
  it('оба — трикотажный верх', () => {
    for (const c of KNITWEAR) {
      expect(CATEGORY_CLASS[c], c).toBe('top');
      expect(CATEGORY_FABRIC[c], c).toBe('knit');
    }
  });

  it('в табеле мер ровно один якорь масштаба, и это ширина по груди', () => {
    for (const c of KNITWEAR) {
      const anchors = base.pomTemplate(c, 'knit').points.filter((p) => p.derivation === 'anchor');
      expect(anchors, c).toHaveLength(1);
      expect(anchors[0]!.code, c).toBe('T03');
    }
  });

  it('корпус меряется теми же точками, что у остального трикотажного верха', () => {
    // Заводить свои коды под то же плечо значило бы держать два источника
    // правды об одном замере.
    for (const c of KNITWEAR) {
      const codes = base.pomTemplate(c, 'knit').points.map((p) => p.code);
      for (const code of ['T01', 'T03', 'T05', 'T06', 'T10', 'T12', 'T13', 'T14']) {
        expect(codes, `${c}/${code}`).toContain(code);
      }
      // Рибана низа и манжеты — обязательная часть обеих вещей.
      for (const code of ['H07', 'H08']) expect(codes, `${c}/${code}`).toContain(code);
    }
  });

  it('точки застёжки есть у кардигана и отсутствуют у свитера', () => {
    const cardigan = base.pomTemplate('cardigan', 'knit').points.map((p) => p.code);
    const sweater = base.pomTemplate('sweater', 'knit').points.map((p) => p.code);
    // Длина планки, её ширина и шаг петель. Без них не закупить ни ленту
    // петель, ни пуговицы, а на чертеже нечем показать сам разрез переда.
    for (const code of ['Z01', 'Z02', 'Z03']) {
      expect(cardigan, code).toContain(code);
      expect(sweater, code).not.toContain(code);
    }
  });

  it('длина планки — разность, а не отдельная пропорция', () => {
    // Планка идёт от края горловины переда до низа: длина от плеча минус
    // глубина горловины переда. Пока такое считалось своей пропорцией,
    // документ противоречил сам себе внутри одной таблицы.
    const z01 = base.pomTemplate('cardigan', 'knit').points.find((p) => p.code === 'Z01')!;
    expect(z01.derivation).toBe('composed');
    expect(z01.composed_of).toEqual([
      { code: 'T01', factor: 1 },
      { code: 'T15', factor: -1 },
    ]);
  });

  it('ширина планки и шаг петель не градуируются', () => {
    // Oversize не делает пуговицу больше и не раздвигает петли: с размером
    // растёт длина планки, а на длинной планке помещается лишняя петля.
    for (const code of ['Z02', 'Z03']) {
      const point = base.pomTemplate('cardigan', 'knit').points.find((p) => p.code === code)!;
      expect(point.grading_key, code).toBe('none');
      expect(point.anchor_basis, code).toBe('body');
    }
  });

  it('горловина свитера выше бейки кардигана — это воротник, а не окантовка', () => {
    const height = (c: (typeof KNITWEAR)[number]): number =>
      base.pomTemplate(c, 'knit').points.find((p) => p.code === 'T17')!.baseline_ratio!;
    expect(height('sweater')).toBeGreaterThan(height('cardigan'));
    expect(
      base.pomTemplate('sweater', 'knit').points.find((p) => p.code === 'T17')!.name_ru,
    ).toContain('воротник');
  });

  it('кардиган собирается на планке с петлями и пуговицами, свитер — ни на чём', () => {
    const cardigan = base.categoryDefaultsFor('cardigan', 'knit').default_nodes;
    const sweater = base.categoryDefaultsFor('sweater', 'knit').default_nodes;
    for (const id of [
      'cardigan_placket',
      'cardigan_placket_topstitch',
      'placket_buttonholes',
      'button_sew',
    ]) {
      expect(cardigan, id).toContain(id);
      expect(sweater, id).not.toContain(id);
    }
    // Ни одного узла застёжки: свитер надевается через голову.
    for (const id of sweater) expect(base.node(id).zone, id).not.toBe('closure');
    // Рибана горловины, манжет и пояса — общее: без неё это другая вещь.
    for (const id of ['neck_rib_band', 'cuff_rib', 'waistband_rib', 'sleeve_set_in']) {
      for (const nodes of [cardigan, sweater]) expect(nodes, id).toContain(id);
    }
  });

  it('капюшона нет ни у того, ни у другого', () => {
    for (const c of KNITWEAR) {
      for (const id of base.categoryDefaultsFor(c, 'knit').default_nodes) {
        expect(base.node(id).zone, `${c}/${id}`).not.toBe('hood');
      }
    }
  });

  it('каждый узел заведён в справочнике и применим к своей категории', () => {
    for (const c of KNITWEAR) {
      for (const id of base.categoryDefaultsFor(c, 'knit').default_nodes) {
        expect(base.node(id).applies_to, `${c}/${id}`).toContain(c);
      }
    }
  });

  it('планка кардигана рисуется на чертеже, а петля и пуговица — нет', () => {
    // Технолог читает чертёж швами. Разрез переда и отстрочка планки — швы,
    // и линии у них есть. Петля и пуговица — не швы, и вместо линии у них
    // объяснение, почему её нет: молча пропавший узел неотличим от забытого.
    expect(base.node('cardigan_placket').flat_line).toBe('zip_line');
    expect(base.node('cardigan_placket_topstitch').flat_line).toBe('zip_stitch');
    for (const id of ['placket_buttonholes', 'button_sew']) {
      expect(base.node(id).flat_line, id).toBeNull();
      expect(base.node(id).flat_line_note_ru, id).toBeTruthy();
    }
  });

  it('кардиган шьётся на базовом парке, и предложенная замена там выполнима', () => {
    // Замена, которая сама требует машины вне базового парка, — это второе
    // невыполнимое требование вместо решения. Ровно так и было у петель:
    // узел числился спецоперацией, хотя петельная машина в цеху стоит,
    // а замену предлагал на кнопки, для которых нужен пресс.
    for (const id of base.categoryDefaultsFor('cardigan', 'knit').default_nodes) {
      const node = base.node(id);
      const check = base.checkMachinePark(node, 'base_shop');
      expect(check.available, id).toBe(true);
      if (node.alternative_node_id) {
        const alternative = base.node(node.alternative_node_id);
        expect(alternative.applies_to, id).toContain('cardigan');
        expect(base.checkMachinePark(alternative, 'base_shop').available, id).toBe(true);
      }
    }
    // Петли на планке базовому цеху по силам, и замены у них нет вовсе.
    expect(base.node('placket_buttonholes').alternative_node_id).toBeNull();
  });

  it('полотно — не футер: у обоих основное полотно вяжется из пряжи', () => {
    for (const c of KNITWEAR) {
      const shell = base.categoryDefaultsFor(c, 'knit').default_materials.shell;
      expect(shell, c).toBe('wool_knit_jersey');
      expect(base.material(shell).composition_default_ru, c).toContain('шерсть');
    }
    // У свитшота — футер с начёсом или без; на этом разница и держится.
    expect(base.categoryDefaultsFor('sweatshirt', 'knit').default_materials.shell).toContain(
      'french_terry',
    );
  });

  it('уход за шерстью — ручная стирка и сушка разложив, а не хлопковый режим', () => {
    // Машинная стирка 30 °C и утюг 150 °C сваливают шерсть, а сушка на
    // верёвке вытягивает полотно под собственным весом.
    const profile = base.material('wool_knit_jersey').care_profile_id!;
    expect(profile).not.toBe('cotton_knit');
    const symbols = base.careSymbolsOrdered(profile);
    const ids = symbols.map((s) => s.id);
    expect(ids).toContain('wash_hand');
    expect(ids).toContain('dry_flat');
    expect(ids).not.toContain('tumble_low');
  });

  it('фурнитура есть только у кардигана, и это пуговица', () => {
    const cardigan = base.categoryDefaultsFor('cardigan', 'knit').default_materials.hardware;
    expect(cardigan).toEqual(['button_cardigan']);
    expect(base.material('button_cardigan').applications).toEqual(['cardigan']);
    expect(base.categoryDefaultsFor('sweater', 'knit').default_materials.hardware).toEqual([]);
  });

  it('прибавка задана на все четыре посадки, и кардиган свободнее свитера', () => {
    // Кардиган надевается ПОВЕРХ свитера или рубашки — лишний слой обязан
    // быть виден числом, иначе обе вещи выходят одной ширины.
    for (const fit of ['fitted', 'semi_fitted', 'loose', 'oversize'] as const) {
      const sweater = base.easeFor('sweater', fit, 'knit');
      const cardigan = base.easeFor('cardigan', fit, 'knit');
      expect(sweater.fallbackFrom, fit).toBeUndefined();
      expect(cardigan.fallbackFrom, fit).toBeUndefined();
      expect(cardigan.entry.default, fit).toBeGreaterThan(sweater.entry.default);
    }
  });

  it('минус в прибавке не допущен: полотно из пряжи идёт без эластана', () => {
    // У футболки минус держится на эластане в кулирке. Здесь его нет, и
    // изделие уже тела вытянется по груди после первой носки.
    for (const c of KNITWEAR) {
      expect(base.easeFor(c, 'fitted', 'knit').entry.min, c).toBeGreaterThanOrEqual(0);
    }
    expect(base.easeFor('tshirt', 'fitted', 'knit').entry.min).toBeLessThan(0);
  });

  it('расход у кардигана больше свитерного: перед раскроен из двух полочек', () => {
    const sweater = base.consumptionFor('sweater', 'knit');
    const cardigan = base.consumptionFor('cardigan', 'knit');
    expect(cardigan.consumption_m.default).toBeGreaterThan(sweater.consumption_m.default);
    // Обе вещи тяжелее лонгслива: больше деталей и рибана отдельным полотном.
    expect(sweater.consumption_m.default).toBeGreaterThan(
      base.consumptionFor('longsleeve', 'knit').consumption_m.default,
    );
    // Усадка шерсти выше хлопковой — верхняя граница диапазона это признаёт.
    expect(sweater.shrinkage_percent.max).toBeGreaterThan(
      base.consumptionFor('sweatshirt', 'knit').shrinkage_percent.max,
    );
  });

  it('стандарт выпуска в КНР есть у обеих категорий', () => {
    // 执行标准 — первое, что читает китайский ОТК.
    const market = base.marketFor('zh')!;
    for (const c of KNITWEAR) {
      expect(base.productStandardFor(market, c, 'knit'), c).not.toBeNull();
    }
  });

  it('детали кроя: у кардигана полочки и планка, у свитера цельный перед', () => {
    const parts = (c: (typeof KNITWEAR)[number]): string[] =>
      base.cutPartsFor(c, base.categoryDefaultsFor(c, 'knit').default_nodes).map((p) => p.id);
    const cardigan = parts('cardigan');
    const sweater = parts('sweater');

    expect(cardigan).toContain('front_half');
    expect(cardigan).toContain('placket_cardigan');
    expect(cardigan).not.toContain('front');

    expect(sweater).toContain('front');
    expect(sweater).not.toContain('front_half');
    expect(sweater).not.toContain('placket_cardigan');

    // Рибана низа, манжет и горловины приходит по узлам, а не по категории.
    for (const parts of [cardigan, sweater]) {
      for (const id of ['cuff', 'waistband', 'neck_band']) expect(parts, id).toContain(id);
    }
  });

  it('незакрытые пробелы названы вслух, а не замазаны', () => {
    // Главный из них: вязание ПО ФОРМЕ (кеттлёвка вместо стачивания) наш
    // движок не описывает вовсе — там нет ни раскладки, ни расхода в метрах.
    // Не сказать об этом значило бы выдать швейную сборку за вязальную.
    for (const c of KNITWEAR) {
      expect(base.categoryDefaultsFor(c, 'knit').gap, c).toMatch(/связанн|кеттл/i);
      expect(base.consumptionFor(c, 'knit').gap, c).toMatch(/грамм/i);
    }
    expect(base.material('wool_knit_jersey').gap).toMatch(/кеттл|грамм/i);
    // И прибавки, и полотно помечены непроверенными: замеров вязаных
    // изделий у нас нет ни одного.
    expect(base.easeFor('sweater', 'semi_fitted', 'knit').entry.verified).toBe(false);
    expect(base.material('wool_knit_jersey').verified).toBe(false);
  });
});
