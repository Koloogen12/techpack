import { describe, expect, it } from 'vitest';
import { kb } from '@seamsterly/kb';
import {
  buildConstruction,
  countConstructionAssumptions,
  type ConstructionInput,
} from '../src/index.js';

const base = kb();
const INPUT: ConstructionInput = { category: 'tshirt' };

const build = (input: ConstructionInput = INPUT) => buildConstruction(input, base);
const node = (id: string, input?: ConstructionInput) => {
  const found = build(input).nodes.find((n) => n.node_id === id);
  if (!found) throw new Error(`нет узла ${id}`);
  return found;
};

describe('набор узлов категории', () => {
  it('собирается из категорийных дефолтов', () => {
    expect(build().nodes.map((n) => n.node_id)).toEqual(
      base.categoryDefaultsFor('tshirt').default_nodes,
    );
  });

  it('у каждого узла есть код шва, стежок, SPI и машина — требование R5', () => {
    for (const n of build().nodes) {
      expect(n.seam_code).toMatch(/^\d/);
      expect(n.stitch_code).toMatch(/^\d{3}$/);
      expect(n.spi).toBeGreaterThan(0);
      expect(n.machine).toBeTruthy();
    }
  });

  it('каждый узел объяснён простыми словами — новичок не знает терминов', () => {
    for (const n of build().nodes) {
      expect(n.plain_ru.length).toBeGreaterThan(20);
      expect(n.plain_ru).not.toBe(n.label_ru);
    }
  });
});

describe('честность присутствия узла', () => {
  it('невидимое с фото уходит предположением с указанием, что делать', () => {
    const tape = node('shoulder_stay_tape');
    expect(tape.presence.confidence).toBe('assumption');
    expect(tape.presence.note).toBeTruthy();
  });

  it('видимый узел без подтверждения с фото остаётся типовым', () => {
    expect(node('neck_rib_band').presence.confidence).toBe('default_from_base');
  });

  it('подтверждённый vision-этапом узел становится оценкой по фото', () => {
    const confirmed = node('neck_rib_band', {
      ...INPUT,
      visible_elements: [{ key: 'neckline_type', value: 'бейка-риб кольцом', confidence: 'high' }],
    });
    expect(confirmed.presence.confidence).toBe('estimated_from_photo');
    expect(confirmed.presence.note).toContain('бейка-риб');
  });

  it('припуски всегда предположение — с фото они не видны никогда', () => {
    for (const n of build().nodes) {
      expect(n.seam_allowance_cm.confidence).toBe('assumption');
      expect(n.seam_allowance_cm.note).toContain('конструктор');
    }
  });

  it('счётчик предположений считает только узлы без подтверждения', () => {
    const nodes = build().nodes;
    expect(countConstructionAssumptions(nodes)).toBe(
      nodes.filter((n) => !n.visible_on_photo).length,
    );
  });
});

describe('число параллельных строчек задаёт машину', () => {
  // Ключевая петля продукта: наблюдение с фото меняет узел, узел не проходит
  // проверку парка машин, и документ сразу предлагает выполнимую замену.
  const threeRows: ConstructionInput = {
    ...INPUT,
    topstitching: [{ location: 'hem', rows: 3, confidence: 'high' }],
  };

  it('две строчки — двухигольный распошив, узел по умолчанию', () => {
    const twoRows = {
      ...INPUT,
      topstitching: [{ location: 'hem', rows: 2, confidence: 'high' as const }],
    };
    expect(node('hem_coverstitch', twoRows).machine).toBe('coverstitch_2n');
  });

  it('три строчки — узел меняется на трёхигольный', () => {
    const ids = build(threeRows).nodes.map((n) => n.node_id);
    expect(ids).toContain('hem_coverstitch_3n');
    expect(ids).not.toContain('hem_coverstitch');
  });

  it('замена объясняется пользователю, а не происходит молча', () => {
    expect(build(threeRows).notes.join(' ')).toContain('3 параллельные строчки');
  });

  it('трёхигольный не проходит проверку базового парка и получает замену', () => {
    const hem = node('hem_coverstitch_3n', threeRows);
    expect(hem.requires_special_equipment).toBe(true);
    expect(hem.alternative?.node_id).toBe('hem_coverstitch');
    expect(hem.alternative?.machine).toBe('coverstitch_2n');
  });

  it('фабрике сообщается и о требовании, и о выходе из него', () => {
    const notes = build(threeRows).notes.join(' ');
    expect(notes).toContain('которой в типовом цеху обычно нет');
    expect(notes).toContain('Подтвердите у фабрики');
  });

  it('в расширенном цеху та же машина доступна и замена не нужна', () => {
    const hem = node('hem_coverstitch_3n', { ...threeRows, machine_park: 'extended_shop' });
    expect(hem.requires_special_equipment).toBe(false);
    expect(hem.alternative).toBeNull();
  });

  it('ноль видимых строчек ничего не меняет — «не видно» это не «нет»', () => {
    const noRows = {
      ...INPUT,
      topstitching: [{ location: 'hem', rows: 0, confidence: 'low' as const }],
    };
    expect(build(noRows).nodes.map((n) => n.node_id)).toContain('hem_coverstitch');
  });
});

describe('технологическая последовательность', () => {
  it('идёт подряд и покрывает весь цикл', () => {
    const seq = build().sequence;
    expect(seq.map((s) => s.step)).toEqual(seq.map((_, i) => i + 1));
    expect(seq.at(-1)!.operation_ru).toContain('упаковк');
  });

  it('ссылается только на узлы этого же документа', () => {
    const result = build();
    const ids = new Set(result.nodes.map((n) => n.node_id));
    for (const step of result.sequence) {
      if (step.node_id) expect(ids.has(step.node_id)).toBe(true);
    }
  });

  it('машина в операции следует за заменой узла — данные не разъезжаются', () => {
    const threeRows = {
      ...INPUT,
      topstitching: [{ location: 'hem', rows: 3, confidence: 'high' as const }],
    };
    const hemStep = build(threeRows).sequence.find((s) => s.node_id === 'hem_coverstitch_3n');
    expect(hemStep?.machine).toBe('coverstitch_3n');
  });

  it('у каждой операции есть исполнитель и оборудование', () => {
    for (const step of build().sequence) {
      expect(step.specialty).toBeTruthy();
      expect(step.machine).toBeTruthy();
    }
  });
});

describe('воспроизводимость', () => {
  it('одинаковый вход даёт побайтово одинаковую конструкцию', () => {
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});
