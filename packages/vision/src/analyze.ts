import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { SeamsterError, silentLogger, type CostLedger, type Logger } from '@seamster/core';
import { kb as defaultKb, type Category, type KnowledgeBase, type PhotoView } from '@seamster/kb';
import { MemoryVisionCache, cacheKey, hashPhoto, type VisionCache } from './cache.js';
import { PROMPT_VERSION, buildSystemPrompt, buildUserPrompt, promptFingerprint } from './prompt.js';
import { VisionReportSchema, type VisionReport } from './report.js';

/** Форматы, которые принимает Claude API. */
export const MEDIA_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
} as const;

export type PhotoFormat = keyof typeof MEDIA_TYPES;

export interface Photo {
  bytes: Uint8Array;
  format: PhotoFormat;
  /** Имя файла — только для логов и сообщений об ошибках. */
  label?: string;
  /**
   * Что на кадре. Без этого модель читает шесть файлов как шесть равноправных
   * снимков и одинаково добросовестно ищет спинку на кадре переда.
   * Не объявлен — считается видом спереди, и об этом говорится вслух.
   */
  view?: PhotoView;
}

export interface AnalyzeOptions {
  photos: readonly Photo[];
  /**
   * Категория, заявленная пользователем в мастере.
   *
   * Определяет, о каких точках измерения спрашивать модель: у худи есть
   * капюшон и карман, а глубины горловины нет. Категория входит в отпечаток
   * ответов, поэтому её смена меняет и ключ кэша.
   */
  category: Category;
  /** Отпечаток ответов мастера. Входит в ключ кэша. */
  answersFingerprint: string;
  model?: string;
  cache?: VisionCache;
  kb?: KnowledgeBase;
  ledger?: CostLedger;
  logger?: Logger;
  client?: Anthropic;
}

export interface AnalyzeResult {
  report: VisionReport;
  /** Ключ кэша. Уезжает в StyleSpec: по нему воспроизводится генерация. */
  cacheKey: string;
  /** Результат взят из кэша — обращения к API не было, стоимость ноль. */
  fromCache: boolean;
}

/** Максимум фотографий на генерацию. Ограничение мастера (ux/02, Э3 шаг 1). */
export const MAX_PHOTOS = 6;

export function defaultModel(): string {
  return process.env.SEAMSTER_VISION_MODEL ?? 'claude-opus-5';
}

/**
 * Анализ фотографий изделия.
 *
 * Единственная недетерминированная стадия пайплайна. Всё, что дальше —
 * сборка спеки, чертёж, документ — чистые функции над её результатом.
 * Поэтому здесь стоит контент-кэш: он превращает случайность в константу
 * для конкретного входа (ADR-0003).
 */
export async function analyzePhotos(options: AnalyzeOptions): Promise<AnalyzeResult> {
  const {
    photos,
    answersFingerprint,
    model = defaultModel(),
    cache = new MemoryVisionCache(),
    kb: base = defaultKb(),
    category,
    ledger,
    logger = silentLogger,
  } = options;

  if (photos.length === 0) {
    throw new SeamsterError('PHOTO_UNUSABLE', 'вызов анализа без фотографий', {
      userMessage: 'Нужна хотя бы одна фотография изделия.',
      userAction: 'Загрузите фото или скриншот карточки товара',
    });
  }
  if (photos.length > MAX_PHOTOS) {
    throw new SeamsterError(
      'PHOTO_UNUSABLE',
      `фотографий ${photos.length}, максимум ${MAX_PHOTOS}`,
      {
        userMessage: `За один раз мы разбираем не больше ${MAX_PHOTOS} фотографий.`,
        userAction: 'Оставьте самые информативные кадры и удалите остальные',
        details: { count: photos.length, max: MAX_PHOTOS },
      },
    );
  }

  const key = cacheKey({
    photoHashes: photos.map((p) => hashPhoto(p.bytes)),
    views: photos.map((p) => p.view),
    category,
    answersFingerprint,
    promptFingerprint: promptFingerprint(base, category),
    model,
  });

  const cached = cache.get(key);
  if (cached) {
    // Тот же вход уже разбирали. Возвращаем то же самое — в этом весь смысл.
    logger.info('vision: попадание в кэш', { key, model });
    ledger?.record({
      stage: 'vision',
      model,
      inputTokens: 0,
      outputTokens: 0,
      ms: 0,
      cached: true,
    });
    return { report: cached, cacheKey: key, fromCache: true };
  }

  const client = options.client ?? createClient();
  const startedAt = performance.now();

  // Прокси-режим: через CometAPI родной structured output не доезжает —
  // прокси перегоняет запрос в чат-формат, и модель отвечает прозой.
  // Схема уходит в промпт, ответ разбирается и проверяется тем же zod:
  // мусор не пройдёт, он упадёт здесь, а не на фабрике.
  if (process.env.SEAMSTER_VISION_BASE_URL) {
    const report = await analyzeViaProxy(client, model, photos, category, base, logger);
    const proxyMs = Math.round(performance.now() - startedAt);
    cache.set(key, report);
    ledger?.record({ stage: 'vision', model, inputTokens: 0, outputTokens: 0, ms: proxyMs });
    logger.info('vision: разбор завершён (прокси-режим)', { key, model, ms: proxyMs });
    return { report, cacheKey: key, fromCache: false };
  }

  const response = await client.messages.parse({
    model,
    max_tokens: 16_000,
    system: [
      {
        type: 'text',
        text: buildSystemPrompt(base, category),
        // Префикс стабилен между запросами: справочники меняются редко,
        // а фотографии идут после него. Кэшируем целиком.
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: [
          ...photos.map((photo) => ({
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: MEDIA_TYPES[photo.format],
              data: Buffer.from(photo.bytes).toString('base64'),
            },
          })),
          {
            type: 'text' as const,
            text: buildUserPrompt(
              photos.map((p, i) => ({ index: i + 1, view: p.view })),
              base,
            ),
          },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(VisionReportSchema) },
  });

  const ms = Math.round(performance.now() - startedAt);

  if (response.stop_reason === 'refusal') {
    throw new SeamsterError('VISION_FAILED', 'модель отказалась разбирать снимки', {
      userMessage: 'Не удалось разобрать эти фотографии.',
      userAction: 'Загрузите другие снимки изделия. Попытка бесплатная — лимит не списан.',
      details: { stop_reason: response.stop_reason },
    });
  }

  const parsed = response.parsed_output;
  if (!parsed) {
    // Structured output не сошёлся со схемой. Молча продолжать нельзя:
    // документ построится на мусоре, и это заметят только на фабрике.
    throw new SeamsterError('VISION_SCHEMA_MISMATCH', 'ответ модели не сошёлся со схемой отчёта', {
      userMessage: 'Разбор фотографий не завершился корректно.',
      userAction: 'Повторить бесплатно. Если повторяется — напишите нам.',
      details: { model, promptVersion: PROMPT_VERSION },
    });
  }

  const report = VisionReportSchema.parse(parsed);

  ledger?.record({
    stage: 'vision',
    model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    ms,
  });

  logger.info('vision: разбор завершён', {
    key,
    model,
    ms,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    category: report.category.value,
    proportions: report.proportions.length,
    notVisible: report.not_visible.length,
  });

  cache.set(key, report);
  return { report, cacheKey: key, fromCache: false };
}

/**
 * Разбор через прокси без нативного structured output.
 *
 * Два прохода максимум: если первый ответ не сошёлся со схемой, модель
 * получает СВОЮ ошибку валидации и исправляется. Больше двух не делаем:
 * третья попытка статистически не лучше второй, а платит за неё клиент.
 */
async function analyzeViaProxy(
  client: Anthropic,
  model: string,
  photos: readonly Photo[],
  category: Category,
  base: KnowledgeBase,
  logger: Logger,
): Promise<VisionReport> {
  const schema = JSON.stringify(z.toJSONSchema(VisionReportSchema));
  const instruction =
    `Ответь ЕДИНСТВЕННЫМ JSON-объектом, строго по этой JSON-схеме, ` +
    `без пояснений до или после и без markdown-ограждений:\n${schema}`;

  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.create({
      model,
      max_tokens: 16_000,
      system: buildSystemPrompt(base, category),
      messages: [
        {
          role: 'user',
          content: [
            ...photos.map((photo) => ({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: MEDIA_TYPES[photo.format],
                data: Buffer.from(photo.bytes).toString('base64'),
              },
            })),
            {
              type: 'text' as const,
              text:
                buildUserPrompt(
                  photos.map((p, i) => ({ index: i + 1, view: p.view })),
                  base,
                ) +
                `\n\n${instruction}` +
                (lastError
                  ? `\n\nПрошлый ответ не прошёл проверку: ${lastError}. Исправь и ответь только JSON.`
                  : ''),
            },
          ],
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    // Модель через прокси любит обернуть JSON в ограждение или добавить
    // фразу — берём от первой скобки до последней.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) {
      lastError = 'в ответе нет JSON-объекта';
      // Голова ответа — метаданные сбоя, не содержимое клиентских фото:
      // без неё сбой прокси неотличим от сбоя модели.
      logger.warn('vision(proxy): ответ без JSON, повтор', {
        attempt,
        stop: response.stop_reason,
        len: text.length,
        head: text.slice(0, 160),
      });
      continue;
    }
    try {
      return VisionReportSchema.parse(JSON.parse(text.slice(start, end + 1)));
    } catch (cause) {
      lastError = String(cause).slice(0, 400);
      logger.warn('vision(proxy): не сошлось со схемой, повтор', {
        attempt,
        stop: response.stop_reason,
        len: text.length,
        error: lastError.slice(0, 200),
      });
    }
  }

  throw new SeamsterError('VISION_SCHEMA_MISMATCH', 'ответ модели не сошёлся со схемой отчёта', {
    userMessage: 'Разбор фотографий не завершился корректно.',
    userAction: 'Повторить бесплатно. Если повторяется — напишите нам.',
    details: { model, promptVersion: PROMPT_VERSION, proxy: true },
  });
}

export function createClient(): Anthropic {
  // Обход геоблока: Anthropic отвечает 403 с российских адресов, и боевой
  // сервер стоит именно там. CometAPI проксирует /v1/messages в родном
  // формате — модель та же, меняется только адрес и ключ. Проверено живым
  // вызовом, не выведено из документации.
  const baseURL = process.env.SEAMSTER_VISION_BASE_URL;
  const apiKey = baseURL
    ? (process.env.SEAMSTER_VISION_KEY ?? process.env.COMETAPI_KEY)
    : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new SeamsterError('CONFIG_MISSING', 'ключ анализа фотографий не задан', {
      userMessage: 'Сервис анализа фотографий недоступен.',
      userAction: 'Повторить позже. Это на нашей стороне, лимит не списан.',
    });
  }
  return new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
}
