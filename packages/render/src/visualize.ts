import { isSpecFormError, type CostLedger, type Logger, silentLogger } from '@specform/core';
import { kb as defaultKb, type KnowledgeBase } from '@specform/kb';
import type { StyleSpec } from '@specform/stylespec';
import { defaultImageModel, generateImage, type ReferenceImage } from './client.js';
import { MemoryRenderCache, renderKey, type RenderCache } from './cache.js';
import { buildRenderPrompt, type RenderPromptOptions } from './prompt.js';

/**
 * Визуализация изделия для техпака.
 *
 * Отвечает на вопрос, которого в документе не было: «что это за вещь и как
 * она будет выглядеть». Чертёж отвечает на «где мерить», таблица — на
 * «сколько сантиметров», а на «похоже ли это на то, что я задумал» до сих пор
 * не отвечало ничто.
 *
 * Три правила, которые тут зашиты намертво:
 *
 * 1. Картинка строится ИЗ СПЕКИ. Не из входного фото — иначе она пересказывает
 *    вход и ничего не проверяет.
 * 2. Картинка НЕ УЧАСТВУЕТ в геометрии. Ни один сантиметр документа из неё
 *    не берётся. Она подписана «не для замеров» и лежит отдельной страницей.
 * 3. Отказ визуализации НЕ ЛОМАЕТ документ. Техпак — производственный
 *    документ; если сторонний сервис лежит, вещь всё равно надо шить.
 *    Поэтому здесь возвращается результат, а не бросается исключение.
 */

export interface VisualizeOptions extends RenderPromptOptions {
  cache?: RenderCache;
  logger?: Logger;
  ledger?: CostLedger;
  apiKey?: string;
  model?: string;
  base?: KnowledgeBase;
  /**
   * Не ходить в сеть: отдать только то, что уже в кэше.
   * Режим голден-прогонов и повторных сборок документа.
   */
  offline?: boolean;
  /**
   * Опорные изображения: тайл раппорта.
   *
   * Единственный случай, когда визуализация строится НЕ только из спеки —
   * и он не нарушает ADR-0005, а следует ему. Рисунок ткани в спеке
   * не описан и описан быть не может: это дизайн-контент. Всё остальное —
   * силуэт, посадка, полотно, узлы — по-прежнему из спеки.
   */
  references?: readonly ReferenceImage[];
}

export interface Visualization {
  /** Готовая к вставке в HTML строка data:image/...;base64,... */
  dataUri: string;
  mediaType: string;
  model: string;
  /** Ключ кэша — попадает в провенанс документа. */
  key: string;
  cached: boolean;
}

export type VisualizeResult =
  { ok: true; image: Visualization } | { ok: false; reason: string; userMessage: string };

const sharedCache = new MemoryRenderCache();

export async function visualize(
  spec: StyleSpec,
  options: VisualizeOptions = {},
): Promise<VisualizeResult> {
  const logger = options.logger ?? silentLogger;
  const cache = options.cache ?? sharedCache;
  const model = options.model ?? defaultImageModel();

  const promptOptions: RenderPromptOptions = {};
  if (options.colorwayId !== undefined) promptOptions.colorwayId = options.colorwayId;

  // Шаг раппорта берётся из самой спеки: он там уже есть, и передавать его
  // отдельно значило бы разрешить превью разойтись с паспортом печати.
  const allover = spec.artwork?.placements.find((a) => a.kind === 'allover');
  if (allover) promptOptions.patternRepeatCm = allover.size_cm.width.value;

  const prompt = buildRenderPrompt(spec, promptOptions, options.base ?? defaultKb());
  const key = renderKey({
    prompt,
    model,
    ...(options.references ? { references: options.references.map((r) => r.bytes) } : {}),
  });

  const hit = cache.get(key);
  if (hit) {
    logger.info('render: попадание в кэш', { key: key.slice(0, 12) });
    return { ok: true, image: toVisualization(hit, key, true) };
  }

  if (options.offline) {
    return {
      ok: false,
      reason: 'offline_miss',
      userMessage: 'Визуализация не строилась: работа без обращения к сервису.',
    };
  }

  try {
    const generateOptions: Parameters<typeof generateImage>[1] = { model, logger };
    if (options.references?.length) generateOptions.references = options.references;
    if (options.apiKey !== undefined) generateOptions.apiKey = options.apiKey;
    if (options.ledger !== undefined) generateOptions.ledger = options.ledger;

    const image = await generateImage(prompt, generateOptions);
    const value = { bytes: image.bytes, mediaType: image.mediaType, model: image.model };
    cache.set(key, value);
    return { ok: true, image: toVisualization(value, key, false) };
  } catch (error) {
    // Сознательно не пробрасываем: документ важнее картинки.
    const userMessage = isSpecFormError(error)
      ? error.userMessage
      : 'Не удалось построить визуализацию изделия.';
    logger.warn('render: визуализация не получилась, документ собирается без неё', {
      key: key.slice(0, 12),
    });
    return {
      ok: false,
      reason: isSpecFormError(error) ? error.code : 'unknown',
      userMessage,
    };
  }
}

function toVisualization(
  value: { bytes: Uint8Array; mediaType: string; model: string },
  key: string,
  cached: boolean,
): Visualization {
  return {
    dataUri: `data:${value.mediaType};base64,${Buffer.from(value.bytes).toString('base64')}`,
    mediaType: value.mediaType,
    model: value.model,
    key,
    cached,
  };
}
