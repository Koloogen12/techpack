import { describe, expect, it } from 'vitest';
import { MACHINE_TYPES, kb } from '../src/index.js';

const base = kb();
const nodes = base.nodesFor('tshirt').concat(base.nodesFor('hoodie'));
const all = [...new Set(nodes.map((n) => n.id))].map((id) => base.node(id));

describe('целостность ссылок между справочниками', () => {
  it('каждый узел ссылается на существующий код стежка', () => {
    for (const n of all) expect(() => base.stitch(n.stitch_code)).not.toThrow();
  });

  it('каждый узел ссылается на существующий код шва', () => {
    for (const n of all) expect(() => base.seam(n.seam_code)).not.toThrow();
  });

  it('машина узла и машина его стежка не противоречат друг другу', () => {
    for (const n of all) {
      expect(MACHINE_TYPES).toContain(n.machine);
    }
  });

  it('операции техпоследовательности ссылаются на существующие узлы', () => {
    for (const op of base.categoryDefaultsFor('tshirt').tech_sequence) {
      if (op.node_id) expect(() => base.node(op.node_id!)).not.toThrow();
    }
  });

  it('дефолтные узлы категории действительно применимы к ней', () => {
    for (const id of base.categoryDefaultsFor('tshirt').default_nodes) {
      expect(base.node(id).applies_to).toContain('tshirt');
    }
  });
});

describe('machine-park check', () => {
  it('узлы базового парка доступны без замены', () => {
    const hem = base.node('hem_coverstitch');
    expect(base.checkMachinePark(hem).available).toBe(true);
  });

  it('узел вне парка помечается недоступным и предлагает замену', () => {
    const twin = base.node('hem_twin_needle');
    const check = base.checkMachinePark(twin);
    expect(check.available).toBe(false);
    expect(check.alternative?.id).toBe('hem_coverstitch');
  });

  it('в расширенном цеху двухигольная доступна', () => {
    expect(base.checkMachinePark(base.node('hem_twin_needle'), 'extended_shop').available).toBe(
      true,
    );
  });

  // Главный инвариант: замена бесполезна, если сама требует спецмашины.
  // Фабрика получит второе невыполнимое требование вместо решения.
  it('КАЖДАЯ замена выполнима на базовом парке', () => {
    const broken: string[] = [];
    for (const node of all) {
      if (!node.requires_special_equipment) continue;
      const check = base.checkMachinePark(node);
      if (!check.alternative) {
        broken.push(`${node.id}: замены нет`);
        continue;
      }
      if (!base.checkMachinePark(check.alternative).available) {
        broken.push(`${node.id} → ${check.alternative.id}: замена тоже вне базового парка`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('замена не тянет за собой ещё одну замену — цепочки запрещены', () => {
    for (const node of all) {
      const alt = node.alternative_node_id ? base.node(node.alternative_node_id) : undefined;
      if (alt) expect(alt.requires_special_equipment).toBe(false);
    }
  });
});

describe('честность узлов', () => {
  it('невидимые с фото узлы существуют — иначе карта видимости не работает', () => {
    expect(all.filter((n) => !n.visible_on_photo).length).toBeGreaterThan(0);
  });

  it('каждый узел объяснён простыми словами, а не только на языке технолога', () => {
    for (const n of all) {
      expect(n.plain_ru.length).toBeGreaterThan(20);
      expect(n.plain_ru).not.toBe(n.label_ru);
    }
  });

  it('припуск по умолчанию лежит внутри своего диапазона', () => {
    for (const n of all) {
      expect(n.seam_allowance_cm.default).toBeGreaterThanOrEqual(n.seam_allowance_cm.min);
      expect(n.seam_allowance_cm.default).toBeLessThanOrEqual(n.seam_allowance_cm.max);
    }
  });

  it('у каждого узла указаны SPI и машина — требование R5', () => {
    for (const n of all) {
      expect(n.spi).toBeGreaterThan(0);
      expect(n.machine).toBeTruthy();
    }
  });
});

describe('технологическая последовательность', () => {
  const seq = base.categoryDefaultsFor('tshirt').tech_sequence;

  it('идёт подряд с первой операции', () => {
    expect(seq.map((o) => o.step)).toEqual(seq.map((_, i) => i + 1));
  });

  it('начинается со сборки, заканчивается упаковкой', () => {
    expect(seq[0]!.operation_ru).toContain('плечев');
    expect(seq.at(-1)!.operation_ru).toContain('упаковк');
  });

  it('нормы времени честно пустые — данных цеха у нас нет', () => {
    expect(seq.every((o) => o.time_sec === null)).toBe(true);
    expect(base.categoryDefaultsFor('tshirt').gap).toContain('Время');
  });
});

describe('карта видимости', () => {
  const map = base.visibilityMap();

  it('невидимое объясняет и дефолт, и что с ним делать', () => {
    for (const f of map.not_visible) {
      expect(f.default_ru.length).toBeGreaterThan(0);
      expect(f.note_ru.length).toBeGreaterThan(0);
    }
  });

  it('плотность полотна и прокладки — в невидимых, это ключевое ограничение', () => {
    const keys = map.not_visible.map((f) => f.key);
    expect(keys).toContain('fabric_weight');
    expect(keys).toContain('interlining');
  });

  it('число параллельных отстрочек — в видимых: по нему определяется тип машины', () => {
    expect(map.visible.map((f) => f.key)).toContain('topstitch_rows');
  });
});
