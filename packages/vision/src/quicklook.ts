import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { CATEGORIES, CATEGORY_LABEL_RU } from '@seamster/kb';
import { SeamsterError } from '@seamster/core';
import { createClient, MEDIA_TYPES, type Photo } from './analyze.js';

/**
 * Быстрый взгляд: что на снимке, за секунды, до анкеты.
 *
 * Полный разбор отвечает на «сколько» и живёт две минуты. Этот — на «что это»
 * и обязан уложиться в время, пока человек ещё держит палец на кнопке
 * загрузки: категория, посадка, трикотаж или ткань, откуда снимок и какие
 * элементы видны. Ответ заполняет анкету, а человек её подтверждает —
 * поэтому здесь допустима быстрая модель, а не самая точная: ошибку
 * исправит подтверждение, задержку — ничто.
 *
 * Сантиметров здесь нет и быть не может; пропорции остаются полному разбору.
 */
export const QUICKLOOK_VERSION = 'q2';

export const QuickLookSchema = z.object({
  category: z.object({
    value: z.enum([...CATEGORIES, 'other'] as unknown as [string, ...string[]]),
    confidence: z.enum(['high', 'medium', 'low']),
    other_description: z.string().describe('Что это, если other; иначе пустая строка'),
  }),
  silhouette: z.object({
    value: z.enum(['fitted', 'semi_fitted', 'loose', 'oversize']),
    confidence: z.enum(['high', 'medium', 'low']),
  }),
  fabric_kind: z.object({
    value: z.enum(['knit', 'woven']).describe('Трикотаж или ткань'),
    confidence: z.enum(['high', 'medium', 'low']),
  }),
  /** Откуда снимок — это определяет, что с него можно взять. */
  source: z.object({
    value: z.enum(['flat_lay', 'on_form', 'runway', 'sketch', 'other']),
    confidence: z.enum(['high', 'medium', 'low']),
    reason: z.string().describe('Одна короткая фраза'),
  }),
  elements: z.object({
    hood: z.boolean(),
    closure: z.enum(['none', 'zip', 'buttons', 'other']),
    pocket: z.enum(['none', 'kangaroo', 'patch', 'side', 'other']),
    sleeve: z.enum(['long', 'short', 'none', 'other']),
    ribbed: z.boolean().describe('Рибана по низу или манжетам'),
  }),
  colors: z.array(z.string()).describe('До трёх цветов по-русски, основной первым'),
  /**
   * Предмет известного размера рядом с изделием.
   *
   * Единственное, что превращает назначенный масштаб в измеренный. Спрашивается
   * здесь, а не только в полном разборе: узнать об этом через шесть секунд и
   * переснять — дёшево, узнать через минуту после готового документа — поздно.
   */
  scale_object: z.object({
    present: z.boolean().describe('Есть ли в кадре лист А4 или банковская карта'),
    kind: z.enum(['a4_sheet', 'bank_card', 'none']),
  }),
  note: z.string().describe('Одна фраза человеку: что видно хорошо, что мешает'),
});
export type QuickLook = z.infer<typeof QuickLookSchema>;

/**
 * Чек-лист к быстрому взгляду: признаки, которые на изображении ОБЯЗАНЫ быть.
 *
 * Нужен сторожу эскиза. Свободное описание рисунка не сверить со спекой
 * словами — «gathered puff sleeve head» и «leg-of-mutton sleeve» одно и то же,
 * а строкой не совпадут. Поэтому взгляд получает список и отвечает по каждому
 * пункту: есть, нет, не разобрать. Сверяет тот же механизм, что смотрит
 * на присланное фото; чек-лист — тот же, что ушёл в задание художнику.
 */
export interface QuickLookChecklistItem {
  id: string;
  /** Формулировка признака по-английски — как в задании художнику. */
  en: string;
}

export const ChecklistAnswerSchema = z.object({
  id: z.string(),
  seen: z
    .enum(['yes', 'no', 'unclear'])
    .describe('yes — признак есть; no — его точно нет, нарисовано иначе; unclear — не разобрать'),
  note: z.string().describe('До шести слов: где на изображении или почему не видно'),
});
export type ChecklistAnswer = z.infer<typeof ChecklistAnswerSchema>;

const QuickLookWithChecklistSchema = QuickLookSchema.extend({
  checklist: z.array(ChecklistAnswerSchema),
});

/** Текст чек-листа для сообщения модели. Экспортирован ради теста. */
export function checklistPrompt(items: readonly QuickLookChecklistItem[]): string {
  return [
    'Отдельно сверь по списку. Перед тобой технический рисунок изделия, и каждый пункт — признак, который художник обязан был нарисовать. По каждому ответь: yes — признак на рисунке есть; no — его точно нет, нарисовано иначе; unclear — по рисунку не понять. Не додумывай: unclear лучше ложного yes и ложного no. Верни ответ по каждому id.',
    ...items.map((it, i) => `${i + 1}. [${it.id}] ${it.en}`),
  ].join('\n');
}

function buildPrompt(): string {
  const categories = CATEGORIES.map((c) => `${c} (${CATEGORY_LABEL_RU[c]})`).join(', ');
  return [
    'Ты — технолог швейного производства. Тебе показывают ОДИН снимок изделия. Ответь коротко: что это.',
    '',
    `Категория — одна из: ${categories}. Если изделие другое — other и назови его.`,
    'Посадка: прилегающая, полуприлегающая, свободная, oversize.',
    'Трикотаж или ткань — по фактуре и тому, как ложится материал.',
    '',
    'Источник снимка:',
    '  flat_lay — вещь разложена на плоскости, снята сверху или фронтально (карточка магазина, стол);',
    '  on_form — надета на человека или манекен, но снимок студийный или каталожный;',
    '  runway — подиум, улица, показ: движение, ракурс, освещение сцены;',
    '  sketch — рисунок, эскиз, иллюстрация, а не фотография;',
    '  other — ничего из перечисленного.',
    '',
    'Элементы: капюшон, застёжка, карман, рукав, рибана — только то, что действительно видно.',
    '',
    'Отдельно: лежит ли рядом с изделием лист А4 или банковская карта. Это предмет известного',
    'размера, по которому измеряется масштаб. Нет — none, и это нормальный ответ.',
    'Цвета — приблизительно, по-русски. Сантиметры не называй никогда.',
    'Одна фраза человеку: что читается хорошо, что мешает (тень, ракурс, складки, обрезанный кадр).',
  ].join('\n');
}

export function quickLookFingerprint(): string {
  return createHash('sha256')
    .update(`${QUICKLOOK_VERSION}\n${buildPrompt()}`)
    .digest('hex')
    .slice(0, 16);
}

export interface QuickLookOptions {
  photo: Photo;
  model?: string;
  client?: Anthropic;
  /** Каталог кэша: тот же снимок второй раз не разбирается. */
  cacheDir?: string;
  /** Признаки, которые на изображении обязаны быть. Ответ приходит в `checklist`. */
  checklist?: readonly QuickLookChecklistItem[];
}

export interface QuickLookResult {
  look: QuickLook;
  /** Ответы по чек-листу — только если он был задан. */
  checklist?: ChecklistAnswer[];
  fromCache: boolean;
  ms: number;
}

export function defaultQuickLookModel(): string {
  return process.env.SEAMSTER_QUICKLOOK_MODEL ?? 'claude-sonnet-5';
}

export async function quickLook(options: QuickLookOptions): Promise<QuickLookResult> {
  const model = options.model ?? defaultQuickLookModel();
  const checklist = options.checklist?.length ? options.checklist : null;
  const schema = checklist ? QuickLookWithChecklistSchema : QuickLookSchema;
  const hash = createHash('sha256').update(options.photo.bytes).digest('hex').slice(0, 32);
  // Чек-лист входит в ключ: тот же лист с другим списком — другой ответ.
  // Без чек-листа ключ прежний, и кэш быстрого взгляда в кабинете жив.
  const key = createHash('sha256')
    .update(
      `${hash}|${quickLookFingerprint()}|${model}` +
        (checklist ? `|${checklistPrompt(checklist)}` : ''),
    )
    .digest('hex')
    .slice(0, 32);
  const cachePath = options.cacheDir
    ? join(options.cacheDir, key.slice(0, 2), `${key}.json`)
    : null;

  if (cachePath && existsSync(cachePath)) {
    try {
      const parsed = schema.parse(JSON.parse(readFileSync(cachePath, 'utf8')));
      return { ...split(parsed), fromCache: true, ms: 0 };
    } catch {
      /* битый файл кэша — разбираем заново */
    }
  }

  const client = options.client ?? createClient();
  const startedAt = performance.now();
  const response = await client.messages.parse({
    model,
    max_tokens: checklist ? 2000 : 1200,
    system: [{ type: 'text', text: buildPrompt(), cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: MEDIA_TYPES[options.photo.format],
              data: Buffer.from(options.photo.bytes).toString('base64'),
            },
          },
          {
            type: 'text',
            text: checklist ? `Что на снимке?\n\n${checklistPrompt(checklist)}` : 'Что на снимке?',
          },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(schema) },
  });
  const ms = Math.round(performance.now() - startedAt);

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new SeamsterError('VISION_SCHEMA_MISMATCH', 'быстрый взгляд не сошёлся со схемой', {
      userMessage: 'Не удалось разобрать снимок.',
      userAction: 'Заполните анкету вручную — это ничего не стоит.',
      details: { model, version: QUICKLOOK_VERSION },
    });
  }
  if (cachePath) {
    mkdirSync(join(options.cacheDir!, key.slice(0, 2)), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(parsed));
  }
  return { ...split(parsed), fromCache: false, ms };
}

/** Ответ модели — на взгляд и на чек-лист; без чек-листа второго нет. */
function split(parsed: QuickLook & { checklist?: ChecklistAnswer[] }): {
  look: QuickLook;
  checklist?: ChecklistAnswer[];
} {
  const { checklist, ...look } = parsed;
  return checklist ? { look, checklist } : { look };
}
