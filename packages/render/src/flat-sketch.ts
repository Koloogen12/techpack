import { isSeamsterError, type CostLedger, type Logger, silentLogger } from '@seamster/core';
import type { Category } from '@seamster/kb';
import type { StyleSpec } from '@seamster/stylespec';
import { generateImage } from './client.js';
import { MemoryRenderCache, renderKey, type RenderCache } from './cache.js';

/**
 * Промпт технического эскиза.
 *
 * Эскиз рисуется ПО УЗЛАМ этого изделия, а не по категории вообще: капюшон с
 * центральным швом, кулиска с люверсами, карман кенгуру — всё это стоит в
 * конструкции, и эскиз обязан показывать именно её. Библиотечный силуэт
 * такого не умеет: он подобран по признакам из каталога и рисует похожую
 * вещь, а не эту.
 *
 * Перед и спинка просятся ОДНИМ листом. Порознь модель рисует два разных
 * изделия — разной ширины и с разным капюшоном; на одном холсте они выходят
 * парой, потому что рисуются вместе. Это проверено на живых прогонах.
 */
export const SKETCH_PROMPT_VERSION = 'v1';

/** Что модель должна нарисовать, если узел есть в конструкции. */
const NODE_ENGLISH: Record<string, string> = {
  hood_set_in: 'a hood set into the neckline',
  hood_center_seam: 'the hood built from two panels with a visible centre seam',
  hood_drawcord_casing: 'a drawcord casing along the hood opening with the cord ends hanging',
  hood_eyelets: 'two small metal eyelets where the drawcord exits',
  kangaroo_pocket: 'a kangaroo pocket across the lower front with angled hand openings',
  patch_pocket: 'patch pockets stitched onto the front',
  cuff_rib: 'ribbed cuffs drawn with fine vertical lines',
  waistband_rib: 'a ribbed waistband drawn with fine vertical lines',
  neck_rib_band: 'a narrow ribbed neckband',
  neck_binding: 'a bound neckline edge',
  hem_coverstitch: 'a plain turned hem with a twin stitch line',
  sleeve_hem_coverstitch: 'coverstitched sleeve hems',
  zip_full_length: 'a full-length front zipper with a visible zipper tape and pull',
  placket_buttonholes: 'a buttoned front placket',
  polo_collar: 'a ribbed polo collar',
  shoulder_seam_overlock: 'dropped shoulder seams',
  sleeve_set_in: 'set-in sleeves hanging straight down along the body',
};

const CATEGORY_ENGLISH: Record<Category, string> = {
  tshirt: 'short-sleeve crew-neck t-shirt',
  longsleeve: 'long-sleeve crew-neck knit top',
  sweatshirt: 'crew-neck sweatshirt',
  hoodie: 'pullover hoodie',
  zip_hoodie: 'full-zip hoodie',
  polo: 'short-sleeve polo shirt',
  tank_top: 'sleeveless tank top',
};

const FIT_ENGLISH: Record<string, string> = {
  fitted: 'close-fitting',
  semi_fitted: 'regular straight-cut',
  loose: 'relaxed loose-fitting',
  oversize: 'oversized, wide through the body',
};

export function buildSketchPrompt(spec: StyleSpec): string {
  const category = spec.style.category as Category;
  const garment = CATEGORY_ENGLISH[category] ?? 'knitted top';
  const fit = FIT_ENGLISH[spec.base.fit_intent] ?? 'regular';

  const nodes = spec.construction?.nodes ?? [];
  const front = nodes
    .map((n) => NODE_ENGLISH[n.node_id])
    .filter((x): x is string => Boolean(x))
    .filter((x, i, all) => all.indexOf(x) === i);

  // Спинка описывается через отрицание того, чего на ней нет: без этого
  // модель рисует карман и на спинке.
  const backOnly = front.filter((x) => !/pocket|zipper|placket|drawcord|eyelet/.test(x));

  // Пропорция берётся из табеля: она — единственное число, которое эскиз
  // обязан уважать. Абсолютных сантиметров модели не даём, ими она всё
  // равно не распорядится.
  const value = (code: string): number | null =>
    spec.measurements.points.find((p) => p.code === code)?.base.value ?? null;
  const length = value('T01');
  const chest = value('T03');
  const shape =
    length !== null && chest !== null
      ? length / chest > 1.35
        ? 'The body reads long and lean.'
        : length / chest > 1.15
          ? 'The body reads balanced in length.'
          : 'The body reads short and boxy.'
      : '';

  return [
    `A technical flat sketch sheet showing TWO views of the SAME ${fit} ${garment}, side by side:`,
    'front view on the left, back view on the right, both laid flat, identical proportions, identical width and length, same scale.',
    'Pure black line drawing on plain white background, uniform line weight, no shading, no gradients, no fabric texture, no colour, no fill.',
    'Apparel industry CAD flat: closed outline, seam lines solid, topstitching shown as dashed lines.',
    front.length ? `Front shows: ${front.join(', ')}.` : '',
    backOnly.length ? `Back shows: ${backOnly.join(', ')}, and a plain back panel.` : '',
    shape,
    'Perfectly symmetrical, centred, no perspective, no mannequin, no person, no shadow, no text, no labels, no logo, no measurements.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Отпечаток: правка промпта или узлов меняет ключ, и эскиз пересобирается. */
export function sketchFingerprint(spec: StyleSpec): string {
  return `${SKETCH_PROMPT_VERSION}|${buildSketchPrompt(spec)}`;
}

// --------------------------------------------------------------- генерация

export interface SketchOptions {
  cache?: RenderCache;
  logger?: Logger;
  ledger?: CostLedger;
  apiKey?: string;
  model?: string;
  /** Работа без обращения к сервису: эскиз берётся только из кэша. */
  offline?: boolean;
}

export type SketchResult =
  | { ok: true; bytes: Uint8Array; mediaType: string; model: string; cached: boolean }
  | { ok: false; reason: string; userMessage: string };

const sketchCache = new MemoryRenderCache();

/**
 * Технический эскиз изделия: перед и спинка одним листом.
 *
 * Отказ НЕ ломает документ. Чертёж — не единственный источник формы: рядом
 * остаётся библиотечный силуэт, и лист собирается на нём. Поэтому здесь
 * возвращается результат, а не бросается исключение.
 */
export async function flatSketch(
  spec: StyleSpec,
  options: SketchOptions = {},
): Promise<SketchResult> {
  const logger = options.logger ?? silentLogger;
  const cache = options.cache ?? sketchCache;
  // Эскиз рисуется линиями, и эта модель держит линию ровнее прочих.
  // Цепочка запасных здесь не нужна: без эскиза документ живёт.
  const model = options.model ?? process.env.SEAMSTER_SKETCH_MODEL ?? 'gemini-3-pro-image';
  const prompt = buildSketchPrompt(spec);
  const key = renderKey({ prompt: `${SKETCH_PROMPT_VERSION}|${prompt}`, model });

  const hit = cache.get(key);
  if (hit) {
    logger.info('эскиз: попадание в кэш', { key: key.slice(0, 12) });
    return { ok: true, bytes: hit.bytes, mediaType: hit.mediaType, model: hit.model, cached: true };
  }
  if (options.offline) {
    return {
      ok: false,
      reason: 'offline_miss',
      userMessage: 'Эскиз не строился: работа без обращения к сервису.',
    };
  }

  try {
    const generateOptions: Parameters<typeof generateImage>[1] = { models: [model], logger };
    if (options.apiKey !== undefined) generateOptions.apiKey = options.apiKey;
    if (options.ledger !== undefined) generateOptions.ledger = options.ledger;
    const image = await generateImage(prompt, generateOptions);
    cache.set(key, { bytes: image.bytes, mediaType: image.mediaType, model: image.model });
    return {
      ok: true,
      bytes: image.bytes,
      mediaType: image.mediaType,
      model: image.model,
      cached: false,
    };
  } catch (error) {
    logger.warn('эскиз: не получился, лист чертежа собирается на библиотечном силуэте', {
      key: key.slice(0, 12),
    });
    return {
      ok: false,
      reason: isSeamsterError(error) ? error.code : 'unknown',
      userMessage: isSeamsterError(error)
        ? error.userMessage
        : 'Не удалось построить технический эскиз.',
    };
  }
}

/**
 * Имя файла эскиза по типу картинки.
 *
 * Расширение обязано совпадать с содержимым: модель отдаёт JPEG, и файл
 * с именем sketch.png ломает всё, что доверяет расширению, — первым
 * сломался сторож, отправивший JPEG под видом PNG.
 */
export function sketchFileName(mediaType: string): string {
  return mediaType === 'image/png' ? 'sketch.png' : 'sketch.jpg';
}

// ------------------------------------------------------------------ сторож

/**
 * Что увидел на эскизе независимый взгляд.
 *
 * Форма описана здесь структурно, а не типом зрения: иначе рисование
 * зависело бы от разбора, а разбор от рисования. Полю нужен ровно этот
 * набор — категория и крупные элементы, по которым вещь опознают глазами.
 */
export interface SketchSeen {
  category: string;
  elements: {
    hood: boolean;
    closure: 'none' | 'zip' | 'buttons' | 'other';
    pocket: 'none' | 'kangaroo' | 'patch' | 'side' | 'other';
    sleeve: 'long' | 'short' | 'none' | 'other';
  };
}

/** Какой длины рукав обязан быть у категории. Прочие — длинный. */
const SLEEVE_BY_CATEGORY: Partial<Record<Category, 'long' | 'short' | 'none'>> = {
  tshirt: 'short',
  polo: 'short',
  tank_top: 'none',
};

/**
 * Расхождение эскиза со спецификацией — причина словами или null.
 *
 * Нужен потому, что эскиз рисует модель, а не построение: на входе худи,
 * на выходе может выйти свитер с молнией. Проверка сравнивает не рисунок
 * с рисунком, а НЕЗАВИСИМЫЙ ВЗГЛЯД на готовый эскиз со спекой — тем же
 * механизмом, которым разбирается присланное фото.
 *
 * Придирок здесь нет намеренно. Ловятся только те расхождения, из-за
 * которых фабрика сошьёт другую вещь: не та категория, есть/нет капюшона,
 * есть/нет застёжки, есть/нет кармана, длина рукава. Подтип кармана
 * (кенгуру или накладной) взгляд путает, и отбраковывать по нему значило бы
 * выбрасывать верные эскизы.
 */
export function sketchMismatch(spec: StyleSpec, seen: SketchSeen): string | null {
  const category = spec.style.category as Category;
  if (seen.category !== category) return `на эскизе ${seen.category}, а в спецификации ${category}`;

  const nodes = new Set((spec.construction?.nodes ?? []).map((n) => n.node_id));
  const has = (...ids: string[]): boolean => ids.some((id) => nodes.has(id));

  const wantHood = has('hood_set_in', 'hood_center_seam', 'hood_drawcord_casing');
  if (wantHood !== seen.elements.hood)
    return wantHood ? 'на эскизе нет капюшона' : 'на эскизе лишний капюшон';

  const wantZip = has('zip_full_length');
  const seenZip = seen.elements.closure === 'zip';
  if (wantZip !== seenZip) return wantZip ? 'на эскизе нет молнии' : 'на эскизе лишняя застёжка';

  const wantPocket = has('kangaroo_pocket', 'patch_pocket');
  const seenPocket = seen.elements.pocket !== 'none';
  if (wantPocket !== seenPocket)
    return wantPocket ? 'на эскизе нет кармана' : 'на эскизе лишний карман';

  const wantSleeve = SLEEVE_BY_CATEGORY[category] ?? 'long';
  // 'other' — не приговор: взгляд так отвечает, когда не уверен, и городить
  // на неуверенности отказ значит терять хорошие эскизы.
  if (seen.elements.sleeve !== 'other' && seen.elements.sleeve !== wantSleeve)
    return `на эскизе рукав ${seen.elements.sleeve}, а нужен ${wantSleeve}`;

  return null;
}
