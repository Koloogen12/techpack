import { describe, expect, it } from 'vitest';
import {
  buildStyleSpec,
  seesNarrowNeck,
  seesNoBand,
  seesZip,
  type StyleSpecInput,
} from '../src/index.js';

/**
 * Застёжка по фото сильнее застёжки категории.
 *
 * Джемпер в рубчик с диагональной молнией (23.09.2026): быстрый взгляд назвал
 * его кардиганом, категория принесла планку с петлями и пуговицами, а
 * дизайн-признаки — молнию. Документ нарисовал обе застёжки разом. Теперь
 * увиденная молния заменяет планку, а пуговицы уходят вместе с операциями
 * и строкой фурнитуры.
 */
const INPUT: StyleSpecInput = {
  id: 'closure-test',
  name: 'Джемпер с молнией',
  article: 'ZIP-001',
  category: 'cardigan',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'fitted',
  fabric_kind: 'knit',
  size_range: [44, 46, 48],
  generated_at: new Date('2026-09-23T00:00:00.000Z'),
};

const ZIP_SEEN = {
  visible_elements: [
    {
      key: 'closure_type',
      value: 'диагональная металлическая молния от горловины к боку',
      confidence: 'high' as const,
    },
  ],
};

describe('застёжка по фото сильнее категории', () => {
  it('молния на снимке кардигана заменяет планку, петли и пуговицы уходят', () => {
    const { spec, notes } = buildStyleSpec({ ...INPUT, ...ZIP_SEEN });
    const ids = spec.construction!.nodes.map((n) => n.node_id);
    expect(ids).toContain('zip_set_in');
    expect(ids).toContain('zip_placket_topstitch');
    for (const gone of [
      'cardigan_placket',
      'cardigan_placket_topstitch',
      'placket_buttonholes',
      'button_sew',
    ])
      expect(ids).not.toContain(gone);
    // Операции: петли и пуговицы ушли, слова у молнии свои, нумерация сплошная.
    const ops = spec.construction!.sequence;
    expect(ops.some((o) => o.node_id === 'placket_buttonholes' || o.node_id === 'button_sew')).toBe(
      false,
    );
    const zipOp = ops.find((o) => o.node_id === 'zip_set_in')!;
    expect(zipOp.operation_ru).toMatch(/молни/);
    expect(ops.map((o) => o.step)).toEqual(ops.map((_, i) => i + 1));
    // Фурнитура: пуговица кардигана → разъёмная молния.
    const hardware = spec.bom!.lines.filter((l) => l.role === 'hardware').map((l) => l.material_id);
    expect(hardware).toContain('zipper_separating');
    expect(hardware).not.toContain('button_cardigan');
    // Шаг петель без петель не печатается.
    expect(spec.measurements.points.map((p) => p.code)).not.toContain('Z03');
    expect(notes.join('\n')).toMatch(/молния/);
  });

  it('без наблюдения застёжки кардиган остаётся на пуговицах', () => {
    const { spec } = buildStyleSpec(INPUT);
    const ids = spec.construction!.nodes.map((n) => n.node_id);
    expect(ids).toContain('cardigan_placket');
    expect(ids).toContain('button_sew');
    expect(spec.bom!.lines.map((l) => l.material_id)).toContain('button_cardigan');
    expect(spec.measurements.points.map((p) => p.code)).toContain('Z03');
  });

  it('свитер с молнией на снимке получает узлы молнии и строку фурнитуры', () => {
    const { spec, notes } = buildStyleSpec({
      ...INPUT,
      ...ZIP_SEEN,
      category: 'sweater',
      article: 'ZIP-002',
    });
    const ids = spec.construction!.nodes.map((n) => n.node_id);
    expect(ids).toContain('zip_set_in');
    // Место — как у донора (худи на молнии): после плечевых швов, до рукавов.
    const ops = spec.construction!.sequence;
    const zipAt = ops.findIndex((o) => o.node_id === 'zip_set_in');
    const shoulderAt = ops.findIndex((o) => o.node_id === 'shoulder_seam_overlock');
    const sleeveAt = ops.findIndex((o) => o.node_id === 'sleeve_set_in');
    expect(zipAt).toBeGreaterThan(shoulderAt);
    expect(zipAt).toBeLessThan(sleeveAt);
    expect(ops.map((o) => o.step)).toEqual(ops.map((_, i) => i + 1));
    expect(spec.bom!.lines.map((l) => l.material_id)).toContain('zipper_separating');
    expect(notes.join('\n')).toMatch(/Добавлены втачивание разъёмной молнии/);
  });

  it('рибана сплошная: манжета и пояс по фото становятся подгибкой, высоты уходят', () => {
    const { spec, notes } = buildStyleSpec({
      ...INPUT,
      category: 'sweater',
      article: 'RIB-001',
      visible_elements: [
        {
          key: 'cuff_type',
          value: 'низ рукава в рибану, без отдельной манжеты',
          confidence: 'medium',
        },
        {
          key: 'waistband_type',
          value: 'низ прямой, отдельный пояс не читается',
          confidence: 'medium',
        },
      ],
    });
    const ids = spec.construction!.nodes.map((n) => n.node_id);
    expect(ids).not.toContain('cuff_rib');
    expect(ids).not.toContain('waistband_rib');
    expect(ids).toContain('sleeve_hem_coverstitch');
    expect(ids).toContain('hem_coverstitch');
    const codes = spec.measurements.points.map((p) => p.code);
    expect(codes).not.toContain('H07');
    expect(codes).not.toContain('H08');
    const hemOp = spec.construction!.sequence.find((o) => o.node_id === 'hem_coverstitch')!;
    expect(hemOp.operation_ru).toMatch(/[Пп]одши/);
    expect(notes.join('\n')).toMatch(/подгибку/);
  });

  it('«манжета-риб отдельной деталью» остаётся манжетой', () => {
    const { spec } = buildStyleSpec({
      ...INPUT,
      category: 'sweater',
      article: 'RIB-002',
      visible_elements: [
        { key: 'cuff_type', value: 'широкая манжета-риб отдельной деталью', confidence: 'high' },
      ],
    });
    expect(spec.construction!.nodes.map((n) => n.node_id)).toContain('cuff_rib');
    expect(seesNoBand('широкая манжета-риб отдельной деталью')).toBe(false);
    expect(seesNoBand('подгибка низа')).toBe(true);
  });

  it('узкая окантовка по фото заменяет бейку-риб, высота бейки становится высотой окантовки', () => {
    const { spec, notes } = buildStyleSpec({
      ...INPUT,
      ...ZIP_SEEN,
      category: 'sweater',
      article: 'NECK-001',
      visible_elements: [
        ...ZIP_SEEN.visible_elements,
        {
          key: 'neckline_type',
          value: 'узкая бейка-риб, вырез круглый невысокий',
          confidence: 'medium',
        },
      ],
    });
    const ids = spec.construction!.nodes.map((n) => n.node_id);
    expect(ids).toContain('neck_binding');
    expect(ids).not.toContain('neck_rib_band');
    const t17 = spec.measurements.points.find((p) => p.code === 'T17')!;
    expect(t17.base.value).toBeLessThanOrEqual(1.5);
    expect(t17.graded.every((g) => g.value.value === t17.base.value)).toBe(true);
    expect(notes.join('\n')).toMatch(/окантовк/);
    expect(seesNarrowNeck('воротник-стойка из рибаны')).toBe(false);
    expect(seesNarrowNeck('collarless V-notch, narrow binding')).toBe(true);
  });

  it('«без молнии» — не молния', () => {
    expect(seesZip('диагональная металлическая молния')).toBe(true);
    expect(seesZip('exposed metal zip')).toBe(true);
    expect(seesZip('застёжки нет, без молнии')).toBe(false);
    expect(seesZip('пуговицы на планке')).toBe(false);
  });

  it('воспроизводимо: один вход — одна спека', () => {
    const a = buildStyleSpec({ ...INPUT, ...ZIP_SEEN }).spec;
    const b = buildStyleSpec({ ...INPUT, ...ZIP_SEEN }).spec;
    expect(a).toEqual(b);
  });
});
