import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { SeamsterError, silentLogger, type CostLedger, type Logger } from '@seamster/core';
import {
  CATEGORY_FABRIC,
  kb as defaultKb,
  type Category,
  type FabricKind,
  type KnowledgeBase,
  type PhotoView,
} from '@seamster/kb';
import { MemoryVisionCache, cacheKey, hashPhoto, type VisionCache } from './cache.js';
import {
  PROMPT_VERSION,
  buildSystemPrompt,
  buildUserPrompt,
  promptFingerprint,
  type ReportPart,
} from './prompt.js';
import {
  ProportionsPartSchema,
  StructurePartSchema,
  VisionModelSchema,
  VisionReportSchema,
  type VisionReport,
} from './report.js';
import { parseLenient } from './lenient.js';

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
  /**
   * Полотно, заявленное в анкете. У тканого изделия свой табель мер, и
   * спрашивать модель надо про его точки: у тканого платья нет бейки
   * горловины, зато есть застёжка. Ответ модели заявление не связывает —
   * она может увидеть ткань там, где указан трикотаж, и скажет об этом.
   */
  fabric?: FabricKind;
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

  // Полотно из анкеты: у тканого изделия свой табель, значит и свой промпт.
  // В ключ кэша оно входит через отпечаток промпта, отдельной строкой не идёт.
  const fabric: FabricKind = options.fabric ?? CATEGORY_FABRIC[category];

  const key = cacheKey({
    photoHashes: photos.map((p) => hashPhoto(p.bytes)),
    views: photos.map((p) => p.view),
    category,
    answersFingerprint,
    promptFingerprint: promptFingerprint(base, category, fabric),
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
    const report = await analyzeViaProxy(client, model, photos, category, fabric, base, logger);
    const proxyMs = Math.round(performance.now() - startedAt);
    cache.set(key, report);
    ledger?.record({ stage: 'vision', model, inputTokens: 0, outputTokens: 0, ms: proxyMs });
    logger.info('vision: разбор завершён (прокси-режим)', { key, model, ms: proxyMs });
    return { report, cacheKey: key, fromCache: false };
  }

  // Два вызова параллельно: структура и видимость — отдельно от пропорций.
  // Ответ модели идёт со скоростью вывода, и при одном вызове человек ждал
  // около двух минут; половины короче вдвое и ждут их одновременно.
  // Системный префикс у обоих один и кэшируется.
  const system = [
    {
      type: 'text' as const,
      text: buildSystemPrompt(base, category, fabric),
      cache_control: { type: 'ephemeral' as const },
    },
  ];
  const images = photos.map((photo) => ({
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: MEDIA_TYPES[photo.format],
      data: Buffer.from(photo.bytes).toString('base64'),
    },
  }));
  const shots = photos.map((p, i) => ({ index: i + 1, view: p.view }));
  // Не `messages.parse`: он бросает исключение на первом же значении вне
  // перечисления, а структурный вывод перечисления не держит (SDK переписывает
  // enum в подсказку). Ответ читается сырым и разбирается терпимо.
  const ask = async <T extends z.ZodType>(part: ReportPart, schema: T) => {
    const format = zodOutputFormat(schema);
    const response = await client.messages.create({
      model,
      max_tokens: 6_000,
      system,
      messages: [
        {
          role: 'user',
          content: [...images, { type: 'text' as const, text: buildUserPrompt(shots, base, part) }],
        },
      ],
      output_config: { format: { type: 'json_schema', schema: format.schema } },
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return { response, text, schema };
  };

  const [structure, proportions] = await Promise.all([
    ask('structure', StructurePartSchema),
    ask('proportions', ProportionsPartSchema),
  ]);
  const ms = Math.round(performance.now() - startedAt);

  for (const { response } of [structure, proportions]) {
    if (response.stop_reason === 'refusal') {
      throw new SeamsterError('VISION_FAILED', 'модель отказалась разбирать снимки', {
        userMessage: 'Не удалось разобрать эти фотографии.',
        userAction: 'Загрузите другие снимки изделия. Попытка бесплатная — лимит не списан.',
        details: { stop_reason: response.stop_reason },
      });
    }
  }
  // Значение вне словаря заменяется на «иное / не видно», разбор идёт
  // дальше; всё остальное обязано сойтись — иначе документ строился бы на
  // мусоре, и это заметили бы только на фабрике.
  const parsed = {
    ...parseLenient(structure.schema, structure.text, logger, 'vision:structure').value,
    ...parseLenient(proportions.schema, proportions.text, logger, 'vision:proportions').value,
  };
  const response = {
    usage: {
      input_tokens: structure.response.usage.input_tokens + proportions.response.usage.input_tokens,
      output_tokens:
        structure.response.usage.output_tokens + proportions.response.usage.output_tokens,
      cache_creation_input_tokens:
        (structure.response.usage.cache_creation_input_tokens ?? 0) +
        (proportions.response.usage.cache_creation_input_tokens ?? 0),
      cache_read_input_tokens:
        (structure.response.usage.cache_read_input_tokens ?? 0) +
        (proportions.response.usage.cache_read_input_tokens ?? 0),
    },
  };

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
  fabric: FabricKind,
  base: KnowledgeBase,
  logger: Logger,
): Promise<VisionReport> {
  const schema = JSON.stringify(z.toJSONSchema(VisionModelSchema));
  const instruction =
    `Ответь ЕДИНСТВЕННЫМ JSON-объектом, строго по этой JSON-схеме, ` +
    `без пояснений до или после и без markdown-ограждений:\n${schema}`;

  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.create({
      model,
      max_tokens: 16_000,
      system: buildSystemPrompt(base, category, fabric),
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
      return parseLenient(VisionModelSchema, text.slice(start, end + 1), logger, 'vision(proxy)')
        .value;
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
