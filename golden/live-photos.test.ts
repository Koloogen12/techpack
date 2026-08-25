import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defined } from '@specform/core';
import { buildStyleSpec, photoRatiosFrom } from '@specform/assembly';
import { VisionReportSchema, type VisionReport } from '@specform/vision';
import { parseAnswers, type Answers } from '@specform/cli';
import type { Category } from '@specform/kb';
import { checkSpec } from './invariants.js';

/**
 * Голден-набор на живых отчётах разбора.
 *
 * В `golden/vision-reports/` лежит настоящий выход модели на эталонных
 * фотографиях из `golden/photos/` — не выдуманные данные, а то, что она
 * действительно ответила. Отчёты коммитятся, поэтому набор гоняется в CI
 * без ключа API и без сети, но проверяет настоящую ветку.
 *
 * Смысл: правка промпта, справочника или движка не должна тихо ухудшать
 * то, что получается из реальных снимков.
 */

const DIR = new URL('./vision-reports/', import.meta.url).pathname;
const CATEGORIES = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', '') as Category);

const AT = new Date('2026-08-25T00:00:00.000Z');

function load(category: Category): { answers: Answers; report: VisionReport } {
  const answers = parseAnswers(
    JSON.parse(
      readFileSync(new URL(`./answers/${category}-women-46.json`, import.meta.url), 'utf8'),
    ),
  );
  const report = VisionReportSchema.parse(
    JSON.parse(readFileSync(`${DIR}${category}.json`, 'utf8')),
  );
  return { answers, report };
}

function build(category: Category) {
  const { answers, report } = load(category);
  return buildStyleSpec({
    ...defined(answers),
    photo_ratios: photoRatiosFrom(report.proportions),
    visible_elements: report.visible_elements,
    topstitching: report.topstitching,
    ...(report.fabric.knit_class !== 'unknown'
      ? { fabric_class: report.fabric.knit_class, fabric_confidence: report.fabric.confidence }
      : {}),
    generated_at: AT,
  });
}

describe('эталонные фотографии разобраны', () => {
  it('покрыто всё трикотажное ядро', () => {
    expect([...CATEGORIES].sort()).toEqual(['hoodie', 'longsleeve', 'sweatshirt', 'tshirt']);
  });

  it.each(CATEGORIES)('%s: отчёт модели соответствует схеме', (category) => {
    expect(() => load(category)).not.toThrow();
  });

  it.each(CATEGORIES)('%s: модель опознала заявленную категорию', (category) => {
    const { report } = load(category);
    // Расхождение допустимо только при низкой уверенности — тогда доверяем человеку.
    if (report.category.value !== category) {
      expect(report.category.confidence, `${category} → ${report.category.value}`).toBe('low');
    }
  });

  it.each(CATEGORIES)('%s: модель не назвала ни одного сантиметра', (category) => {
    const { report } = load(category);
    for (const p of report.proportions) {
      // Отношение к ширине по груди у трикотажного верха лежит в разумных
      // пределах. Число вроде 68 означало бы, что модель дала сантиметры.
      expect(p.ratio_to_chest, `${category}/${p.pom_code}`).toBeLessThan(4);
      expect(p.ratio_to_chest, `${category}/${p.pom_code}`).toBeGreaterThan(0);
    }
  });

  it.each(CATEGORIES)('%s: модель перечислила, чего не видно', (category) => {
    const { report } = load(category);
    // Половина ценности документа: каждый пункт уйдёт предположением.
    expect(report.not_visible.length, category).toBeGreaterThan(5);
    for (const f of report.not_visible) expect(f.reason.length).toBeGreaterThan(5);
  });

  it('у худи модель нашла точки капюшона и кармана', () => {
    const codes = load('hoodie').report.proportions.map((p) => p.pom_code);
    expect(codes.filter((c) => c.startsWith('H')).length).toBeGreaterThan(3);
  });

  it('у футболки точек капюшона нет — их не о чем было спрашивать', () => {
    const codes = load('tshirt').report.proportions.map((p) => p.pom_code);
    expect(codes.filter((c) => c.startsWith('H'))).toEqual([]);
  });
});

describe('техпак из живого разбора', () => {
  it.each(CATEGORIES)('%s: не нарушает ни одного инварианта', (category) => {
    const { spec } = build(category);
    expect(checkSpec(spec).map((v) => `${v.rule}: ${v.detail}`)).toEqual([]);
  });

  it.each(CATEGORIES)('%s: большинство замеров получено с фотографии', (category) => {
    const { spec } = build(category);
    const fromPhoto = spec.measurements.points.filter(
      (p) => p.base.confidence === 'estimated_from_photo',
    );
    // Если доля упадёт, значит промпт или клэмп перестали пропускать наблюдения.
    expect(fromPhoto.length / spec.measurements.points.length, category).toBeGreaterThan(0.45);
  });

  it.each(CATEGORIES)('%s: предположения остались — их не может не быть', (category) => {
    // Припуски и состав полотна с фотографии не определяются никогда.
    expect(build(category).spec.meta.assumptions_count, category).toBeGreaterThan(0);
  });

  it('у худи подтверждены узлы капюшона и кармана', () => {
    const { spec } = build('hoodie');
    const confirmed = spec
      .construction!.nodes.filter((n) => n.presence.confidence === 'estimated_from_photo')
      .map((n) => n.node_id);
    expect(confirmed).toContain('hood_set_in');
    expect(confirmed).toContain('kangaroo_pocket');
  });

  it('у худи люверсы и закрепки помечены спецоборудованием и получили замену', () => {
    const { spec } = build('hoodie');
    for (const id of ['hood_eyelets', 'pocket_bartack']) {
      const node = spec.construction!.nodes.find((n) => n.node_id === id)!;
      expect(node.requires_special_equipment, id).toBe(true);
      expect(node.alternative, id).not.toBeNull();
    }
  });

  it('полотно опознано по фактуре и различается между категориями', () => {
    const shell = (c: Category) => build(c).spec.bom!.lines[0]!.material_id;
    expect(shell('tshirt')).toBe('single_jersey');
    expect(shell('hoodie')).toBe('french_terry_3t');
    expect(shell('sweatshirt')).not.toBe(shell('tshirt'));
  });

  it('прогон воспроизводим', () => {
    for (const category of CATEGORIES) {
      expect(JSON.stringify(build(category).spec.measurements)).toBe(
        JSON.stringify(build(category).spec.measurements),
      );
    }
  });
});
