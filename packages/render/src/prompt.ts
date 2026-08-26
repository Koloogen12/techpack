import { kb as defaultKb, type Category, type KnowledgeBase } from '@specform/kb';
import type { StyleSpec } from '@specform/stylespec';

/**
 * Промпт визуализации изделия.
 *
 * Собирается ИЗ СПЕКИ, а не из входной фотографии. Это принципиально:
 * рендер должен показывать то, что описывает документ, иначе он превращается
 * в копию входа и ничего не проверяет. Поменяли посадку в анкете — картинка
 * обязана поменяться вслед за таблицей, ровно как чертёж.
 *
 * Версия входит в ключ кэша: правка текста ниже меняет ключ и требует
 * пересборки визуализаций.
 */
export const RENDER_PROMPT_VERSION = 'v1';

const FIT_ENGLISH: Record<string, string> = {
  fitted: 'close-fitting, following the body with minimal ease',
  semi_fitted: 'a regular straight fit with a comfortable amount of ease',
  loose: 'a relaxed loose fit with generous ease and soft drape',
  oversize: 'a deliberately oversized fit with dropped shoulders and heavy drape',
};

const FABRIC_ENGLISH: Record<string, string> = {
  single_jersey: 'lightweight single jersey cotton with a smooth face',
  interlock: 'dense interlock cotton with a smooth double-knit face',
  rib_1x1: 'fine 1x1 rib knit with visible vertical ribbing',
  rib_2x2: 'chunky 2x2 rib knit with pronounced vertical ribbing',
  french_terry_2t: 'mid-weight french terry with a smooth face and looped back',
  french_terry_3t: 'heavy brushed-back fleece with a soft dense hand',
  pique: 'cotton pique with a fine honeycomb texture',
};

/** Узлы, которые видно на готовом изделии и которые стоит назвать. */
const NODE_ENGLISH: Record<string, string> = {
  neck_rib_band: 'a narrow ribbed neckband',
  neck_binding: 'a bound neckline edge',
  cuff_rib: 'ribbed cuffs at the sleeve ends',
  waistband_rib: 'a ribbed waistband at the hem',
  hem_coverstitch: 'a plain turned hem with a twin coverstitch line',
  hem_coverstitch_3n: 'a plain turned hem with three parallel stitch lines',
  sleeve_hem_coverstitch: 'coverstitched sleeve hems',
  hood_set_in: 'a lined two-panel hood',
  hood_drawcord_casing: 'a drawcord casing along the hood opening with cord ends hanging',
  hood_eyelets: 'small metal eyelets at the drawcord exits',
  kangaroo_pocket: 'a kangaroo pocket across the lower front with angled hand openings',
};

export interface RenderPromptOptions {
  /** Какой колорвей показать. По умолчанию первый из спецификации. */
  colorwayId?: string;
  /**
   * Сплошной раппорт на изделии. Тайл уходит в модель опорным изображением,
   * а сюда — его физический шаг: без него модель нарисует «какой-нибудь»
   * узор в произвольном масштабе, и превью соврёт ровно в том, ради чего
   * оно делается.
   */
  patternRepeatCm?: number | undefined;
  /**
   * К запросу приложен образец полотна этого колорвея.
   *
   * Меняет формулировку цвета: вместо названия и приблизительного hex модель
   * получает указание брать цвет С КАРТИНКИ. Название цвета русское и для
   * модели значит немного, а hex — это цвет на экране, а не цвет ткани.
   * Образец точнее обоих.
   */
  swatchReference?: boolean | undefined;
}

/**
 * Описание изделия на английском, собранное из полей спеки.
 *
 * Английский здесь не вкус, а требование модели: она заметно точнее следует
 * подробным описаниям на английском, а текст этот пользователю не показывается.
 */
export function buildRenderPrompt(
  spec: StyleSpec,
  options: RenderPromptOptions = {},
  base: KnowledgeBase = defaultKb(),
): string {
  const category = spec.style.category as Category;
  const fit = FIT_ENGLISH[spec.base.fit_intent] ?? 'a regular fit';

  const shell = spec.bom?.lines.find((l) => l.role === 'shell');
  const fabric = shell
    ? `${FABRIC_ENGLISH[shell.material_id] ?? englishName(shell.material_id, base)}${weight(shell.gsm?.value ?? null)}`
    : 'a knitted cotton fabric';

  const colorway =
    spec.bom?.colorways.find((c) => c.id === options.colorwayId) ?? spec.bom?.colorways[0];
  const swatchHex = colorway?.swatch?.hex ?? colorway?.hex_approx;
  const colour =
    colorway && options.swatchReference && swatchHex
      ? `exactly the colour of the attached fabric swatch reference image ` +
        `(approximately ${swatchHex})`
      : colorway
        ? `${colorway.name_ru}${colorway.hex_approx ? ` (approximately ${colorway.hex_approx})` : ''}`
        : 'a neutral mid-tone colour';

  const details = (spec.construction?.nodes ?? [])
    .map((n) => NODE_ENGLISH[n.node_id])
    .filter((x): x is string => Boolean(x));

  // Пропорции берём из табеля мер: рендер обязан следовать за числами,
  // а не за общим представлением о категории.
  const value = (code: string): number | null =>
    spec.measurements.points.find((p) => p.code === code)?.base.value ?? null;
  const length = value('T01');
  const chest = value('T03');
  const proportion =
    length !== null && chest !== null
      ? `The body is about ${Math.round(length)} cm long from the shoulder and about ` +
        `${Math.round(chest)} cm across the chest when laid flat, so it reads as ` +
        `${length / chest > 1.45 ? 'a long, lean shape' : length / chest > 1.25 ? 'a balanced shape' : 'a short, boxy shape'}.`
      : '';

  const garment = ENGLISH_CATEGORY[category] ?? 'knitted top';

  // Масштаб мотива задаётся ОТНОШЕНИЕМ к ширине груди, а не сантиметрами:
  // модель не знает, сколько на её картинке сантиметров, но прекрасно
  // понимает «мотив повторяется примерно трижды по ширине груди».
  const pattern =
    options.patternRepeatCm !== undefined && chest !== null
      ? `The whole garment is cut from fabric printed with the all-over repeating ` +
        `pattern shown in the reference image. Reproduce that pattern's colours, motifs ` +
        `and character exactly — it is a given design, not a starting point. ` +
        `Scale it so the pattern repeats about ` +
        `${Math.max(1, Math.round(chest / options.patternRepeatCm))} times across the width ` +
        `of the chest. The print follows the folds and the drape of the fabric, ` +
        `and continues across every seam without interruption.`
      : '';

  return [
    `A single ${garment} shown on an invisible mannequin — a ghost-mannequin product photograph, front view, with the garment holding its worn shape and no person, head, hands or stand visible.`,
    '',
    `The garment is ${fabric}, coloured ${colour}. The cut is ${fit}.`,
    details.length
      ? `Visible construction: ${details.join(', ')}.`
      : 'Construction is plain, with no visible trims.',
    proportion,
    pattern,
    '',
    'Photographed straight on at eye level against a smooth light warm-grey seamless studio background, soft even diffused lighting from a large scrim, a gentle contact shadow beneath the garment. Shot on an 85mm lens at f/5.6. The fabric surface texture and every seam and stitch line stay legible.',
    // Портретный кадр — не вкус, а вёрстка: страница документа делится
    // на две колонки, и горизонтальная картинка в колонке наполовину
    // состоит из пустого фона. Первый живой прогон вышел именно таким.
    // Запрет на рисунок снимается, когда рисунок и есть предмет съёмки:
    // иначе две строки промпта спорят друг с другом, и модель выбирает
    // ту, что ближе к концу.
    'Vertical portrait format, 4:5 aspect ratio. The garment fills most of the frame with a small even margin on all sides. Commercial apparel product photography, neutral colour balance, no props, no text, no logos, no branding.' +
      (pattern ? '' : ' No pattern or print on the fabric.'),
  ]
    .filter(Boolean)
    .join('\n');
}

/** Незнакомое полотно описываем именем из справочника, а не молчим о нём. */
function englishName(materialId: string, base: KnowledgeBase): string {
  try {
    return `${base.material(materialId).name_en.toLowerCase()} knit fabric`;
  } catch {
    return 'a knitted cotton fabric';
  }
}

/**
 * Плотность полотна — то, что сильнее всего меняет вид готовой вещи.
 * Кулирка 150 г висит тряпкой, футер 320 г держит форму; без этого рендер
 * рисует «просто трикотаж» и одинаково врёт на обоих концах диапазона.
 */
function weight(gsm: number | null): string {
  if (gsm === null) return '';
  if (gsm < 180) return ', light and fluid, falling softly with small close folds';
  if (gsm < 260) return ', mid-weight, holding its shape with a few soft folds';
  return ', heavy and structured, standing away from the body with large soft folds';
}

const ENGLISH_CATEGORY: Record<Category, string> = {
  tshirt: 'short-sleeve crew-neck t-shirt',
  longsleeve: 'long-sleeve crew-neck knit top',
  sweatshirt: 'crew-neck sweatshirt',
  hoodie: 'pullover hoodie',
};
