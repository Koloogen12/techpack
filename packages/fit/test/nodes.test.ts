import { describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '@seamster/assembly';
import { kb } from '@seamster/kb';
import { setNodeStitch, stitchOptions } from '../src/index.js';

const INPUT: StyleSpecInput = {
  id: 'stitch',
  name: 'Футболка',
  article: 'STI-001',
  category: 'tshirt',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'semi_fitted',
  fabric_kind: 'knit',
  size_range: [44, 46, 48],
  generated_at: new Date('2026-09-23T00:00:00.000Z'),
};

const { spec } = buildStyleSpec(INPUT);

/**
 * Класс стежка — выбор бренда поверх справочника. За классом идут машина,
 * проверка парка и операция: таблица узлов, схема шва и техпоследовательность
 * обязаны говорить одно.
 */
describe('класс стежка узла задаёт человек', () => {
  it('подгибка низа: распошив 406 → челночный 301, машина и операция едут следом', () => {
    const before = spec.construction!.nodes.find((n) => n.node_id === 'hem_coverstitch')!;
    expect(before.stitch_code).toBe('406');
    const r = setNodeStitch(spec, 'hem_coverstitch', '301');
    expect(r.rejected).toBeNull();
    const after = r.spec.construction!.nodes.find((n) => n.node_id === 'hem_coverstitch')!;
    expect(after.stitch_code).toBe('301');
    expect(after.machine).toBe(kb().stitch('301').machine);
    expect(after.stitch_by_user).toBe(true);
    const step = r.spec.construction!.sequence.find((s) => s.node_id === 'hem_coverstitch')!;
    expect(step.machine).toBe(after.machine);
    expect(r.changed_ru).toContain('406 → 301');
  });

  it('тот же класс — ничего не меняется и не отказывается', () => {
    const r = setNodeStitch(spec, 'hem_coverstitch', '406');
    expect(r.rejected).toBeNull();
    expect(r.changed_ru).toBeNull();
    expect(r.spec).toBe(spec);
  });

  it('неизвестный код и чужой узел отклоняются словами', () => {
    expect(setNodeStitch(spec, 'hem_coverstitch', '999').rejected).toContain('999');
    expect(setNodeStitch(spec, 'fly_zip', '301').rejected).toContain('fly_zip');
  });

  it('стежок вне парка цеха ставит флаг спецоборудования, а без замены — отказ', () => {
    // 103 (потайной) требует blindstitch, которого в базовом цехе нет;
    // у подгибки низа футболки замены под базовый парк не предусмотрено.
    const r = setNodeStitch(spec, 'hem_coverstitch', '103');
    expect(r.rejected === null || /парк/.test(r.rejected)).toBe(true);
    if (r.rejected === null) {
      const n = r.spec.construction!.nodes.find((x) => x.node_id === 'hem_coverstitch')!;
      expect(n.requires_special_equipment).toBe(true);
      expect(n.alternative).not.toBeNull();
    }
  });

  it('список классов для выбора несёт код, имя и машину', () => {
    const list = stitchOptions();
    expect(list.length).toBeGreaterThan(10);
    expect(list.find((s) => s.code === '301')).toMatchObject({
      machine: 'single_needle_lockstitch',
    });
  });
});
