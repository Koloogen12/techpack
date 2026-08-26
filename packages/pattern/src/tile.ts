import { createHash } from 'node:crypto';
import { isSeamsterlyError, type Logger, silentLogger } from '@seamsterly/core';
import {
  FileRenderCache,
  MemoryRenderCache,
  defaultImageModel,
  generateImage,
  type RenderCache,
  type ReferenceImage,
} from '@seamsterly/render';
import type { Browser } from 'playwright';
import { buildTilePrompt, TILE_PROMPT_VERSION, type TilePromptOptions } from './prompt.js';
import { checkSeam, type SeamReport } from './seam.js';
import { mirrorTile } from './mirror.js';

/**
 * Генерация бесшовного раппорта из референсов пользователя.
 *
 * Здесь генеративная картинка законна и не спорит с ADR-0005: раппорт — это
 * ДИЗАЙН-КОНТЕНТ, а не техническая геометрия. Рисунок ткани и должен быть
 * нарисован; сантиметры по-прежнему берутся из StyleSpec, и ни один размер
 * из тайла не выводится.
 *
 * Что делает этот модуль такого, чего не делает «сделай мне паттерн»:
 *
 * 1. Бесшовность ПРОВЕРЯЕТСЯ пикселями, а не обещается. Несостыковка вылезет
 *    на полотне полосой во всю длину, и увидят её на приёмке партии.
 * 2. Результат кэшируется по отпечатку входа. Тот же бриф и те же референсы
 *    дают тот же тайл — иначе воспроизвести заказ повторно нельзя.
 * 3. Тайл — не конечный продукт. Он получает физический шаг в сантиметрах
 *    и паспорт печати; без них это картинка, а не производственный файл.
 */

export interface TileInput extends TilePromptOptions {
  /** Референсы пользователя: фото узоров, эскизы, отдельные мотивы. */
  references: readonly ReferenceImage[];
}

export interface Tile {
  dataUri: string;
  bytes: Uint8Array;
  mediaType: string;
  /** Размер тайла в пикселях. От него считается разрешение на шаг раппорта. */
  pixels: { width: number; height: number };
  seam: SeamReport;
  /**
   * Тайл собран зеркальной укладкой, потому что модель не дала бесшовный.
   * Рисунок при этом приобрёл симметрию, а физический шаг удвоился —
   * и то и другое обязано дойти до пользователя, а не остаться внутри.
   */
  mirrored: boolean;
  /** Ключ кэша: попадает в документ как отпечаток происхождения. */
  key: string;
  cached: boolean;
  model: string;
}

export type TileResult =
  { ok: true; tile: Tile } | { ok: false; reason: string; userMessage: string };

export interface TileOptions {
  cache?: RenderCache;
  browser?: Browser;
  logger?: Logger;
  apiKey?: string;
  model?: string;
  /** Не ходить в сеть: отдать только то, что уже сгенерировано. */
  offline?: boolean;
  /**
   * Сколько раз пересоздать тайл, если стык виден.
   *
   * Модель теряет бесшовность первой, и одна повторная попытка вытягивает
   * заметную долю случаев. Больше двух не пробуем: это платные вызовы,
   * а зеркальная укладка решает тот же вопрос арифметикой и бесплатно.
   */
  attempts?: number;
  /**
   * Разрешить зеркальную укладку, если модель не дала бесшовный тайл.
   *
   * По умолчанию разрешена: бесшовность важнее сохранения исходной раскладки,
   * а альтернатива — отдать заведомо бракованный файл. Но выключить можно:
   * зеркальный раппорт меняет рисунок, и бывают дизайны, которым это
   * противопоказано.
   */
  allowMirror?: boolean;
}

const DEFAULT_ATTEMPTS = 2;

/**
 * Ключ кэша.
 *
 * Считается от того, что влияет на картинку: содержимое референсов, бриф,
 * плотность, палитра, версия промпта и модель. Номер попытки входит тоже —
 * иначе вторая попытка вернула бы из кэша тот же непригодный тайл, который
 * мы только что забраковали.
 */
export function tileKey(input: TileInput, model: string, attempt: number): string {
  const parts = [
    ...input.references.map((r) => createHash('sha256').update(r.bytes).digest('hex')).sort(),
    input.brief,
    input.density ?? 'balanced',
    String(input.colors ?? '-'),
    TILE_PROMPT_VERSION,
    model,
    String(attempt),
  ];
  return createHash('sha256').update(parts.join(' ')).digest('hex');
}

export function fileTileCache(dir = '.cache/tiles'): RenderCache {
  return new FileRenderCache(dir);
}

const sharedCache = new MemoryRenderCache();

export async function generateTile(
  input: TileInput,
  options: TileOptions = {},
): Promise<TileResult> {
  if (input.references.length === 0) {
    return {
      ok: false,
      reason: 'no_references',
      userMessage:
        'Нужен хотя бы один референс: мы раскладываем ваши мотивы в раппорт, ' +
        'а не придумываем рисунок за вас.',
    };
  }

  const logger = options.logger ?? silentLogger;
  const cache = options.cache ?? sharedCache;
  const model = options.model ?? defaultImageModel();
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const prompt = buildTilePrompt(input);

  let last: Tile | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const key = tileKey(input, model, attempt);
    const hit = cache.get(key);

    let bytes: Uint8Array;
    let mediaType: string;
    let cached = false;

    if (hit) {
      bytes = hit.bytes;
      mediaType = hit.mediaType;
      cached = true;
    } else if (options.offline) {
      // В офлайне доходим до первой недостающей попытки и останавливаемся:
      // отдать тайл, который в прошлый раз забраковали, было бы хуже отказа.
      break;
    } else {
      try {
        const image = await generateImage(prompt, {
          references: input.references,
          model,
          logger,
          ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
        });
        bytes = image.bytes;
        mediaType = image.mediaType;
        cache.set(key, { bytes, mediaType, model });
      } catch (error) {
        return {
          ok: false,
          reason: isSeamsterlyError(error) ? error.code : 'unknown',
          userMessage: isSeamsterlyError(error)
            ? error.userMessage
            : 'Не удалось построить раппорт.',
        };
      }
    }

    const dataUri = `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`;
    const seam = await checkSeam(dataUri, options.browser);
    const tile: Tile = {
      dataUri,
      bytes,
      mediaType,
      pixels: { width: seam.width, height: seam.height },
      seam,
      key,
      cached,
      model,
      mirrored: false,
    };

    logger.info('pattern: тайл получен', {
      attempt,
      seam: seam.worst,
      seamless: seam.seamless,
      cached,
    });

    if (seam.seamless) return { ok: true, tile };
    // Оставляем лучший из непригодных: из него собирается зеркальная укладка.
    if (!last || seam.worst < last.seam.worst) last = tile;
  }

  if (last) {
    if (options.allowMirror === false) return { ok: true, tile: last };

    // Зеркальная укладка бесшовна ПОСТРОЕНИЕМ, но проверяем всё равно:
    // утверждение «здесь шва быть не может» стоит ровно столько же,
    // сколько утверждение модели о бесшовности, пока его не измерили.
    const mirrored = await mirrorTile(last.dataUri, options.browser);
    const seam = await checkSeam(mirrored.dataUri, options.browser);
    logger.info('pattern: собрана зеркальная укладка', { seam: seam.worst });

    return {
      ok: true,
      tile: {
        ...last,
        dataUri: mirrored.dataUri,
        bytes: mirrored.bytes,
        mediaType: mirrored.mediaType,
        pixels: { width: seam.width, height: seam.height },
        seam,
        mirrored: true,
      },
    };
  }

  return {
    ok: false,
    reason: 'offline_miss',
    userMessage: 'Раппорт не строился: работа без обращения к сервису.',
  };
}
