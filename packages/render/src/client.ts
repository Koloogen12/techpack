import { SeamsterError, type CostLedger, type Logger, silentLogger } from '@seamster/core';

/**
 * Клиент генерации изображений через CometAPI.
 *
 * CometAPI отдаёт картинку не через привычный `/images/generations` — тот
 * отвечает «not supported model for image generation» для gemini-семейства, —
 * а через `/chat/completions`: изображение приходит внутри текста ответа
 * markdown-ссылкой с data-URI. Форма проверена на живом вызове, не выведена
 * из документации.
 *
 * ГРАНИЦА, которую нельзя переступать (TECH-REQUIREMENTS-PIPELINE.md §5):
 * генеративные изображения допустимы ТОЛЬКО как превью и маркетинговые
 * рендеры. Техническая геометрия — всегда детерминированный вектор
 * из StyleSpec. Ров продукта в том, что чертёж правится данными; растровая
 * картинка этого не умеет, и именно на ней застрял конкурент.
 */

export interface ReferenceImage {
  bytes: Uint8Array;
  mediaType: string;
}

export interface ImageClientOptions {
  /**
   * Опорные снимки: модель видит их и работает ОТ НИХ, а не с нуля.
   *
   * Нужны там, где важно тождество вещи, а не её описание: второй ракурс
   * того же изделия, примерка на фигуре. Для страницы «Внешний вид» они
   * НЕ используются намеренно — там картинка обязана строиться из спеки,
   * иначе она пересказывает вход и ничего не проверяет (ADR-0005).
   */
  references?: readonly ReferenceImage[];
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /**
   * Цепочка моделей. Первая — основная, остальные подхватывают её отказы.
   *
   * Нужна не ради надёжности вообще, а ради одного конкретного отказа:
   * генератор изображений РЕГУЛЯРНО блокирует по safety совершенно безобидную
   * одежду. Через OpenAI-совместимый проход это выглядит как ответ 200
   * без картинки — не как ошибка. Знание не наше: оно снято с боевого
   * бэкенда виджета примерки, который ходит в тот же CometAPI и потерял
   * на этом отказе достаточно запросов, чтобы выстроить цепочку.
   */
  models?: readonly string[];
  logger?: Logger;
  ledger?: CostLedger;
  /** Таймаут одного вызова, мс. Генерация картинки идёт десятки секунд. */
  timeoutMs?: number;
}

export interface GeneratedImage {
  /** Сырые байты. */
  bytes: Uint8Array;
  /** MIME-тип, как его назвал сервис. */
  mediaType: string;
  model: string;
  ms: number;
  /** Какой по счёту моделью цепочки получено. Ноль — основной. */
  attempt: number;
}

const DEFAULT_BASE_URL = 'https://api.cometapi.com/v1';
const DEFAULT_MODEL = 'gemini-3-pro-image';

/**
 * Цепочка по умолчанию: сначала самая способная модель, дальше — те, что
 * реже блокируют и быстрее прогреваются.
 *
 * Порядок обратный виджету примерки намеренно. Там картинок сотни в день,
 * и стоимость важнее; у нас один рендер на техпак, и важнее качество —
 * промпт длинный и подробный, младшая модель теряет узлы обработки.
 */
const DEFAULT_MODELS = [
  'gemini-3-pro-image',
  'gemini-3.1-flash-image-preview',
  'gemini-2.5-flash-image',
] as const;

const DEFAULT_TIMEOUT_MS = 180_000;

export function defaultImageModel(): string {
  return process.env.SEAMSTER_IMAGE_MODEL ?? DEFAULT_MODEL;
}

export function defaultImageModels(): readonly string[] {
  const configured = process.env.SEAMSTER_IMAGE_MODELS;
  if (configured) {
    const list = configured
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    if (list.length) return list;
  }
  const primary = process.env.SEAMSTER_IMAGE_MODEL;
  // Явно заданная основная модель встаёт в голову цепочки, а не отменяет её:
  // отменять запасные значило бы вернуть тот самый отказ, ради которого
  // цепочка и существует.
  return primary ? [primary, ...DEFAULT_MODELS.filter((m) => m !== primary)] : [...DEFAULT_MODELS];
}

/**
 * Стоит ли пробовать следующую модель.
 *
 * Различие принципиальное. Ошибка ключа, неверный запрос или неизвестная
 * модель от смены модели не исправятся — на них надо падать сразу, иначе
 * мы трижды повторим заведомо безнадёжный вызов и втрое удлиним ожидание.
 * А блокировка по safety, таймаут холодного старта и 5xx — исправятся:
 * другая модель либо разрешит, либо окажется прогретой.
 */
function worthNextModel(status: number | null): boolean {
  if (status === null) return true; // сеть или таймаут
  if (status === 429) return true;
  return status >= 500;
}

/** Достаёт первое изображение из ответа. */
function extractImage(payload: unknown): { bytes: Uint8Array; mediaType: string } | null {
  const content = (payload as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]
    ?.message?.content;
  if (typeof content !== 'string') return null;

  // Сервис возвращает картинку markdown-ссылкой с data-URI внутри текста.
  const match = /data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)/i.exec(content);
  if (!match?.[1] || !match[2]) return null;

  return {
    mediaType: match[1],
    bytes: Buffer.from(match[2].replace(/\s+/g, ''), 'base64'),
  };
}

export async function generateImage(
  prompt: string,
  options: ImageClientOptions = {},
): Promise<GeneratedImage> {
  const apiKey = options.apiKey ?? process.env.COMETAPI_KEY;
  if (!apiKey) {
    throw new SeamsterError('CONFIG_MISSING', 'COMETAPI_KEY не задан', {
      userMessage: 'Визуализация изделия не настроена.',
      userAction: 'Добавьте COMETAPI_KEY в .env — документ соберётся и без неё',
    });
  }

  const baseUrl = options.baseUrl ?? process.env.SEAMSTER_IMAGE_BASE_URL ?? DEFAULT_BASE_URL;
  const logger = options.logger ?? silentLogger;
  const chain = options.models?.length
    ? options.models
    : options.model
      ? [options.model]
      : defaultImageModels();

  const startedAt = performance.now();
  let lastError: SeamsterError | null = null;

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i]!;
    const attempt = await callOnce(prompt, model, { apiKey, baseUrl, options, logger });

    if (attempt.image) {
      const ms = Math.round(performance.now() - startedAt);
      options.ledger?.record({
        stage: 'render',
        // Модель не в нашем прайсе: тариф считает сторонний сервис, и выдавать
        // придуманную цифру за себестоимость нельзя. Пишем время, не деньги.
        inputTokens: 0,
        outputTokens: 0,
        ms,
      });
      if (i > 0) {
        logger.warn('render: сработала запасная модель', {
          primary: chain[0],
          used: model,
          step: i,
        });
      }
      logger.info('render: изображение получено', {
        model,
        ms,
        bytes: attempt.image.bytes.length,
      });
      return { ...attempt.image, model, ms, attempt: i };
    }

    lastError = attempt.error;
    const last = i + 1 >= chain.length;
    if (last || !attempt.retryable) break;

    logger.warn('render: пробуем следующую модель', {
      failed: model,
      next: chain[i + 1],
      reason: attempt.reason,
    });
  }

  throw (
    lastError ??
    new SeamsterError('RENDER_FAILED', 'визуализация не получилась', {
      userMessage: 'Визуализация не получилась.',
      userAction: 'Документ соберётся без неё. Повторите бесплатно.',
    })
  );
}

interface Attempt {
  image: { bytes: Uint8Array; mediaType: string } | null;
  error: SeamsterError | null;
  retryable: boolean;
  reason: string;
}

async function callOnce(
  prompt: string,
  model: string,
  ctx: { apiKey: string; baseUrl: string; options: ImageClientOptions; logger: Logger },
): Promise<Attempt> {
  const { apiKey, baseUrl, options, logger } = ctx;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: options.references?.length
              ? [
                  ...options.references.map((r) => ({
                    type: 'image_url' as const,
                    image_url: {
                      url: `data:${r.mediaType};base64,${Buffer.from(r.bytes).toString('base64')}`,
                    },
                  })),
                  { type: 'text' as const, text: prompt },
                ]
              : prompt,
          },
        ],
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (cause) {
    return {
      image: null,
      retryable: true,
      reason: 'сеть или таймаут',
      error: new SeamsterError('RENDER_FAILED', 'сервис визуализации недоступен', {
        userMessage: 'Не удалось построить визуализацию изделия.',
        userAction: 'Документ соберётся без неё. Повторите позже — лимит не списан.',
        cause,
      }),
    };
  }

  if (!response.ok) {
    // Тело ответа в сообщение пользователю не отдаём: там бывают внутренние
    // идентификаторы запросов и подробности чужого сервиса.
    //
    // Чтение тела обёрнуто намеренно: оно тоже умеет бросать, и брошенная
    // отсюда ошибка вышла бы наружу СЫРОЙ — мимо нашего типа, мимо понятного
    // текста и мимо цепочки моделей. Отказ сервиса не должен превращаться
    // в отказ нашего кода.
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 400);
    } catch {
      detail = '(тело ответа прочитать не удалось)';
    }
    logger.warn('render: сервис ответил ошибкой', { status: response.status, model });
    return {
      image: null,
      retryable: worthNextModel(response.status),
      reason: `ответ ${response.status}`,
      error: new SeamsterError('RENDER_FAILED', `сервис визуализации вернул ${response.status}`, {
        userMessage: 'Не удалось построить визуализацию изделия.',
        userAction: 'Документ соберётся без неё. Повторите позже — лимит не списан.',
        details: { status: response.status, detail },
      }),
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    return {
      image: null,
      retryable: true,
      reason: 'ответ не разобрался',
      error: new SeamsterError('RENDER_FAILED', 'ответ сервиса визуализации не разобран', {
        userMessage: 'Визуализация не получилась.',
        userAction: 'Документ соберётся без неё. Повторите бесплатно.',
        cause,
      }),
    };
  }
  const image = extractImage(payload);
  if (image) return { image, error: null, retryable: false, reason: '' };

  // Ответ 200 БЕЗ картинки — это и есть блокировка по safety, увиденная
  // через OpenAI-совместимый проход: finishReason сюда не доезжает, приходит
  // текстовое объяснение вместо изображения. Именно этот случай лечится
  // сменой модели, и именно его мы раньше считали окончательным отказом.
  return {
    image: null,
    retryable: true,
    reason: 'ответ без изображения (обычно блокировка по safety)',
    error: new SeamsterError('RENDER_FAILED', 'в ответе сервиса нет изображения', {
      userMessage: 'Визуализация не получилась.',
      userAction: 'Документ соберётся без неё. Повторите бесплатно.',
      details: { model },
    }),
  };
}
