import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { afterAll, describe, expect, it } from 'vitest';
import { CostLedger, isSpecFormError } from '@specform/core';
import { kb } from '@specform/kb';
import {
  FileVisionCache,
  MAX_PHOTOS,
  MemoryVisionCache,
  PROMPT_VERSION,
  VisionReportSchema,
  analyzePhotos,
  buildSystemPrompt,
  buildUserPrompt,
  cacheKey,
  hashPhoto,
  type Photo,
  type VisionReport,
} from '../src/index.js';

const base = kb();

const REPORT: VisionReport = {
  category: { value: 'tshirt', confidence: 'high', other_description: '' },
  silhouette: { value: 'semi_fitted', confidence: 'medium' },
  fabric: { knit_class: 'single_jersey', confidence: 'medium', is_knit: true },
  proportions: [
    { pom_code: 'T01', ratio_to_chest: 1.34, confidence: 'high', reason: 'контур виден целиком' },
    { pom_code: 'T06', ratio_to_chest: 0.84, confidence: 'medium', reason: 'плечевые точки' },
  ],
  visible_elements: [{ key: 'neckline_type', value: 'бейка-риб', confidence: 'high' }],
  topstitching: [{ location: 'hem', rows: 2, confidence: 'high' }],
  colorways: [{ name_ru: 'Чёрный', hex_approx: '#111111' }],
  not_visible: [{ key: 'interlining', reason: 'изнанка не показана' }],
  photo_quality_notes: [],
};

const photo = (byte: number): Photo => ({
  bytes: new Uint8Array([byte, byte, byte]),
  format: 'png',
});

/** Подставной клиент: тесты не ходят в сеть и не тратят токены. */
function fakeClient(onCall?: () => void): Anthropic {
  return {
    messages: {
      parse: async () => {
        onCall?.();
        return {
          stop_reason: 'end_turn',
          parsed_output: REPORT,
          usage: {
            input_tokens: 14_000,
            output_tokens: 4_000,
            cache_creation_input_tokens: 2_000,
            cache_read_input_tokens: 0,
          },
        };
      },
    },
  } as unknown as Anthropic;
}

const tmp = mkdtempSync(join(tmpdir(), 'specform-vision-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('промпт', () => {
  const system = buildSystemPrompt(base);

  it('запрещает называть сантиметры — это ядро ограничения', () => {
    expect(system).toContain('не называешь сантиметры');
  });

  it('перечисляет все точки измерения, кроме якоря', () => {
    const template = base.pomTemplate('tshirt');
    for (const p of template.points) {
      if (p.derivation === 'anchor') continue;
      expect(system).toContain(p.code);
      expect(system).toContain(p.name_ru);
    }
  });

  it('собирается из справочников, а не пишется руками', () => {
    for (const f of base.visibilityMap().visible) expect(system).toContain(f.key);
    for (const f of base.visibilityMap().not_visible) expect(system).toContain(f.key);
  });

  it('требует считать параллельные строчки — по ним определяется машина', () => {
    expect(system).toContain('ПАРАЛЛЕЛЬНЫХ');
    expect(system).toContain('распошивальную');
  });

  it('прямо разрешает низкую уверенность вместо выдумки', () => {
    expect(system).toContain('Низкая уверенность лучше выдумки');
  });

  it('различает один и несколько снимков', () => {
    expect(buildUserPrompt(1)).not.toBe(buildUserPrompt(3));
    expect(buildUserPrompt(3)).toContain('3');
  });
});

describe('ключ кэша', () => {
  const input = { photoHashes: ['a', 'b'], answersFingerprint: 'x', model: 'claude-opus-5' };

  it('не зависит от порядка фотографий', () => {
    expect(cacheKey({ ...input, photoHashes: ['b', 'a'] })).toBe(cacheKey(input));
  });

  it('меняется от смены модели — иначе дрейф точности пройдёт незамеченным', () => {
    expect(cacheKey({ ...input, model: 'claude-sonnet-5' })).not.toBe(cacheKey(input));
  });

  it('меняется от смены фотографий', () => {
    expect(cacheKey({ ...input, photoHashes: ['a', 'c'] })).not.toBe(cacheKey(input));
  });

  it('меняется от смены ответов мастера', () => {
    expect(cacheKey({ ...input, answersFingerprint: 'y' })).not.toBe(cacheKey(input));
  });

  it('версия промпта участвует в ключе', () => {
    expect(PROMPT_VERSION).toBeTruthy();
    expect(cacheKey(input)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('хеш фотографии устойчив', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(hashPhoto(bytes)).toBe(hashPhoto(new Uint8Array([1, 2, 3])));
    expect(hashPhoto(bytes)).not.toBe(hashPhoto(new Uint8Array([1, 2, 4])));
  });
});

describe('детерминизм через кэш', () => {
  it('второй прогон того же входа не идёт в API', async () => {
    let calls = 0;
    const cache = new MemoryVisionCache();
    const opts = {
      photos: [photo(1)],
      answersFingerprint: 'a',
      cache,
      client: fakeClient(() => calls++),
    };

    const first = await analyzePhotos(opts);
    const second = await analyzePhotos(opts);

    expect(calls).toBe(1);
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.cacheKey).toBe(first.cacheKey);
    expect(JSON.stringify(second.report)).toBe(JSON.stringify(first.report));
  });

  it('повтор из кэша стоит ноль — бесплатная перегенерация не тратит токены', async () => {
    const cache = new MemoryVisionCache();
    const ledger = new CostLedger();
    const opts = {
      photos: [photo(2)],
      answersFingerprint: 'a',
      cache,
      ledger,
      client: fakeClient(),
    };

    await analyzePhotos(opts);
    const afterFirst = ledger.totalUsd();
    await analyzePhotos(opts);

    expect(afterFirst).toBeGreaterThan(0);
    expect(ledger.totalUsd()).toBe(afterFirst);
  });

  it('файловый кэш переживает перезапуск процесса', async () => {
    const dir = join(tmp, 'restart');
    const opts = { photos: [photo(3)], answersFingerprint: 'a', client: fakeClient() };

    const first = await analyzePhotos({ ...opts, cache: new FileVisionCache(dir) });
    const second = await analyzePhotos({ ...opts, cache: new FileVisionCache(dir) });

    expect(second.fromCache).toBe(true);
    expect(second.cacheKey).toBe(first.cacheKey);
  });

  it('битая запись в кэше равна отсутствующей, а не отравляет документ', () => {
    const dir = join(tmp, 'broken');
    const cache = new FileVisionCache(dir);
    cache.set('f'.repeat(64), { ...REPORT, proportions: [] });
    expect(cache.get('f'.repeat(64))).toBeDefined();
    expect(cache.get('0'.repeat(64))).toBeUndefined();
  });
});

describe('учёт себестоимости', () => {
  it('записывает токены и стоимость вызова', async () => {
    const ledger = new CostLedger();
    await analyzePhotos({
      photos: [photo(4)],
      answersFingerprint: 'a',
      ledger,
      client: fakeClient(),
    });

    const entry = ledger.entries()[0]!;
    expect(entry.stage).toBe('vision');
    expect(entry.inputTokens).toBe(14_000);
    expect(entry.cacheWriteTokens).toBe(2_000);
    // Порядок величины: техпак обязан стоить центы, а не доллары.
    expect(entry.usd).toBeGreaterThan(0);
    expect(entry.usd).toBeLessThan(0.5);
  });
});

describe('границы входа', () => {
  it('без фотографий — понятная ошибка', async () => {
    await expect(
      analyzePhotos({ photos: [], answersFingerprint: 'a', client: fakeClient() }),
    ).rejects.toThrow();
  });

  it('больше шести фотографий не принимаем', async () => {
    try {
      await analyzePhotos({
        photos: Array.from({ length: MAX_PHOTOS + 1 }, (_, i) => photo(i)),
        answersFingerprint: 'a',
        client: fakeClient(),
      });
      expect.unreachable('должно было упасть');
    } catch (e) {
      expect(isSpecFormError(e)).toBe(true);
      if (isSpecFormError(e)) expect(e.userAction).toContain('удалите');
    }
  });

  it('ответ не по схеме останавливает пайплайн, а не едет в документ', async () => {
    const broken = {
      messages: {
        parse: async () => ({ stop_reason: 'end_turn', parsed_output: null, usage: {} }),
      },
    } as unknown as Anthropic;

    try {
      await analyzePhotos({ photos: [photo(9)], answersFingerprint: 'a', client: broken });
      expect.unreachable('должно было упасть');
    } catch (e) {
      expect(isSpecFormError(e)).toBe(true);
      if (isSpecFormError(e)) expect(e.code).toBe('VISION_SCHEMA_MISMATCH');
    }
  });
});

describe('схема отчёта', () => {
  it('принимает эталонный отчёт', () => {
    expect(() => VisionReportSchema.parse(REPORT)).not.toThrow();
  });

  it('отвергает отчёт без блока «что не видно» — это половина ценности', () => {
    const { not_visible: _omitted, ...rest } = REPORT;
    expect(() => VisionReportSchema.parse(rest)).toThrow();
  });
});
