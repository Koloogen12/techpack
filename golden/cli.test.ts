import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isSeamsterlyError } from '@seamsterly/core';
import { generate, parseAnswers } from '@seamsterly/cli';
import { parseStyleSpec } from '@seamsterly/stylespec';

/**
 * Сквозной прогон станка: файл ответов на входе, PDF на выходе.
 *
 * Здесь проверяется то, что не видно на уровне отдельных пакетов: доходит ли
 * документ до диска, режется ли по ролям, ловятся ли кривые входы понятной
 * ошибкой вместо стека вызовов.
 *
 * Фотографии не используются: тест обязан идти без ключа API и без сети.
 */

const tmp = mkdtempSync(join(tmpdir(), 'seamsterly-cli-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const ANSWERS = {
  id: 'e2e',
  name: 'Базовая футболка',
  article: 'TSH-E2E-001',
  category: 'tshirt',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'semi_fitted',
  fabric_kind: 'knit',
  size_range: [42, 44, 46, 48, 50, 52],
};

function answersFile(over: Record<string, unknown> = {}, name = 'answers.json'): string {
  const path = join(tmp, name);
  writeFileSync(path, JSON.stringify({ ...ANSWERS, ...over }));
  return path;
}

const AT = new Date('2026-08-25T00:00:00.000Z');

describe('сквозная генерация', () => {
  it('делает PDF, выгрузки по ролям и снимок спеки', async () => {
    const result = await generate({
      answersPath: answersFile(),
      photoPaths: [],
      outPath: join(tmp, 'pack.pdf'),
      roles: ['qc', 'supply'],
      writeSpec: true,
      now: AT,
    });

    expect(statSync(result.pdfPath).size).toBeGreaterThan(10_000);
    expect(result.rolePaths.map((r) => r.role)).toEqual(['qc', 'supply']);
    for (const r of result.rolePaths) expect(statSync(r.path).size).toBeGreaterThan(3_000);
    expect(result.specPath).toBeTruthy();
    expect(() => parseStyleSpec(JSON.parse(readFileSync(result.specPath!, 'utf8')))).not.toThrow();
  }, 120_000);

  it('выгрузка для ОТК легче полной — в ней только табель мер', async () => {
    const result = await generate({
      answersPath: answersFile(),
      photoPaths: [],
      outPath: join(tmp, 'weights.pdf'),
      roles: ['qc'],
      now: AT,
    });
    const full = statSync(result.pdfPath).size;
    const qc = statSync(result.rolePaths[0]!.path).size;
    expect(qc).toBeLessThan(full);
  }, 120_000);

  it('без фотографий разбор не запускается и не тратит токены', async () => {
    const result = await generate({
      answersPath: answersFile(),
      photoPaths: [],
      outPath: join(tmp, 'nophoto.pdf'),
      now: AT,
    });
    expect(result.vision.used).toBe(false);
    expect(result.cost.usd).toBe(0);
  }, 120_000);

  it('два прогона одного входа дают одинаковый отпечаток спеки', async () => {
    const answers = answersFile({}, 'repeat.json');
    const a = await generate({
      answersPath: answers,
      photoPaths: [],
      outPath: join(tmp, 'a.pdf'),
      now: AT,
    });
    const b = await generate({
      answersPath: answers,
      photoPaths: [],
      outPath: join(tmp, 'b.pdf'),
      now: new Date('2030-01-01T00:00:00.000Z'),
    });
    // Время генерации разное, содержание — то же.
    expect(b.fingerprint).toBe(a.fingerprint);
  }, 180_000);

  it('время сборки укладывается в требование продукта', async () => {
    const started = Date.now();
    await generate({
      answersPath: answersFile(),
      photoPaths: [],
      outPath: join(tmp, 'speed.pdf'),
      now: AT,
    });
    // PRD: полный пакет не дольше пяти минут. Без разбора фото — секунды.
    expect(Date.now() - started).toBeLessThan(60_000);
  }, 120_000);
});

describe('кривые входы отвечают человеку, а не стеком вызовов', () => {
  const broken: [string, Record<string, unknown>][] = [
    ['базовый размер вне ряда', { base_size_ru: 60 }],
    ['ряд не по возрастанию', { size_range: [52, 42, 46] }],
    ['пустой ряд размеров', { size_range: [] }],
    ['отрицательный рост', { base_height_cm: -170 }],
    ['неизвестная категория', { category: 'пальто' }],
    ['неизвестная посадка', { fit_intent: 'очень свободная' }],
    ['пустое название', { name: '' }],
    ['нет артикула', { article: undefined }],
    ['ручной замер несуществующей точки', { manual: { code: 'ZZ9', value_cm: 50 } }],
    ['нулевой ручной замер', { manual: { code: 'T01', value_cm: 0 } }],
  ];

  it.each(broken)(
    '%s',
    async (_name, over) => {
      try {
        await generate({
          answersPath: answersFile(over, `broken-${Math.abs(hash(JSON.stringify(over)))}.json`),
          photoPaths: [],
          outPath: join(tmp, 'broken.pdf'),
          now: AT,
        });
        expect.unreachable('должно было упасть');
      } catch (e) {
        expect(isSeamsterlyError(e), String(e)).toBe(true);
        if (isSeamsterlyError(e)) {
          expect(e.userMessage.length).toBeGreaterThan(10);
          expect(e.userAction.length).toBeGreaterThan(10);
          // Технические подробности наружу не отдаются.
          expect(e.userMessage).not.toContain('undefined');
          expect(e.userMessage).not.toContain('zod');
        }
      }
    },
    60_000,
  );

  it('категория вне трикотажного ядра получает честный отказ', () => {
    try {
      parseAnswers({ ...ANSWERS, category: 'dress' });
      expect.unreachable('должно было упасть');
    } catch (e) {
      expect(isSeamsterlyError(e)).toBe(true);
    }
  });

  it('неподдерживаемый формат фото объясняется до вызова API', async () => {
    const notAnImage = join(tmp, 'file.txt');
    writeFileSync(notAnImage, 'не картинка');
    try {
      await generate({
        answersPath: answersFile(),
        photoPaths: [notAnImage],
        outPath: join(tmp, 'bad-photo.pdf'),
        now: AT,
      });
      expect.unreachable('должно было упасть');
    } catch (e) {
      expect(isSeamsterlyError(e)).toBe(true);
      if (isSeamsterlyError(e)) expect(e.code).toBe('PHOTO_UNUSABLE');
    }
  }, 60_000);
});

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

describe('файл анкеты', () => {
  it('отсутствующий файл объясняется человеку, а не системной ошибкой', async () => {
    try {
      await generate({
        answersPath: join(tmp, 'нет-такого.json'),
        photoPaths: [],
        outPath: join(tmp, 'missing.pdf'),
        now: AT,
      });
      expect.unreachable('должно было упасть');
    } catch (e) {
      expect(isSeamsterlyError(e), String(e)).toBe(true);
      if (isSeamsterlyError(e)) {
        expect(e.userMessage).toContain('Не нашли файл');
        // Системный текст наружу не отдаётся.
        expect(e.userMessage).not.toContain('ENOENT');
      }
    }
  }, 60_000);

  it('битый JSON объясняется человеку и подсказывает, где смотреть', async () => {
    const path = join(tmp, 'broken.json');
    writeFileSync(path, '{"name": ');
    try {
      await generate({ answersPath: path, photoPaths: [], outPath: join(tmp, 'b.pdf'), now: AT });
      expect.unreachable('должно было упасть');
    } catch (e) {
      expect(isSeamsterlyError(e)).toBe(true);
      if (isSeamsterlyError(e)) {
        expect(e.userMessage).toContain('не JSON');
        expect(e.userAction).toContain('запятая');
      }
    }
  }, 60_000);
});

describe('пустые по смыслу значения', () => {
  const blank: [string, Record<string, unknown>][] = [
    ['пробелы вместо названия', { name: '   ' }],
    ['пробелы вместо артикула', { article: ' ' }],
    ['перенос строки вместо бренда', { brand: '\n' }],
  ];

  it.each(blank)(
    '%s отвергается',
    async (_name, over) => {
      // Строка из пробелов формально непустая, но в документе это пропуск.
      await expect(
        generate({
          answersPath: answersFile(over, `blank-${Math.abs(hash(JSON.stringify(over)))}.json`),
          photoPaths: [],
          outPath: join(tmp, 'blank.pdf'),
          now: AT,
        }),
      ).rejects.toThrow();
    },
    60_000,
  );

  it('лишние пробелы по краям обрезаются, а не попадают в документ', async () => {
    const result = await generate({
      answersPath: answersFile({ name: '  Базовая футболка  ' }, 'trim.json'),
      photoPaths: [],
      outPath: join(tmp, 'trim.pdf'),
      now: AT,
    });
    expect(result.spec.style.name).toBe('Базовая футболка');
  }, 60_000);

  it('цвет не в формате #RRGGBB отвергается', async () => {
    await expect(
      generate({
        answersPath: answersFile(
          { colorways: [{ id: 'black', name_ru: 'Чёрный', hex_approx: 'чёрный' }] },
          'badhex.json',
        ),
        photoPaths: [],
        outPath: join(tmp, 'badhex.pdf'),
        now: AT,
      }),
    ).rejects.toThrow();
  }, 60_000);
});
