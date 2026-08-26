import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '@seamsterly/assembly';
import type { StyleSpec } from '@seamsterly/stylespec';
import {
  FileRenderCache,
  MemoryRenderCache,
  buildRenderPrompt,
  renderKey,
  visualize,
  defaultImageModels,
  generateImage,
} from '../src/index.js';

const AT = new Date('2026-08-25T00:00:00.000Z');

const INPUT: StyleSpecInput = {
  id: 'render-test',
  name: 'Базовая футболка',
  article: 'RND-001',
  category: 'tshirt',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'semi_fitted',
  fabric_kind: 'knit',
  size_range: [42, 44, 46, 48, 50, 52],
  generated_at: AT,
};

const spec = (over: Partial<StyleSpecInput> = {}): StyleSpec =>
  buildStyleSpec({ ...INPUT, ...over }).spec;

const TSHIRT = spec();

const tmpDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'specform-render-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('промпт — проекция спеки', () => {
  it('посадка меняет описание кроя', () => {
    expect(buildRenderPrompt(spec({ fit_intent: 'oversize' }))).not.toBe(
      buildRenderPrompt(spec({ fit_intent: 'fitted' })),
    );
    expect(buildRenderPrompt(spec({ fit_intent: 'oversize' }))).toContain('oversized');
  });

  it('категория меняет предмет съёмки', () => {
    expect(buildRenderPrompt(spec({ category: 'hoodie' }))).toContain('hoodie');
    expect(buildRenderPrompt(TSHIRT)).toContain('t-shirt');
  });

  it('у худи в описании есть капюшон и карман, у футболки — нет', () => {
    const hoodie = buildRenderPrompt(spec({ category: 'hoodie' }));
    expect(hoodie).toContain('hood');
    expect(hoodie).toContain('kangaroo pocket');
    expect(buildRenderPrompt(TSHIRT)).not.toContain('kangaroo');
  });

  it('артикул и название на картинку не влияют и промпт не меняют', () => {
    // Иначе кэш промахивается на каждой смене артикула и мы платим заново
    // за ту же самую вещь.
    expect(buildRenderPrompt(spec({ article: 'OTHER-999', name: 'Другое имя' }))).toBe(
      buildRenderPrompt(TSHIRT),
    );
  });

  it('размерный ряд на вид вещи не влияет', () => {
    expect(buildRenderPrompt(spec({ size_range: [42, 44, 46] }))).toBe(buildRenderPrompt(TSHIRT));
  });

  it('пропорции берутся из табеля мер, а не из представления о категории', () => {
    const long = buildRenderPrompt(spec({ fit_intent: 'oversize' }));
    expect(long).toMatch(/\d+ cm long from the shoulder/);
    expect(long).toMatch(/\d+ cm across the chest/);
  });

  it('запрещает надписи и логотипы — это техническое превью, а не постер', () => {
    expect(buildRenderPrompt(TSHIRT)).toContain('no text, no logos');
  });

  it('человека на картинке нет', () => {
    // Не из этических соображений, а из практических: фигура задаёт свою
    // посадку и перебивает ту, что описана в документе.
    expect(buildRenderPrompt(TSHIRT)).toContain('invisible mannequin');
    expect(buildRenderPrompt(TSHIRT)).toContain('no person');
  });
});

describe('ключ кэша', () => {
  it('одинаковый промпт и модель дают одинаковый ключ', () => {
    const a = renderKey({ prompt: 'x', model: 'm' });
    expect(renderKey({ prompt: 'x', model: 'm' })).toBe(a);
  });

  it('другая модель — другой ключ', () => {
    expect(renderKey({ prompt: 'x', model: 'm1' })).not.toBe(
      renderKey({ prompt: 'x', model: 'm2' }),
    );
  });

  it('другая спека — другой ключ', () => {
    const model = 'gemini-3-pro-image';
    expect(renderKey({ prompt: buildRenderPrompt(TSHIRT), model })).not.toBe(
      renderKey({ prompt: buildRenderPrompt(spec({ fit_intent: 'oversize' })), model }),
    );
  });
});

describe('файловый кэш', () => {
  const value = {
    bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    mediaType: 'image/png',
    model: 'test-model',
  };

  it('записанное читается обратно байт в байт', () => {
    const cache = new FileRenderCache(tempDir());
    cache.set('a'.repeat(64), value);
    const got = cache.get('a'.repeat(64));
    expect(got?.mediaType).toBe('image/png');
    expect(got?.model).toBe('test-model');
    expect([...(got?.bytes ?? [])]).toEqual([...value.bytes]);
  });

  it('незнакомый ключ — промах, а не исключение', () => {
    expect(new FileRenderCache(tempDir()).get('b'.repeat(64))).toBeUndefined();
  });

  it('битый спутник читается как промах', () => {
    const dir = tempDir();
    const cache = new FileRenderCache(dir);
    const key = 'c'.repeat(64);
    cache.set(key, value);
    writeFileSync(join(dir, key.slice(0, 2), `${key}.json`), '{сломано');
    expect(cache.get(key)).toBeUndefined();
  });

  it('байты лежат отдельным файлом, а не base64 внутри JSON', () => {
    const dir = tempDir();
    const key = 'd'.repeat(64);
    new FileRenderCache(dir).set(key, value);
    const files = readdirSync(join(dir, key.slice(0, 2)));
    expect(files).toContain(`${key}.png`);
    expect(files).toContain(`${key}.json`);
  });

  it('временных файлов после записи не остаётся', () => {
    const dir = tempDir();
    const key = 'e'.repeat(64);
    new FileRenderCache(dir).set(key, value);
    expect(readdirSync(join(dir, key.slice(0, 2))).some((f) => f.endsWith('.tmp'))).toBe(false);
  });
});

describe('визуализация не ломает документ', () => {
  it('без ключа сервиса возвращает отказ, а не исключение', async () => {
    vi.stubEnv('COMETAPI_KEY', '');
    const result = await visualize(TSHIRT, { cache: new MemoryRenderCache() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.userMessage).toBeTruthy();
  });

  it('в офлайне в сеть не ходит и честно говорит, что картинки нет', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const result = await visualize(TSHIRT, { cache: new MemoryRenderCache(), offline: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('offline_miss');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('попадание в кэш отдаётся без обращения к сервису', async () => {
    const cache = new MemoryRenderCache();
    const key = renderKey({ prompt: buildRenderPrompt(TSHIRT), model: 'gemini-3-pro-image' });
    cache.set(key, {
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: 'image/png',
      model: 'gemini-3-pro-image',
    });

    const spy = vi.spyOn(globalThis, 'fetch');
    const result = await visualize(TSHIRT, { cache, model: 'gemini-3-pro-image' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.image.cached).toBe(true);
      expect(result.image.dataUri.startsWith('data:image/png;base64,')).toBe(true);
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('ошибка сервиса тоже не бросается наружу', async () => {
    vi.stubEnv('COMETAPI_KEY', 'test-key');
    const spy = vi
      .spyOn(globalThis, 'fetch')
      // Свежий Response на каждый вызов: тело читается один раз, а цепочка
      // моделей делает несколько попыток.
      .mockImplementation(async () => new Response('нет мест', { status: 503 }));

    const result = await visualize(TSHIRT, { cache: new MemoryRenderCache() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('RENDER_FAILED');
    spy.mockRestore();
  });

  it('ответ без картинки — отказ, а не пустой data-URI в документе', async () => {
    vi.stubEnv('COMETAPI_KEY', 'test-key');
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        choices: [{ message: { content: 'Извините, не могу нарисовать это.' } }],
      }),
    );

    const result = await visualize(TSHIRT, { cache: new MemoryRenderCache() });
    expect(result.ok).toBe(false);
    spy.mockRestore();
  });

  it('картинка из ответа кладётся в кэш и второй вызов уже бесплатный', async () => {
    vi.stubEnv('COMETAPI_KEY', 'test-key');
    const png = Buffer.from([137, 80, 78, 71]).toString('base64');
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        choices: [{ message: { content: `Готово!\n\n![image](data:image/png;base64,${png})` } }],
      }),
    );

    const cache = new MemoryRenderCache();
    const first = await visualize(TSHIRT, { cache });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.image.cached).toBe(false);

    const second = await visualize(TSHIRT, { cache });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.image.cached).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('цепочка моделей', () => {
  /**
   * Знание не наше: снято с боевого бэкенда виджета примерки, который ходит
   * в тот же CometAPI. Там генератор РЕГУЛЯРНО блокирует по safety
   * совершенно безобидную розничную одежду, и через OpenAI-совместимый
   * проход это выглядит не как ошибка, а как ответ 200 без картинки.
   */
  const ok = (data: string): Response =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: `![](data:image/png;base64,${data})` } }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  const noImage = (): Response =>
    new Response(JSON.stringify({ choices: [{ message: { content: 'не могу помочь' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('ответ без картинки — не отказ, а повод сменить модель', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(noImage())
      .mockResolvedValueOnce(ok(PNG));

    const image = await generateImage('промпт', {
      apiKey: 'k',
      models: ['первая', 'вторая'],
    });
    expect(image.model).toBe('вторая');
    expect(image.attempt).toBe(1);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('ошибка ключа НЕ повторяется другой моделью', async () => {
    // Смена модели её не исправит, а трижды повторённый безнадёжный вызов
    // втрое удлинит ожидание.
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('нет доступа', { status: 401 }));

    await expect(
      generateImage('промпт', { apiKey: 'k', models: ['первая', 'вторая', 'третья'] }),
    ).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('перегрузка сервиса повторяется', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('too many', { status: 429 }))
      .mockResolvedValueOnce(ok(PNG));

    const image = await generateImage('промпт', { apiKey: 'k', models: ['a', 'b'] });
    expect(image.model).toBe('b');
    spy.mockRestore();
  });

  it('явно названная модель отменяет цепочку', async () => {
    // Просили конкретную — значит хотят именно её, и подмена была бы
    // сюрпризом. Цепочка нужна там, где модель не выбирали.
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(noImage());
    await expect(generateImage('промпт', { apiKey: 'k', model: 'одна' })).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('заданная основная модель встаёт в ГОЛОВУ цепочки, а не отменяет её', () => {
    process.env.SEAMSTERLY_IMAGE_MODEL = 'своя';
    const chain = defaultImageModels();
    delete process.env.SEAMSTERLY_IMAGE_MODEL;
    expect(chain[0]).toBe('своя');
    expect(chain.length).toBeGreaterThan(1);
  });
});
