import { describe, expect, it } from 'vitest';
import { kb } from '@seamster/kb';
import { resolveCategory } from '../src/generate.js';
import type { Answers } from '../src/answers.js';
import type { VisionReport } from '@seamster/vision';

const base = kb();

const ANSWERS: Answers = {
  id: 'rc',
  name: 'Джемпер',
  article: 'RC-001',
  category: 'cardigan',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'fitted',
  fabric_kind: 'knit',
  size_range: [44, 46, 48],
  category_source: 'quicklook',
};

const report = (value: string, confidence: 'high' | 'medium' | 'low'): VisionReport =>
  ({ category: { value, confidence, other_description: '' } }) as unknown as VisionReport;

/**
 * Быстрый взгляд подставляет категорию черновиком; полный разбор её уточняет,
 * если человек черновик не трогал. Названная руками категория остаётся его
 * словом, и расхождение идёт в очередь решений, а не в тихую подмену.
 */
describe('категория для сборки', () => {
  it('подставленную быстрым взглядом категорию уточняет полный разбор', () => {
    const r = resolveCategory(ANSWERS, report('sweater', 'medium'), base);
    expect(r.answers.category).toBe('sweater');
    expect(r.note).toMatch(/Категория взята по фото/);
  });

  it('названную человеком категорию разбор не подменяет', () => {
    const r = resolveCategory(
      { ...ANSWERS, category_source: 'user' },
      report('sweater', 'high'),
      base,
    );
    expect(r.answers.category).toBe('cardigan');
    expect(r.note).toBeNull();
  });

  it('низкая уверенность, «other» и неподдерживаемая категория оставляют анкету', () => {
    expect(resolveCategory(ANSWERS, report('sweater', 'low'), base).answers.category).toBe(
      'cardigan',
    );
    expect(resolveCategory(ANSWERS, report('other', 'high'), base).answers.category).toBe(
      'cardigan',
    );
    expect(resolveCategory(ANSWERS, report('kimono', 'high'), base).answers.category).toBe(
      'cardigan',
    );
    expect(resolveCategory(ANSWERS, null, base).answers.category).toBe('cardigan');
  });
});
