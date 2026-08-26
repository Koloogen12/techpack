import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isSeamsterlyError } from '@seamsterly/core';
import { ArtworkLibrary, type ArtworkAsset } from '../src/index.js';

const dirs: string[] = [];
const tempLibrary = (): ArtworkLibrary => {
  const dir = mkdtempSync(join(tmpdir(), 'specform-lib-'));
  dirs.push(dir);
  return new ArtworkLibrary(dir);
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const asset = (over: Partial<ArtworkAsset> = {}): ArtworkAsset => ({
  id: 'botanical',
  kind: 'tile',
  label_ru: 'Ботанический раппорт',
  file: 'botanical.png',
  pixels: { width: 2048, height: 2048 },
  key: 'a'.repeat(64),
  brief: 'листья и дуги',
  seam: { ratio: 0, seamless: true, mirrored: true },
  colors: [{ hex: '#F4F4EC', share: 0.68 }],
  vector_available: true,
  vector_verdict_ru: 'Вектор построен.',
  created_at: '2026-08-26',
  used_in: [],
  ...over,
});

const BYTES = new Uint8Array([137, 80, 78, 71]);

/**
 * Рисунок — актив бренда, а не приложение к одному техпаку: одна графика
 * идёт на футболку, худи и свитшот капсулы. Переносить паспорт между
 * паками руками значит однажды ошибиться в цифре шага и не заметить.
 */
describe('библиотека артов', () => {
  it('сохранённый арт читается обратно целиком', () => {
    const lib = tempLibrary();
    lib.save(asset(), BYTES);
    const back = lib.get('botanical');
    expect(back.pixels.width).toBe(2048);
    expect(back.seam?.mirrored).toBe(true);
    expect(back.colors[0]!.hex).toBe('#F4F4EC');
  });

  it('незнакомое имя объясняет, что есть в наличии', () => {
    const lib = tempLibrary();
    lib.save(asset({ id: 'stripes', file: 'stripes.png' }), BYTES);
    try {
      lib.get('botanical');
      expect.unreachable('должно было упасть');
    } catch (e) {
      expect(isSeamsterlyError(e)).toBe(true);
      if (isSeamsterlyError(e)) expect(e.userAction).toContain('stripes');
    }
  });

  it('пустая библиотека не роняет перечисление', () => {
    expect(tempLibrary().list()).toEqual([]);
  });

  it('битый паспорт равен отсутствующему, а не наполовину разобранному', () => {
    // Подсунуть в документ полуразобранный арт хуже, чем честно его не найти.
    const dir = mkdtempSync(join(tmpdir(), 'specform-lib-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'broken.json'), '{сломано');
    expect(new ArtworkLibrary(dir).list()).toEqual([]);
  });

  it('использование в паке отмечается и не дублируется', () => {
    // «Использован в 7 паках» не должно означать семь перегенераций одного.
    const lib = tempLibrary();
    lib.save(asset(), BYTES);
    lib.markUsed('botanical', 'GLD-001');
    lib.markUsed('botanical', 'GLD-001');
    lib.markUsed('botanical', 'GLD-002');
    expect(lib.get('botanical').used_in).toEqual(['GLD-001', 'GLD-002']);
  });

  it('имя арта проверяется — по нему строится путь к файлу', () => {
    const lib = tempLibrary();
    expect(() => lib.save(asset({ id: '../побег' }), BYTES)).toThrow();
    expect(() => lib.save(asset({ id: 'ВЕРХНИЙ' }), BYTES)).toThrow();
  });

  it('арт заказчика живёт без отпечатка генерации', () => {
    // Свой файл заказчика мы не генерировали и перегенерировать не будем.
    const lib = tempLibrary();
    lib.save(asset({ key: null, brief: null, seam: null }), BYTES);
    const back = lib.get('botanical');
    expect(back.key).toBeNull();
    expect(back.seam).toBeNull();
  });
});
