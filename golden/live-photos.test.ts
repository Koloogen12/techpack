import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildStyleSpec, scaleAdvice } from '@specform/assembly';
import { VisionReportSchema, type VisionReport } from '@specform/vision';
import type { Category } from '@specform/kb';
import { parseAnswers, specInputFrom, type Answers } from '@specform/cli';
import { checkSpec } from './invariants.js';
import { GOLDEN_SHOTS } from './shots.js';

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

/**
 * Категории берутся из СПИСКА НАБОРА, а не из содержимого каталога отчётов.
 * В каталоге лежат ещё и специальные сценарии вроде `hoodie-a4`, у которых
 * своей анкеты нет: обход по файлам сломался бы на первом же таком.
 */
const CATEGORIES = GOLDEN_SHOTS.filter((s) => s.id === s.category).map((s) => s.category);

const AT = new Date('2026-08-25T00:00:00.000Z');

function load(id: string): { answers: Answers; report: VisionReport } {
  const shot = GOLDEN_SHOTS.find((s) => s.id === id)!;
  const answers = parseAnswers(
    JSON.parse(readFileSync(new URL(`./answers/${shot.answers}`, import.meta.url), 'utf8')),
  );
  const report = VisionReportSchema.parse(JSON.parse(readFileSync(`${DIR}${id}.json`, 'utf8')));
  return { answers, report };
}

/**
 * Спека собирается ТЕМ ЖЕ кодом, что и в пайплайне. Пока сборка входа была
 * здесь своей, тест проверял не то, что получает пользователь: масштабный
 * объект, класс полотна и колорвеи в него просто не доходили.
 */
function build(id: string) {
  const { answers, report } = load(id);
  return buildStyleSpec(specInputFrom(answers, report, { now: AT }));
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

describe('масштабный объект на живом снимке', () => {
  /**
   * Тот же худи, но с листом А4 на груди. Отчёт получен настоящим вызовом
   * модели и закоммичен — распознавание масштаба проверяется живым выходом,
   * а не выдуманным наблюдением.
   */
  const scaled = () => build('hoodie-a4');

  it('модель находит лист и не пытается назвать его размер сама', () => {
    const { report } = load('hoodie-a4');
    expect(report.scale_object.kind).toBe('a4_sheet');
    expect(report.scale_object.ratio_to_anchor).toBeGreaterThan(0);
    // Схема не содержит поля «размер предмета» вовсе: величину, заданную
    // стандартом, нельзя ставить в зависимость от увиденного на снимке.
    expect(report.scale_object).not.toHaveProperty('known_cm');
  });

  it('ширина по груди становится измерением, а не оценкой', () => {
    const chest = scaled().spec.measurements.points.find((p) => p.code === 'T03')!;
    expect(chest.base.confidence).toBe('measured_by_scale');
  });

  it('пересчёт даёт правдоподобную вещь, а не число из воздуха', () => {
    const chest = scaled().spec.measurements.points.find((p) => p.code === 'T03')!;
    expect(chest.base.value).toBeGreaterThan(35);
    expect(chest.base.value).toBeLessThan(90);
  });

  it('расхождение с заявленным размером названо вслух', () => {
    // Вещь на сгенерированном снимке заметно уже, чем оверсайз-худи RU 46:
    // документ обязан сказать об этом, а не молча собраться по измерению.
    expect(scaled().notes.some((n) => n.includes('расходятся'))).toBe(true);
  });

  it('документ на масштабном кадре не нарушает инвариантов', () => {
    expect(checkSpec(scaled().spec).map((v) => `${v.rule}: ${v.detail}`)).toEqual([]);
  });

  it('без масштаба совет положить предмет в кадр звучит, с масштабом — нет', () => {
    expect(scaleAdvice(false).length).toBe(1);
    expect(scaleAdvice(true)).toEqual([]);
  });
});
