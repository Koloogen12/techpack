import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildStyleSpec, type StyleSpecInput } from '@seamster/assembly';
import { renderHtml } from '@seamster/docgen';
import { VisionReportSchema } from '@seamster/vision';

/**
 * Масштаб — то, от чего считается весь табель. Документ обязан говорить,
 * измерен он по предмету в кадре или назначен по размерной сетке: разница
 * в точности кратная, и читатель не должен её угадывать.
 */
const base = {
  id: 'scale',
  name: 'Худи',
  article: 'SCALE-1',
  category: 'hoodie',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'oversize',
  fabric_kind: 'knit',
  size_range: [44, 46, 48],
  generated_at: new Date('2026-09-03T00:00:00.000Z'),
} as unknown as StyleSpecInput;

const withA4 = (): StyleSpecInput => {
  const report = VisionReportSchema.parse(
    JSON.parse(readFileSync('golden/vision-reports/hoodie-a4.json', 'utf8')),
  );
  // Спека получает НАБЛЮДЕНИЕ масштаба, а не отчёт целиком: движок сборки
  // не разбирает фотографии, ему передают уже извлечённое.
  return { ...base, scale: report.scale_object } as unknown as StyleSpecInput;
};

describe('масштаб документа', () => {
  it('без предмета в кадре документ говорит, что масштаб назначен', () => {
    const { spec } = buildStyleSpec(base);
    const html = renderHtml(spec, { pro: true });
    expect(html).toContain('Масштаб задан размером, а не измерен');
    expect(html).toContain('лист А4');
  });

  it('якорь без предмета помечен как посчитанный от сетки, а не измеренный', () => {
    const { spec } = buildStyleSpec(base);
    const anchor = spec.measurements.points.find((p) => p.base.source.includes('pom/anchor'));
    expect(anchor?.base.confidence).not.toBe('measured_by_scale');
  });

  it('с листом А4 в кадре масштаб измеряется и документ это говорит', () => {
    const { spec } = buildStyleSpec(withA4());
    const measured = spec.measurements.points.some(
      (p) => p.base.confidence === 'measured_by_scale',
    );
    expect(measured).toBe(true);
    expect(renderHtml(spec, { pro: true })).toContain('Масштаб измерен');
  });
});
