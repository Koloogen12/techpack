import { isSeamsterError, type CostLedger, type Logger, silentLogger } from '@seamster/core';
import { CATEGORY_CLASS, CATEGORY_VISUAL_EN, type Category } from '@seamster/kb';
import type { StyleSpec } from '@seamster/stylespec';
import { generateImage, type ReferenceImage } from './client.js';
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
 * Виды просятся ОДНИМ листом. Порознь модель рисует разные изделия — разной
 * ширины и с разным капюшоном; на одном холсте они выходят комплектом,
 * потому что рисуются вместе. Это проверено на живых прогонах.
 *
 * Видов три: перед, профиль, спинка. Профиль библиотека силуэтов дать не
 * могла — покупных боковых видов нет, и рисовать его построением значило бы
 * показывать выдумку. Здесь он рисуется тем же изделием, что перед и спинка,
 * и отвечает на то, чего не видно ни на одном из них: насколько глубок
 * капюшон, куда уходит боковой шов, как далеко вылетело плечо.
 */
export const SKETCH_PROMPT_VERSION = 'v4';

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

/**
 * Что тот же узел показывает В ПРОФИЛЬ.
 *
 * Отдельная карта, а не фильтр переднего списка: в профиль читается другое.
 * Карман кенгуру виден боковым входом, а не мешком; капюшон — глубиной, а не
 * швом; посадка плеча — вылетом шва за линию проймы. Узлы, которых профиль
 * не показывает вовсе (люверсы, кулиска, петли), сюда просто не попадают —
 * и правильно: боковой вид, дорисовавший лицевую фурнитуру, врёт.
 */
const NODE_SIDE_ENGLISH: Record<string, string> = {
  hood_set_in: 'the depth of the hood standing away from the neck',
  kangaroo_pocket: 'the side opening of the front pocket at the body edge',
  patch_pocket: 'the edge of a patch pocket',
  cuff_rib: 'the ribbed cuff at the wrist',
  waistband_rib: 'the ribbed waistband at the hem',
  neck_rib_band: 'the ribbed neckband',
  hem_coverstitch: 'the turned hem at the bottom edge',
  shoulder_seam_overlock: 'the shoulder seam dropping well past the natural shoulder point',
  sleeve_set_in: 'the armhole seam where the sleeve joins the body',
  side_sleeve_seam: 'one continuous seam running from the underarm down the side of the body',
  zip_full_length: 'the front zipper edge',
};

const FIT_ENGLISH: Record<string, string> = {
  fitted: 'close-fitting',
  semi_fitted: 'regular straight-cut',
  loose: 'relaxed loose-fitting',
  oversize: 'oversized, wide through the body',
};

export interface SketchPromptOptions {
  /**
   * К запросу приложены снимки этой вещи.
   *
   * Тогда промпт требует нарисовать ИМЕННО её, а узлы становятся чек-листом:
   * без снимка модель рисует «худи с такими узлами», и рядом с фотографией
   * рисунок читается как другое изделие (ADR-0010).
   */
  fromPhoto?: boolean;
}

export function buildSketchPrompt(spec: StyleSpec, options: SketchPromptOptions = {}): string {
  const category = spec.style.category as Category;
  const garment = CATEGORY_VISUAL_EN[category] ?? 'knitted top';
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

  // У цельного изделия длина — главный признак, и отношением к груди она
  // не выражается: туника 80 см и платье миди 105 см дают один и тот же
  // бакет «long and lean», а это две разные вещи. Здесь длина меряется
  // ростом, потому что именно так её называет человек: до колена, ниже
  // колена, в пол. У верха отношение к груди работает, и оно не трогается.
  //
  // Границы посчитаны от анатомии, а не на глаз. Плечевая точка стоит на
  // 0.82 роста, колено — на 0.285, щиколотка — на 0.06 (ISO 8559). Значит
  // длина от плеча до колена равна 0.82 − 0.285 = 0.535 роста, до щиколотки
  // 0.76. Отсюда и пороги: они привязаны к телу, а не к красивым числам.
  const height = spec.base.base_height_cm;
  const hem =
    CATEGORY_CLASS[category] === 'whole' && length !== null && height
      ? (() => {
          const r = length / height;
          if (r < 0.44) return 'The hem falls at upper thigh, a tunic length.';
          if (r < 0.5) return 'The hem falls at mid thigh, a short dress.';
          if (r < 0.57) return 'The hem falls at the knee.';
          if (r < 0.7) return 'The hem falls below the knee, a midi length.';
          return 'The hem falls to the ankle, a maxi length.';
        })()
      : '';

  // Бок описывается СВОИМ списком, а не отфильтрованным передним. В профиль
  // читается другое: не «карман кенгуру», а его боковой вход; не капюшон
  // вообще, а его глубина. Фильтрацией переднего списка этого не получить.
  const side = nodes
    .map((n) => NODE_SIDE_ENGLISH[n.node_id])
    .filter((x): x is string => Boolean(x))
    .filter((x, i, all) => all.indexOf(x) === i);

  // От снимка рисуется ЭТА вещь; по описанию — вещь с такими узлами. Первое
  // и есть задача эскиза: расхождение с фотографией человек видит сразу,
  // а расхождение с списком узлов — никогда.
  const identity = options.fromPhoto
    ? [
        'Reference photographs of the actual garment are attached.',
        `Draw a technical flat sketch sheet of EXACTLY this garment, a ${fit} ${garment}: the same silhouette and proportions, the same sleeve construction and shoulder line, the same hood shape and depth, the same pocket shape and placement, the same rib depth at the cuffs and hem, the same drawcord, hardware and stitching as in the photographs.`,
        'Do not restyle it: add nothing the photographs do not show and drop nothing they do.',
        'The sheet shows THREE views of the SAME garment side by side in one row:',
      ]
    : [
        `A technical flat sketch sheet showing THREE views of the SAME ${fit} ${garment}, side by side in one row:`,
      ];

  return [
    ...identity,
    // Колонки одной ширины с чистым просветом — не ради красоты: по просвету
    // лист режется на отдельные виды для обложки и листа на просчёт.
    'front view on the left, side profile view in the middle, back view on the right, each centred in its own equal-width column, with a clear white gutter between the columns and a common baseline.',
    // Лист альбомный и заполнен по высоте: на квадратном листе три вида
    // ложатся узкой полосой посередине, и в каждом виде остаётся по
    // четыреста пикселей — для обложки PDF этого мало.
    'The sheet is landscape, about three times wider than tall, and the three views fill its full height with only a small margin; no empty space above or below the garments.',
    'All three are the same garment at the same scale: identical body length, identical sleeve length, identical rib depth.',
    options.fromPhoto
      ? 'The construction on record is listed below as a checklist; where the photographs disagree with it, follow the photographs.'
      : '',
    'Front and back are laid flat and symmetrical; the side view is a narrow profile silhouette, roughly a third of the width of the front view, showing the garment from the left side with one sleeve hanging along the body.',
    'Pure black line drawing on plain white background, uniform line weight, no shading, no gradients, no fabric texture, no colour, no fill.',
    'Apparel industry CAD flat: closed outline, seam lines solid, topstitching shown as dashed lines.',
    front.length ? `Front shows: ${front.join(', ')}.` : '',
    side.length ? `Side profile shows: ${side.join(', ')}.` : '',
    backOnly.length ? `Back shows: ${backOnly.join(', ')}, and a plain back panel.` : '',
    shape,
    hem,
    'Centred, evenly spaced, no perspective, no mannequin, no person, no shadow, no text, no labels, no logo, no measurements.',
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
  /**
   * Снимки этой вещи — модель рисует ОТ них, а не по описанию (ADR-0010).
   * Входят в ключ кэша: другой снимок при той же спеке — другой рисунок.
   */
  references?: readonly ReferenceImage[];
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
  const references = options.references ?? [];
  const prompt = buildSketchPrompt(spec, { fromPhoto: references.length > 0 });
  const key = renderKey({
    prompt: `${SKETCH_PROMPT_VERSION}|${prompt}`,
    model,
    references: references.map((r) => r.bytes),
  });

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
    if (references.length) generateOptions.references = references;
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

/**
 * Какой длины рукав ОБЯЗАН быть у категории.
 *
 * `null` — категория рукав не задаёт, и придираться не к чему: платье бывает
 * и с длинным рукавом, и с коротким, и без. Отбраковывать по рукаву там, где
 * его выбирает дизайнер, значит выбрасывать верные эскизы.
 *
 * Полная карта, а не Partial: новая вещь в реестре обязана ответить на этот
 * вопрос явно, а не провалиться в молчаливый умолчательный «длинный».
 */
const SLEEVE_BY_CATEGORY: Record<Category, 'long' | 'short' | 'none' | null> = {
  tshirt: 'short',
  polo: 'short',
  tank_top: 'none',
  longsleeve: 'long',
  sweatshirt: 'long',
  hoodie: 'long',
  zip_hoodie: 'long',
  dress: null,
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

  const wantSleeve = SLEEVE_BY_CATEGORY[category];
  // 'other' — не приговор: взгляд так отвечает, когда не уверен, и городить
  // на неуверенности отказ значит терять хорошие эскизы.
  if (
    wantSleeve !== null &&
    seen.elements.sleeve !== 'other' &&
    seen.elements.sleeve !== wantSleeve
  )
    return `на эскизе рукав ${seen.elements.sleeve}, а нужен ${wantSleeve}`;

  return null;
}
