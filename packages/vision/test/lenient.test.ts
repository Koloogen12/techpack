import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { isSeamsterError } from '@seamster/core';
import { parseLenient } from '../src/lenient.js';
import { ObservationsSchema } from '../src/observations.js';
import { DesignFeatureSchema } from '../src/report.js';

/**
 * Структурный вывод не держит перечисления: модель отвечает «hood» там, где
 * список знает только «neckline». Разбор обязан пережить это, а не уронить
 * генерацию (прод, 24.09.2026).
 */
describe('терпимый разбор ответа модели', () => {
  it('значение вне перечисления заменяется на «other», остальное не трогается', () => {
    const schema = z.object({ features: z.array(DesignFeatureSchema) });
    const text = JSON.stringify({
      features: [
        { zone: 'hood', en: 'oversized hood', ru: 'капюшон', confidence: 'high' },
        { zone: 'sleeve', en: 'puff sleeve', ru: 'буф', confidence: 'medium' },
      ],
    });
    const r = parseLenient(schema, text);
    expect(r.value.features[0]!.zone).toBe('other');
    expect(r.value.features[1]!.zone).toBe('sleeve');
    expect(r.coerced).toEqual(['features.0.zone']);
  });

  it('словари: чужое значение → not_visible, не ложное наблюдение', () => {
    const text = JSON.stringify({
      neckline: { value: 'crewneck', confidence: 'high' },
      closure: { value: 'none', confidence: 'high' },
      cuff: { value: 'ribbed', confidence: 'medium' },
      hem: { value: 'rib_band', confidence: 'medium' },
      pocket: { value: 'none', confidence: 'high' },
      sleeve: { value: 'set_in', confidence: 'high' },
      sleeve_length: { value: 'long', confidence: 'high' },
      hood: { value: 'no', confidence: 'high' },
    });
    const r = parseLenient(ObservationsSchema, text);
    expect(r.value.neckline.value).toBe('other');
    expect(r.value.cuff.value).toBe('other');
    expect(r.value.hem.value).toBe('rib_band');
    expect(r.coerced.sort()).toEqual(['cuff.value', 'neckline.value']);
  });

  it('JSON в ограждении читается, не-JSON и чужая форма — честная ошибка', () => {
    const schema = z.object({ a: z.number() });
    expect(parseLenient(schema, '```json\n{"a": 1}\n```').value.a).toBe(1);
    for (const bad of ['нет json', '{"a": "строка"}']) {
      try {
        parseLenient(schema, bad);
        expect.unreachable();
      } catch (e) {
        expect(isSeamsterError(e) && e.code === 'VISION_SCHEMA_MISMATCH').toBe(true);
      }
    }
  });
});
