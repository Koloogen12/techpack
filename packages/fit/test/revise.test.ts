import { describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '@seamster/assembly';
import { parseStyleSpec, type StyleSpec } from '@seamster/stylespec';
import {
  RevisionPlanSchema,
  applyRevision,
  normalizeRequest,
  revisionContext,
  type RevisionOp,
  type RevisionPlan,
} from '../src/index.js';

const AT = new Date('2026-09-23T00:00:00.000Z');

const INPUT: StyleSpecInput = {
  id: 'revise-test',
  name: 'Худи',
  article: 'REV-001',
  category: 'hoodie',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'oversize',
  fabric_kind: 'knit',
  size_range: [44, 46, 48],
  generated_at: AT,
};

const spec = (over: Partial<StyleSpecInput> = {}): StyleSpec =>
  buildStyleSpec({ ...INPUT, ...over }).spec;

const HOODIE = spec();
const TSHIRT = spec({ category: 'tshirt', name: 'Футболка', article: 'REV-002' });

const op = (partial: Partial<RevisionOp> & { op: RevisionOp['op'] }): RevisionOp => ({
  node_id: null,
  code: null,
  value_cm: null,
  delta_cm: null,
  zone: null,
  ru: null,
  en: null,
  match: null,
  why_ru: 'тест',
  ...partial,
});

const plan = (ops: RevisionOp[], changes_en: string[] = []): RevisionPlan => ({
  ops,
  summary_ru: 'тест',
  changes_en,
  unclear_ru: null,
});

describe('контекст для интерпретатора — закрытые списки', () => {
  it('перечисляет узлы изделия, добавляемые узлы, точки и составные тождества', () => {
    const ctx = revisionContext(HOODIE);
    expect(ctx).toContain('hood_set_in — Втачивание капюшона');
    expect(ctx).toContain('NODES THAT CAN BE ADDED');
    expect(ctx).toContain('patch_pocket');
    expect(ctx).toContain('T11 — Длина рукава от центра спинки');
    expect(ctx).toMatch(/T10 = 1×T11 \+ -0\.5×T06/);
  });

  it('нормализация фразы: регистр, пробелы и точка не делают новую просьбу', () => {
    expect(normalizeRequest('  Убери   капюшон. ')).toBe('убери капюшон');
  });

  it('схема плана принимает плоские операции', () => {
    const parsed = RevisionPlanSchema.parse(
      plan([op({ op: 'remove_node', node_id: 'hood_set_in' })]),
    );
    expect(parsed.ops).toHaveLength(1);
  });
});

describe('применение правки — спецификация первична', () => {
  const HOOD = ['hood_center_seam', 'hood_set_in', 'hood_drawcord_casing', 'hood_eyelets'];

  it('убрать капюшон: уходят узлы, операции, фурнитура капюшона и точки капюшона', () => {
    const r = applyRevision(
      HOODIE,
      plan(HOOD.map((node_id) => op({ op: 'remove_node', node_id }))),
    );
    expect(r.rejected_ru).toEqual([]);
    const ids = r.spec.construction!.nodes.map((n) => n.node_id);
    for (const id of HOOD) expect(ids).not.toContain(id);
    expect(r.spec.construction!.sequence.some((s) => s.node_id && HOOD.includes(s.node_id))).toBe(
      false,
    );
    // Нумерация операций сплошная после удаления.
    expect(r.spec.construction!.sequence.map((s) => s.step)).toEqual(
      r.spec.construction!.sequence.map((_, i) => i + 1),
    );
    const materials = r.spec.bom!.lines.map((l) => l.material_id);
    expect(materials).not.toContain('drawcord_flat');
    expect(materials).not.toContain('eyelet_metal');
    expect(materials).not.toContain('cord_tip');
    // Нитки и ярлыки остаются: они нужны любому изделию.
    expect(r.spec.bom!.lines.some((l) => l.role === 'thread')).toBe(true);
    const codes = r.spec.measurements.points.map((p) => p.code);
    expect(codes).not.toContain('H01');
    expect(codes).not.toContain('H02');
    expect(codes).not.toContain('H03');
    expect(codes).toContain('T01');
    expect(r.sections).toEqual(expect.arrayContaining(['nodes', 'bom', 'pom', 'flats']));
    expect(r.changed_ru.join('\n')).toContain('Конструкция: убрано');
    expect(r.changed_ru.join('\n')).toContain('Табель: убрано');
    // Результат — валидная спека со сходящимся счётчиком предположений.
    expect(() => parseStyleSpec(r.spec)).not.toThrow();
  });

  it('добавить накладной карман футболке: узел «указан вами», операция в конце', () => {
    const r = applyRevision(TSHIRT, plan([op({ op: 'add_node', node_id: 'patch_pocket' })]));
    expect(r.rejected_ru).toEqual([]);
    const node = r.spec.construction!.nodes.find((n) => n.node_id === 'patch_pocket');
    expect(node).toBeDefined();
    expect(node!.presence.confidence).toBe('user_input');
    const last = r.spec.construction!.sequence.at(-1)!;
    expect(last.node_id).toBe('patch_pocket');
    expect(last.step).toBe(r.spec.construction!.sequence.length);
    expect(() => parseStyleSpec(r.spec)).not.toThrow();
  });

  it('добавить капюшон футболке нельзя: узел не применяется к категории', () => {
    const r = applyRevision(TSHIRT, plan([op({ op: 'add_node', node_id: 'hood_set_in' })]));
    expect(r.rejected_ru[0]).toContain('не применяется');
    expect(r.spec).toEqual(TSHIRT);
  });

  it('вернуть капюшон после удаления: точки капюшона возвращаются типовыми', () => {
    const without = applyRevision(
      HOODIE,
      plan(HOOD.map((node_id) => op({ op: 'remove_node', node_id }))),
    ).spec;
    const back = applyRevision(
      without,
      plan(HOOD.map((node_id) => op({ op: 'add_node', node_id }))),
    );
    expect(back.rejected_ru).toEqual([]);
    const h01 = back.spec.measurements.points.find((p) => p.code === 'H01');
    expect(h01).toBeDefined();
    expect(h01!.base.note).toContain('добавлено правкой');
    // Фурнитура капюшона тоже вернулась — той же строкой, что при сборке.
    expect(back.spec.bom!.lines.map((l) => l.material_id)).toContain('drawcord_flat');
    expect(back.spec.bom!.lines.map((l) => l.material_id)).toContain('eyelet_metal');
  });

  it('сдвиг замера идёт через ту же правку, что таблица: составная точка пересчитывается', () => {
    const before = HOODIE.measurements.points.find((p) => p.code === 'T11')!.base.value;
    const t10 = HOODIE.measurements.points.find((p) => p.code === 'T10')!.base.value;
    const r = applyRevision(
      HOODIE,
      plan([op({ op: 'set_measurement', code: 'T11', delta_cm: -30 })]),
    );
    expect(r.rejected_ru).toEqual([]);
    const after = r.spec.measurements.points.find((p) => p.code === 'T11')!;
    expect(after.base.value).toBeCloseTo(before - 30, 1);
    expect(after.base.confidence).toBe('user_input');
    expect(r.spec.measurements.points.find((p) => p.code === 'T10')!.base.value).toBeCloseTo(
      t10 - 30,
      1,
    );
    expect(r.changed_ru.some((c) => c.startsWith('Табель: T11'))).toBe(true);
  });

  it('составную точку напрямую не поставить — отказ словами, остальное применяется', () => {
    const r = applyRevision(
      HOODIE,
      plan([
        op({ op: 'set_measurement', code: 'T10', value_cm: 20 }),
        op({ op: 'set_measurement', code: 'T01', value_cm: 60 }),
      ]),
    );
    expect(r.rejected_ru).toHaveLength(1);
    expect(r.rejected_ru[0]).toContain('T10');
    expect(r.spec.measurements.points.find((p) => p.code === 'T01')!.base.value).toBe(60);
  });

  it('дизайн-признаки добавляются и убираются по фрагменту', () => {
    const added = applyRevision(
      HOODIE,
      plan([op({ op: 'add_feature', zone: 'sleeve', ru: 'рукав реглан', en: 'raglan sleeves' })]),
    );
    expect(added.spec.design!.features[0]!.en).toBe('raglan sleeves');
    expect(added.spec.design!.features[0]!.confidence).toBe('user_input');
    const removed = applyRevision(
      added.spec,
      plan([op({ op: 'remove_feature', match: 'raglan' })]),
    );
    expect(removed.spec.design).toBeUndefined();
    expect(removed.changed_ru[0]).toContain('убрано');
  });

  it('план без операций ничего не меняет', () => {
    const r = applyRevision(HOODIE, plan([]));
    expect(r.changed_ru).toEqual([]);
    expect(r.spec).toEqual(HOODIE);
  });

  it('воспроизводимо: один план дважды — одна спека', () => {
    const p = plan([
      op({ op: 'remove_node', node_id: 'hood_eyelets' }),
      op({ op: 'set_measurement', code: 'T01', delta_cm: 5 }),
    ]);
    expect(applyRevision(HOODIE, p).spec).toEqual(applyRevision(HOODIE, p).spec);
  });
});
