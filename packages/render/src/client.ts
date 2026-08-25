import { SpecFormError, type CostLedger, type Logger, silentLogger } from '@specform/core';

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
}

const DEFAULT_BASE_URL = 'https://api.cometapi.com/v1';
const DEFAULT_MODEL = 'gemini-3-pro-image';
const DEFAULT_TIMEOUT_MS = 180_000;

export function defaultImageModel(): string {
  return process.env.SPECFORM_IMAGE_MODEL ?? DEFAULT_MODEL;
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
    throw new SpecFormError('CONFIG_MISSING', 'COMETAPI_KEY не задан', {
      userMessage: 'Сервис визуализации недоступен.',
      userAction: 'Документ собран без рендера. Это на нашей стороне, лимит не списан.',
    });
  }

  const baseUrl = options.baseUrl ?? process.env.SPECFORM_IMAGE_BASE_URL ?? DEFAULT_BASE_URL;
  const model = options.model ?? defaultImageModel();
  const logger = options.logger ?? silentLogger;
  const startedAt = performance.now();

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
    throw new SpecFormError('RENDER_FAILED', 'сервис визуализации недоступен', {
      userMessage: 'Не удалось построить визуализацию изделия.',
      userAction: 'Документ соберётся без неё. Повторите позже — лимит не списан.',
      cause,
    });
  }

  if (!response.ok) {
    // Тело ответа в сообщение пользователю не отдаём: там бывают внутренние
    // идентификаторы запросов и подробности чужого сервиса.
    const detail = (await response.text()).slice(0, 400);
    logger.warn('render: сервис ответил ошибкой', { status: response.status, model });
    throw new SpecFormError('RENDER_FAILED', `сервис визуализации вернул ${response.status}`, {
      userMessage: 'Не удалось построить визуализацию изделия.',
      userAction: 'Документ соберётся без неё. Повторите позже — лимит не списан.',
      details: { status: response.status, detail },
    });
  }

  const payload: unknown = await response.json();
  const image = extractImage(payload);
  const ms = Math.round(performance.now() - startedAt);

  if (!image) {
    throw new SpecFormError('RENDER_FAILED', 'в ответе сервиса нет изображения', {
      userMessage: 'Визуализация не получилась.',
      userAction: 'Документ соберётся без неё. Повторите бесплатно.',
      details: { model },
    });
  }

  options.ledger?.record({
    stage: 'render',
    // Модель не в нашем прайсе: тариф считает сторонний сервис, и выдавать
    // придуманную цифру за себестоимость нельзя. Пишем время, не деньги.
    inputTokens: 0,
    outputTokens: 0,
    ms,
  });

  logger.info('render: изображение получено', { model, ms, bytes: image.bytes.length });
  return { ...image, model, ms };
}
