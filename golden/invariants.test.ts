import { describe, expect, it } from 'vitest';
import { buildStyleSpec } from '@specform/assembly';
import type { StyleSpec } from '@specform/stylespec';
import { SCENARIOS } from './scenarios.js';
import { checkSpec } from './invariants.js';

/**
 * Проверка проверяющего.
 *
 * Голден-сет, который ничего не ловит, опаснее его отсутствия: он создаёт
 * ложное чувство защищённости. Поэтому в каждую спеку намеренно вносится
 * поломка, и тест требует, чтобы чекер её увидел.
 *
 * Каждая мутация ниже — не выдумка, а описание реальной аварии:
 * значение без источника, замер не того порядка, разъехавшийся счётчик
 * предположений, операция, ссылающаяся в никуда.
 */

const { spec: CLEAN } = buildStyleSpec(SCENARIOS[0]!.input);

type Mutation = { name: string; damage: string; mutate: (s: StyleSpec) => StyleSpec };

const points = (
  s: StyleSpec,
  fn: (p: StyleSpec['measurements']['points'][number], i: number) => unknown,
) =>
  ({
    ...s,
    measurements: { ...s.measurements, points: s.measurements.points.map(fn as never) },
  }) as StyleSpec;

const MUTATIONS: Mutation[] = [
  {
    name: 'значение без источника',
    damage: 'нельзя ответить на вопрос «откуда это число»',
    mutate: (s) => points(s, (p, i) => (i ? p : { ...p, base: { ...p.base, source: '' } })),
  },
  {
    name: 'замер не того порядка',
    damage: 'футболка длиной три метра',
    mutate: (s) =>
      points(s, (p) => (p.code === 'T01' ? { ...p, base: { ...p.base, value: 300 } } : p)),
  },
  {
    name: 'нарушена точность хранения',
    damage: 'сотые доли сантиметра в табеле мер, которые никто не отмерит',
    mutate: (s) => points(s, (p, i) => (i ? p : { ...p, base: { ...p.base, value: 51.234 } })),
  },
  {
    name: 'градация не монотонна',
    damage: 'размер 42 шире размера 52',
    mutate: (s) =>
      points(s, (p) =>
        p.code === 'T03'
          ? {
              ...p,
              graded: p.graded.map((g, i) => (i ? g : { ...g, value: { ...g.value, value: 999 } })),
            }
          : p,
      ),
  },
  {
    name: 'нулевой допуск',
    damage: 'ОТК обязан принять изделие с точностью до микрона',
    mutate: (s) => points(s, (p, i) => (i ? p : { ...p, tolerance: { ...p.tolerance, value: 0 } })),
  },
  {
    name: 'счётчик предположений соврал',
    damage: 'на обложке одно число, в таблицах другое',
    mutate: (s) => ({ ...s, meta: { ...s.meta, assumptions_count: 999 } }),
  },
  {
    name: 'узел спецмашины без замены',
    damage: 'фабрика получает невыполнимое требование без выхода',
    mutate: (s) => ({
      ...s,
      construction: {
        ...s.construction!,
        nodes: s.construction!.nodes.map((n, i) =>
          i ? n : { ...n, requires_special_equipment: true, alternative: null },
        ),
      },
    }),
  },
  {
    name: 'операция ссылается в никуда',
    damage: 'в перечне операций узел, которого нет в конструкции',
    mutate: (s) => ({
      ...s,
      construction: {
        ...s.construction!,
        sequence: s.construction!.sequence.map((x, i) =>
          i ? x : { ...x, node_id: 'no_such_node' },
        ),
      },
    }),
  },
  {
    name: 'плечи шире изделия по груди',
    damage: 'геометрически невозможное изделие',
    mutate: (s) =>
      points(s, (p) => (p.code === 'T06' ? { ...p, base: { ...p.base, value: 60 } } : p)),
  },
  {
    name: 'низ рукава шире рукава под проймой',
    damage: 'рукав расширяется книзу на футболке',
    mutate: (s) =>
      points(s, (p) => (p.code === 'T13' ? { ...p, base: { ...p.base, value: 30 } } : p)),
  },
  {
    name: 'артикулы SKU дублируются',
    damage: 'два разных изделия под одним кодом маркировки',
    mutate: (s) => ({
      ...s,
      labels: {
        ...s.labels!,
        sku_matrix: s.labels!.sku_matrix.map((x) => ({ ...x, sku: 'SAME' })),
      },
    }),
  },
  {
    name: 'пробел маркировки без объяснения',
    damage: 'пользователь видит пустое поле и не знает, что делать',
    mutate: (s) => ({
      ...s,
      labels: {
        ...s.labels!,
        requisites: s.labels!.requisites.map((r) =>
          r.value === null ? { ...r, action_ru: null } : r,
        ),
      },
    }),
  },
  {
    name: 'матрица SKU неполна',
    damage: 'часть сочетаний цвет×размер не получит кода маркировки',
    mutate: (s) => ({
      ...s,
      labels: { ...s.labels!, sku_matrix: s.labels!.sku_matrix.slice(0, 1) },
    }),
  },
  {
    name: 'состав материала без источника',
    damage: 'на ярлык уедет состав, происхождение которого никто не знает',
    mutate: (s) => ({
      ...s,
      bom: {
        ...s.bom!,
        lines: s.bom!.lines.map((l, i) =>
          i ? l : { ...l, composition: { ...l.composition, source: '' } },
        ),
      },
    }),
  },
  {
    name: 'длина по центру спинки разошлась с длиной от плеча',
    damage:
      'документ противоречит сам себе на пять сантиметров — ровно то, ' +
      'что нашлось на приёмке первых паков',
    mutate: (s) =>
      points(s, (p) =>
        p.code === 'T02' ? { ...p, base: { ...p.base, value: p.base.value - 5 } } : p,
      ),
  },
  {
    name: 'длины сходятся на базовом размере и расходятся на остальных',
    damage: 'таблица выглядит правильной ровно там, куда посмотрят первым делом',
    mutate: (s) =>
      points(s, (p) =>
        p.code === 'T02'
          ? { ...p, graded: p.graded.map((g) => ({ ...g, value: { ...g.value, value: 40 } })) }
          : p,
      ),
  },
  {
    name: 'рукав длиннее руки',
    damage: 'плечи и рукав по отдельности правдоподобны, а размах больше роста',
    mutate: (s) =>
      points(s, (p) => (p.code === 'T10' ? { ...p, base: { ...p.base, value: 74 } } : p)),
  },
];

describe('чистая спека', () => {
  it('не нарушает ни одного инварианта', () => {
    expect(checkSpec(CLEAN).map((v) => `${v.rule}: ${v.detail}`)).toEqual([]);
  });
});

describe('чекер инвариантов ловит намеренные поломки', () => {
  it.each(MUTATIONS)('$name — $damage', ({ mutate }) => {
    const violations = checkSpec(mutate(CLEAN));
    expect(violations.length).toBeGreaterThan(0);
  });

  it('не срабатывает вхолостую: каждая мутация ловится своим правилом', () => {
    const rules = new Set<string>();
    for (const m of MUTATIONS) {
      for (const v of checkSpec(m.mutate(CLEAN))) rules.add(v.rule);
    }
    // Если бы всё ловилось одним правилом, проверки были бы декоративными.
    expect(rules.size).toBeGreaterThanOrEqual(8);
  });
});
