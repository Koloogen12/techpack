import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isSeamsterlyError } from '@seamsterly/core';
import { generate } from '@seamsterly/cli';
import { kb } from '@seamsterly/kb';
import {
  FileVisionCache,
  cacheKey,
  defaultModel,
  hashPhoto,
  promptFingerprint,
  type VisionReport,
} from '@seamsterly/vision';
import { checkSpec } from './invariants.js';

/**
 * Полный путь с разбором фотографий — без обращения к API.
 *
 * Отчёт кладётся в кэш заранее, поэтому пайплайн проходит ровно тот же код,
 * что и на живом вызове: чтение кэша, перенос пропорций в замеры, подтверждение
 * узлов, уточнение полотна, сверка с ответами пользователя. Тест идёт без
 * ключа и без сети, но проверяет настоящую ветку, а не заглушку.
 */

const tmp = mkdtempSync(join(tmpdir(), 'specform-vision-path-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const AT = new Date('2026-08-25T00:00:00.000Z');

// Однопиксельный PNG: содержимое не важно, разбор берётся из кэша.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const ANSWERS = {
  id: 'vision-path',
  name: 'Футболка по фото',
  article: 'TSH-VP-001',
  category: 'tshirt' as const,
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'semi_fitted',
  fabric_kind: 'knit',
  size_range: [42, 44, 46, 48, 50, 52],
};

/** Отпечаток ответов считается так же, как в станке. */
const fingerprint = [
  ANSWERS.category,
  ANSWERS.gender,
  ANSWERS.base_size_ru,
  ANSWERS.base_height_cm,
  ANSWERS.fit_intent,
  ANSWERS.fabric_kind,
].join('|');

const REPORT: VisionReport = {
  category: { value: 'tshirt', confidence: 'high', other_description: '' },
  silhouette: { value: 'semi_fitted', confidence: 'medium' },
  fabric: { knit_class: 'interlock', confidence: 'medium', is_knit: true },
  proportions: [
    { pom_code: 'T01', ratio_to_chest: 1.46, confidence: 'high', reason: 'контур виден целиком' },
    { pom_code: 'T06', ratio_to_chest: 0.86, confidence: 'low', reason: 'плечи размыты на тёмном' },
    { pom_code: 'T10', ratio_to_chest: 0.46, confidence: 'medium', reason: 'край рукава чёткий' },
    { pom_code: 'T13', ratio_to_chest: 0.31, confidence: 'medium', reason: 'край рукава чёткий' },
  ],
  visible_elements: [
    { key: 'neckline_type', value: 'бейка-риб кольцом', confidence: 'high' },
    { key: 'fabric_class', value: 'мелкий рубчик, двойная гладь', confidence: 'medium' },
  ],
  topstitching: [
    { location: 'hem', rows: 2, confidence: 'high' },
    { location: 'sleeve_hem', rows: 2, confidence: 'high' },
  ],
  colorways: [{ name_ru: 'Чёрный', hex_approx: '#121212' }],
  not_visible: [
    { key: 'interlining', reason: 'изнанка не показана' },
    { key: 'fabric_weight', reason: 'плотность по фото не определяется' },
    { key: 'knitting_method', reason: 'признака нет в нашей карте видимости' },
  ],
  scale_object: {
    kind: 'none' as const,
    side: 'long_side' as const,
    ratio_to_anchor: 0,
    coplanar: false,
    confidence: 'low' as const,
    reason: 'опорного предмета в кадре нет',
  },

  photo_quality_notes: ['Изделие снято на манекене, а не разложено плоско'],
};

function prime(over: Partial<VisionReport> = {}): { answersPath: string; photoPath: string } {
  const photoPath = join(tmp, 'photo.png');
  writeFileSync(photoPath, PNG);

  const answersPath = join(tmp, 'answers.json');
  writeFileSync(answersPath, JSON.stringify(ANSWERS));

  // Ключ строится ровно так же, как его строит продукт, включая отпечаток
  // промпта: разойдись они — тест бы «прогревал» кэш мимо, и мы бы узнали
  // об этом попыткой сходить в платный API прямо из теста.
  const key = cacheKey({
    photoHashes: [hashPhoto(PNG)],
    views: [undefined],
    category: ANSWERS.category,
    answersFingerprint: fingerprint,
    promptFingerprint: promptFingerprint(kb(), ANSWERS.category),
    model: defaultModel(),
  });
  new FileVisionCache(join(tmp, 'cache')).set(key, { ...REPORT, ...over });

  return { answersPath, photoPath };
}

const run = async (over: Partial<VisionReport> = {}, out = 'vision.pdf') => {
  const { answersPath, photoPath } = prime(over);
  return generate({
    answersPath,
    photoPaths: [photoPath],
    outPath: join(tmp, out),
    cacheDir: join(tmp, 'cache'),
    now: AT,
  });
};

describe('разбор фотографий доезжает до документа', () => {
  it('берётся из кэша и не тратит токены', async () => {
    const result = await run();
    expect(result.vision.used).toBe(true);
    expect(result.vision.fromCache).toBe(true);
    expect(result.cost.usd).toBe(0);
  }, 120_000);

  it('ключ кэша сохраняется в спеке — по нему прогон воспроизводится', async () => {
    const result = await run();
    expect(result.spec.meta.vision_cache_key).toBe(result.vision.cacheKey);
  }, 120_000);

  it('пропорции с фото становятся замерами со статусом «оценка по фото»', async () => {
    const { spec } = await run();
    const t01 = spec.measurements.points.find((p) => p.code === 'T01')!;
    expect(t01.base.confidence).toBe('estimated_from_photo');
    expect(t01.base.source).toContain('vision');
  }, 120_000);

  it('низкая уверенность модели доезжает до примечания у значения', async () => {
    const { spec } = await run();
    const t06 = spec.measurements.points.find((p) => p.code === 'T06')!;
    expect(t06.base.note).toContain('низкая');
    expect(t06.base.note).toContain('плечи размыты');
  }, 120_000);

  it('точки, которых модель не увидела, остаются типовыми', async () => {
    const { spec } = await run();
    const t04 = spec.measurements.points.find((p) => p.code === 'T04')!;
    expect(t04.base.confidence).toBe('default_from_base');
  }, 120_000);

  it('увиденный узел получает статус «оценка по фото»', async () => {
    const { spec } = await run();
    const neck = spec.construction!.nodes.find((n) => n.node_id === 'neck_rib_band')!;
    expect(neck.presence.confidence).toBe('estimated_from_photo');
    expect(neck.presence.note).toContain('бейка-риб');
  }, 120_000);

  it('опознанное полотно попадает в спецификацию', async () => {
    const { spec } = await run();
    expect(spec.bom!.lines[0]!.material_id).toBe('interlock');
  }, 120_000);

  it('цвет с фото становится колорвеем', async () => {
    const { spec } = await run();
    expect(spec.bom!.colorways[0]!.name_ru).toBe('Чёрный');
    expect(spec.labels!.sku_matrix[0]!.sku).toContain('C1');
  }, 120_000);

  it('замечания к съёмке доходят до отчёта', async () => {
    const { notes } = await run();
    expect(notes.join(' ')).toContain('манекене');
  }, 120_000);

  it('признак вне нашей карты видимости отмечается как кандидат в справочник', async () => {
    const { notes } = await run();
    expect(notes.join(' ')).toContain('knitting_method');
  }, 120_000);

  it('документ на этом входе не нарушает инвариантов', async () => {
    const { spec } = await run();
    expect(checkSpec(spec).map((v) => `${v.rule}: ${v.detail}`)).toEqual([]);
  }, 120_000);
});

describe('расхождения между фото и ответами', () => {
  it('другая категория на фото попадает в отчёт, а документ строится по ответу', async () => {
    const { spec, notes } = await run(
      { category: { value: 'hoodie', confidence: 'high', other_description: '' } },
      'mismatch-category.pdf',
    );
    expect(spec.style.category).toBe('tshirt');
    expect(notes.join(' ')).toContain('Расхождение по категории');
    expect(notes.join(' ')).toContain('худи');
  }, 120_000);

  it('ткань вместо трикотажа отмечается — от этого зависят допуски и узлы', async () => {
    const { notes } = await run(
      { fabric: { knit_class: 'unknown', confidence: 'low', is_knit: false } },
      'mismatch-fabric.pdf',
    );
    expect(notes.join(' ')).toContain('Расхождение по материалу');
  }, 120_000);

  it('другая посадка на фото отмечается только при высокой уверенности', async () => {
    const loud = await run(
      { silhouette: { value: 'oversize', confidence: 'high' } },
      'mismatch-fit.pdf',
    );
    expect(loud.notes.join(' ')).toContain('Расхождение по посадке');

    const quiet = await run(
      { silhouette: { value: 'oversize', confidence: 'low' } },
      'quiet-fit.pdf',
    );
    expect(quiet.notes.join(' ')).not.toContain('Расхождение по посадке');
  }, 180_000);

  it('изделие вне трикотажного ядра получает отказ, а не документ похуже', async () => {
    try {
      await run(
        {
          category: {
            value: 'other',
            confidence: 'high',
            other_description: 'Пальто из шерстяного драпа с подкладкой',
          },
        },
        'gate.pdf',
      );
      expect.unreachable('должно было отказать');
    } catch (e) {
      expect(isSeamsterlyError(e)).toBe(true);
      if (isSeamsterlyError(e)) {
        expect(e.code).toBe('CATEGORY_UNSUPPORTED');
        expect(e.userMessage).toContain('Пальто');
      }
    }
  }, 120_000);

  it('низкая уверенность в «это другое» не блокирует — доверяем человеку', async () => {
    const result = await run(
      { category: { value: 'other', confidence: 'low', other_description: 'непонятно' } },
      'low-gate.pdf',
    );
    expect(result.spec.style.category).toBe('tshirt');
  }, 120_000);
});

describe('параллельная работа', () => {
  it('пять генераций одновременно дают одинаковый отпечаток и не мешают друг другу', async () => {
    const { answersPath, photoPath } = prime();
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        generate({
          answersPath,
          photoPaths: [photoPath],
          outPath: join(tmp, `parallel-${i}.pdf`),
          cacheDir: join(tmp, 'cache'),
          now: AT,
        }),
      ),
    );

    const fingerprints = new Set(results.map((r) => r.fingerprint));
    expect(fingerprints.size).toBe(1);
    for (const r of results) expect(r.vision.fromCache).toBe(true);
  }, 300_000);
});
