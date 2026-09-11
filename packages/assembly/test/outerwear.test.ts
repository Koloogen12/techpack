import { describe, expect, it } from 'vitest';
import { kb } from '@seamster/kb';
import { buildStyleSpec, type StyleSpecInput } from '../src/index.js';

/**
 * Верхняя одежда: первое изделие, у которого полотен больше одного.
 *
 * До неё вся спецификация считала одно полотно: расход был скаляром,
 * состав на ярлыке брался из верха, режим ухода — из верха же. Для куртки
 * на подкладке каждое из трёх — ошибка, и две из них юридические:
 * статья 9 ТР ТС 017/2011 требует указывать состав ПО СЛОЯМ, а режим
 * ухода изделия определяется самым требовательным слоем, а не основным
 * полотном.
 *
 * Тест держит именно это: не «куртка собирается», а «второй слой доезжает
 * до документа целиком — своей строкой, своим расходом, своим составом».
 */
const INPUT: StyleSpecInput = {
  id: 'outerwear',
  name: 'Куртка',
  article: 'JK-001',
  category: 'jacket',
  gender: 'women',
  base_size_ru: 48,
  base_height_cm: 170,
  fit_intent: 'semi_fitted',
  fabric_kind: 'woven',
  size_range: [44, 46, 48, 50],
  quantity: 100,
  generated_at: new Date('2026-09-11T00:00:00.000Z'),
};

const jacket = buildStyleSpec(INPUT);
const coat = buildStyleSpec({ ...INPUT, id: 'coat', article: 'CT-001', category: 'coat' });
const tshirt = buildStyleSpec({
  ...INPUT,
  id: 'tee',
  article: 'TS-001',
  category: 'tshirt',
  fabric_kind: 'knit',
});

const lineOf = (spec: typeof jacket, role: string) =>
  spec.spec.bom?.lines.find((l) => l.role === role);

describe('куртка собирается из трёх полотен', () => {
  it('подкладка стоит отдельной строкой спецификации', () => {
    const lining = lineOf(jacket, 'lining');
    expect(lining).toBeDefined();
    expect(lining?.consumption_unit).toBe('м');
  });

  it('у подкладки свой расход, а не расход верха', () => {
    const shell = jacket.spec.bom?.fabric_consumption_m.value;
    const lining = lineOf(jacket, 'lining')?.consumption?.value;
    expect(typeof lining).toBe('number');
    expect(lining).not.toBe(shell);
  });

  it('расход слоя на тираж посчитан — иначе фабрика его не закупит', () => {
    const lining = lineOf(jacket, 'lining');
    expect(lining?.batch_consumption).toBeGreaterThan(0);
  });

  it('однослойная вещь осталась прежней: ни подкладки, ни утеплителя', () => {
    expect(lineOf(tshirt, 'lining')).toBeUndefined();
    expect(lineOf(tshirt, 'insulation')).toBeUndefined();
    expect(tshirt.spec.bom?.fabric_consumption_m.value).toBeGreaterThan(0);
  });
});

describe('ярлык говорит правду о слоях', () => {
  const compositionOf = (spec: typeof jacket): string =>
    spec.spec.labels?.requisites.find((r) => r.id === 'composition')?.value?.value ?? '';

  it('состав идёт по слоям, а не одним полотном', () => {
    const composition = compositionOf(jacket);
    expect(composition).toContain('верх:');
    expect(composition).toContain('подкладка:');
  });

  it('у однослойной вещи состав остался одной строкой без слова «верх»', () => {
    expect(compositionOf(tshirt)).not.toContain('верх:');
  });

  it('символы ухода собраны по самому требовательному слою', () => {
    const base = kb();
    const layers = ['shell', 'lining', 'insulation']
      .map((role) => lineOf(coat, role))
      .filter((l): l is NonNullable<typeof l> => Boolean(l))
      .map((l) => base.material(l.material_id).care_profile_id)
      .filter((id): id is string => typeof id === 'string');

    const strictest = base.strictestCareProfile(layers);
    expect(strictest).toBeDefined();

    // На ярлык попадают символы именно строгого профиля, а не профиля верха.
    const printed = (coat.spec.labels?.care_symbols ?? []).map((s) => s.id);
    const expected = base.careSymbolsOrdered(strictest!).map((s) => s.id);
    expect(printed).toEqual(expected);
  });
});

describe('класс изделия', () => {
  /** Ширина груди — точка, от которой считается всё остальное у верха. */
  const chestOf = (spec: typeof jacket): number | undefined =>
    spec.spec.measurements.points.find((p) => /груд/i.test(p.name_ru))?.base.value;

  it('верхняя одежда меряется от груди, как весь верх', () => {
    expect(chestOf(jacket)).toBeGreaterThan(0);
  });

  it('куртка шире футболки того же размера — она надевается поверх', () => {
    // Прибавка куртки по справочнику начинается с +12 см к обхвату против
    // +8 у трикотажного верха. Если это перестанет быть так, куртка сядет
    // на человека в свитере, и померить её будет нечем.
    expect(chestOf(jacket)!).toBeGreaterThan(chestOf(tshirt)!);
  });

  it('пальто шире куртки — оно надевается поверх неё', () => {
    expect(chestOf(coat)!).toBeGreaterThan(chestOf(jacket)!);
  });
});
