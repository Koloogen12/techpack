import { describe, expect, it } from 'vitest';
import { CATEGORIES, CATEGORY_REGISTRY, MACHINE_TYPES, kb } from '../src/index.js';

const base = kb();

/**
 * Все узлы справочника, а не узлы одного-двух изделий.
 *
 * Раньше здесь стояли футболка и худи, и инварианты ниже видели меньше
 * половины набора. Цена узкого обхода выяснилась 10 сентября 2026: петли
 * на планке числились спецоперацией при своей петельной машине в базовом
 * цеху, а их «замена» на кнопки требовала пресса, которого там нет, — то
 * есть механизм замены вёл из выполнимого в невыполнимое. Тест этого не
 * видел, потому что планка не применяется ни к футболке, ни к худи.
 *
 * Обход идёт по реестру категорий, поэтому новая вещь попадает под
 * проверку сама, без правки этого файла.
 */
const nodes = CATEGORIES.flatMap((category) => base.nodesFor(category));
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
    for (const op of base.categoryDefaultsFor('tshirt', 'knit').tech_sequence) {
      if (op.node_id) expect(() => base.node(op.node_id!)).not.toThrow();
    }
  });

  it('дефолтные узлы категории действительно применимы к ней', () => {
    for (const id of base.categoryDefaultsFor('tshirt', 'knit').default_nodes) {
      expect(base.node(id).applies_to).toContain('tshirt');
    }
  });
});

describe('уход изделия из нескольких слоёв', () => {
  /**
   * Режим ухода выбирается ЦЕЛИКОМ по самому требовательному слою, потому
   * что ярлык — согласованный набор символов, а не сборная солянка из
   * разных профилей. Цена этого решения: если слои требуют
   * ПРОТИВОПОЛОЖНОГО, победитель молча навяжет свой режим остальным.
   *
   * Живой пример, найденный при заведении материалов: вискозная подкладка
   * запрещает барабанную сушку, а синтепоновый утеплитель без барабана
   * сваливается. Профиль подкладки строже по стирке, значит на ярлык
   * ушёл бы запрет барабана — и куртка испортилась бы при первой стирке
   * по своей же инструкции.
   *
   * Сейчас конфликта нет: материалы разведены намеренно (вискоза в
   * пальто, таффета в утеплённой куртке). Тест держит именно это
   * разведение — не даёт вернуть конфликт молча.
   */
  it('слои одной категории не требуют противоположной сушки', () => {
    const conflicts: string[] = [];

    for (const category of CATEGORIES) {
      const defaults = base.categoryDefaultsFor(
        category,
        CATEGORY_REGISTRY[category].fabric,
      ).default_materials;
      const ids = [defaults.shell, defaults.lining, defaults.insulation].filter(
        (id): id is string => typeof id === 'string',
      );
      if (ids.length < 2) continue;

      const tumble = ids
        .map((id) => base.material(id).care_profile_id)
        .filter((id): id is string => typeof id === 'string')
        .map((id) => ({ id, dry: base.careProfile(id).variants.tumble_dry }));

      const forbids = tumble.filter((t) => t.dry === 'tumble_none');
      const allows = tumble.filter((t) => t.dry && t.dry !== 'tumble_none');
      if (forbids.length && allows.length) {
        conflicts.push(
          `${category}: ${forbids.map((f) => f.id).join(', ')} запрещают барабан, ` +
            `${allows.map((a) => a.id).join(', ')} его допускают`,
        );
      }
    }

    expect(conflicts).toEqual([]);
  });
});

describe('детали кроя ссылаются на настоящие узлы', () => {
  /**
   * Деталь появляется в листе кроя, только если в изделии есть узел, ради
   * которого она нужна. Ссылка на несуществующий узел не ошибка для
   * компилятора и не ошибка для схемы: это просто строка, которая никогда
   * не совпадёт. Деталь тихо исчезает из документа.
   *
   * Так и было с воротником поло: деталь требовала узел `polo_collar`, а
   * узел называется `polo_collar_set_in`. Воротник не попадал в лист кроя
   * ни разу — фабрика получала поло без воротника в деталях. Нашлось
   * случайно, при заведении верхней одежды, спустя месяцы.
   */
  it('каждая ссылка requires_node указывает на существующий узел', () => {
    const broken: string[] = [];
    for (const part of base.allCutParts()) {
      const node = part.requires_node;
      if (!node) continue;
      try {
        base.node(node);
      } catch {
        broken.push(`${part.id} → ${node}`);
      }
    }
    expect(broken).toEqual([]);
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
  const seq = base.categoryDefaultsFor('tshirt', 'knit').tech_sequence;

  it('идёт подряд с первой операции', () => {
    expect(seq.map((o) => o.step)).toEqual(seq.map((_, i) => i + 1));
  });

  it('начинается со сборки, заканчивается упаковкой', () => {
    expect(seq[0]!.operation_ru).toContain('плечев');
    expect(seq.at(-1)!.operation_ru).toContain('упаковк');
  });

  it('нормы времени честно пустые — данных цеха у нас нет', () => {
    expect(seq.every((o) => o.time_sec === null)).toBe(true);
    expect(base.categoryDefaultsFor('tshirt', 'knit').gap).toContain('Время');
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
