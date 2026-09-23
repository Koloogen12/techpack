/**
 * Закрытые словари наблюдений с фото.
 *
 * Взгляд отвечал свободным текстом («узкая бейка-риб, вырез круглый
 * невысокий»), а сборка ловила его регулярками и промахивалась: «невысокий»
 * содержит «высокий», «без молнии» содержит «молния». Каждая такая ошибка
 * стоила узла в документе (джемпер с диагональной молнией, 23.09.2026).
 *
 * Здесь — перечисления, по которым модель ОБЯЗАНА выбрать одно значение на
 * каждый признак. Узел из реестра выбирается по значению детерминированно,
 * тем же словарём сверяется рисунок. Свободный текст остаётся пояснением к
 * выбору, а не его заменой.
 *
 * Лежат в core, а не во vision: их читают и разбор фото (схема ответа), и
 * сборка спеки (правила), и сторож рисунка — без циклов между пакетами.
 */

export const NECKLINE_KINDS = [
  'crew_rib_band',
  'crew_binding',
  'v_neck',
  'v_notch_zip',
  'scoop',
  'boat',
  'square',
  'mock_neck',
  'turtleneck',
  'polo_collar',
  'shirt_collar',
  'stand_collar',
  'lapel_collar',
  'hood',
  'plain_facing',
  'other',
  'not_visible',
] as const;
export type NecklineKind = (typeof NECKLINE_KINDS)[number];

export const CLOSURE_KINDS = [
  'none',
  'zip_center_full',
  'zip_center_partial',
  'zip_asymmetric',
  'zip_invisible_back',
  'buttons_full',
  'buttons_partial',
  'snaps',
  'hooks',
  'toggles',
  'tie',
  'other',
  'not_visible',
] as const;
export type ClosureKind = (typeof CLOSURE_KINDS)[number];

/** Край рукава, низа и пояса — одним словарём: деталь одна и та же. */
export const EDGE_KINDS = [
  'rib_band',
  'turned_hem',
  'binding',
  'elastic',
  'drawcord',
  'woven_cuff',
  'raw',
  'none',
  'other',
  'not_visible',
] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export const POCKET_KINDS = [
  'none',
  'kangaroo',
  'patch',
  'welt',
  'jetted',
  'in_seam',
  'zip',
  'flap',
  'other',
  'not_visible',
] as const;
export type PocketKind = (typeof POCKET_KINDS)[number];

export const SLEEVE_KINDS = [
  'set_in',
  'raglan',
  'dropped',
  'dolman',
  'kimono',
  'puff',
  'bishop',
  'sleeveless',
  'other',
  'not_visible',
] as const;
export type SleeveKind = (typeof SLEEVE_KINDS)[number];

export const SLEEVE_LENGTHS = [
  'long',
  'three_quarter',
  'elbow',
  'short',
  'cap',
  'none',
  'not_visible',
] as const;
export type SleeveLength = (typeof SLEEVE_LENGTHS)[number];

export const YES_NO = ['yes', 'no', 'not_visible'] as const;
export type YesNo = (typeof YES_NO)[number];

export type ObservationConfidence = 'high' | 'medium' | 'low';

export interface Observed<T extends string> {
  value: T;
  confidence: ObservationConfidence;
}

/** Наблюдения по закрытым словарям — главный ответ разбора фото. */
export interface Observations {
  neckline: Observed<NecklineKind>;
  closure: Observed<ClosureKind>;
  cuff: Observed<EdgeKind>;
  hem: Observed<EdgeKind>;
  pocket: Observed<PocketKind>;
  sleeve: Observed<SleeveKind>;
  sleeve_length: Observed<SleeveLength>;
  hood: Observed<YesNo>;
}

export type ObservationKey = keyof Observations;
export const OBSERVATION_KEYS: readonly ObservationKey[] = [
  'neckline',
  'closure',
  'cuff',
  'hem',
  'pocket',
  'sleeve',
  'sleeve_length',
  'hood',
];

/**
 * Глоссы по-русски: одна строка на значение. Из них собирается раздел промпта
 * и примечания документа — модель и человек читают одни и те же слова.
 */
export const NECKLINE_GLOSS_RU: Record<NecklineKind, string> = {
  crew_rib_band: 'круглый вырез с бейкой-риб кольцом, бейка заметной высоты (2–4 см)',
  crew_binding: 'круглый вырез с узкой окантовкой (около 1 см) или подгибкой, без отдельной бейки',
  v_neck: 'V-образный вырез',
  v_notch_zip: 'уголок или V-вырез, образованный началом молнии; без воротника',
  scoop: 'глубокий округлый вырез',
  boat: 'вырез-лодочка',
  square: 'квадратный вырез',
  mock_neck: 'невысокая стойка-риб (4–7 см), не отворачивается',
  turtleneck: 'высокая стойка-гольф с отворотом',
  polo_collar: 'воротник поло с планкой',
  shirt_collar: 'отложной воротник со стойкой, как у рубашки',
  stand_collar: 'воротник-стойка из основного полотна',
  lapel_collar: 'воротник с лацканами',
  hood: 'капюшон вместо воротника',
  plain_facing: 'чистый край без бейки и окантовки — обтачка изнутри',
  other: 'иное — опиши словами в visible_elements',
  not_visible: 'горловину не видно',
};

export const CLOSURE_GLOSS_RU: Record<ClosureKind, string> = {
  none: 'застёжки нет — вещь надевается через голову',
  zip_center_full: 'молния по центру переда во всю длину, разъёмная',
  zip_center_partial: 'молния по центру переда на часть длины (до груди, анорак)',
  zip_asymmetric: 'молния косая или смещённая: от горловины к боку, по диагонали, вдоль плеча',
  zip_invisible_back: 'потайная молния в шве спинки или в боку — видна только как разрез',
  buttons_full: 'пуговицы по всей длине переда',
  buttons_partial: 'пуговицы на части переда (планка поло, хенли)',
  snaps: 'кнопки',
  hooks: 'крючки',
  toggles: 'пуговицы-тогглы с петлями',
  tie: 'завязки или пояс без застёжки',
  other: 'иное — опиши словами',
  not_visible: 'застёжку не видно',
};

export const EDGE_GLOSS_RU: Record<EdgeKind, string> = {
  rib_band: 'отдельная деталь из рибаны, притачана швом, стягивает край',
  turned_hem: 'край подогнут и подшит, отдельной детали нет (у рубчика — сплошной)',
  binding: 'край окантован узкой бейкой',
  elastic: 'резинка в кулиске или притачная',
  drawcord: 'кулиска со шнуром',
  woven_cuff: 'манжета из основной ткани с застёжкой (рубашечная)',
  raw: 'необработанный край',
  none: 'края как детали нет (без рукава, без пояса)',
  other: 'иное — опиши словами',
  not_visible: 'не видно',
};

export const POCKET_GLOSS_RU: Record<PocketKind, string> = {
  none: 'карманов нет',
  kangaroo: 'карман кенгуру на переде с боковыми входами',
  patch: 'накладной карман',
  welt: 'карман с листочкой',
  jetted: 'прорезной карман в рамку',
  in_seam: 'карман в боковом шве',
  zip: 'карман на молнии',
  flap: 'карман с клапаном',
  other: 'иное — опиши словами',
  not_visible: 'не видно',
};

export const SLEEVE_GLOSS_RU: Record<SleeveKind, string> = {
  set_in: 'втачной рукав с проймой по плечевой точке',
  raglan: 'реглан — шов идёт от горловины к подмышке',
  dropped: 'спущенное плечо — шов проймы заметно ниже плечевой точки',
  dolman: 'цельнокроеный с ластовицей (летучая мышь)',
  kimono: 'цельнокроеный кимоно',
  puff: 'буф — сборка по окату',
  bishop: 'епископ — объём к низу, сборка в манжету',
  sleeveless: 'без рукавов',
  other: 'иное — опиши словами',
  not_visible: 'не видно',
};

export const SLEEVE_LENGTH_GLOSS_RU: Record<SleeveLength, string> = {
  long: 'длинный, до запястья и ниже',
  three_quarter: 'три четверти',
  elbow: 'до локтя',
  short: 'короткий',
  cap: 'крылышко',
  none: 'без рукавов',
  not_visible: 'не видно',
};

export const YES_NO_GLOSS_RU: Record<YesNo, string> = {
  yes: 'есть',
  no: 'нет',
  not_visible: 'не видно',
};

export const OBSERVATION_LABEL_RU: Record<ObservationKey, string> = {
  neckline: 'горловина',
  closure: 'застёжка',
  cuff: 'низ рукава',
  hem: 'низ изделия / пояс',
  pocket: 'карман',
  sleeve: 'рукав',
  sleeve_length: 'длина рукава',
  hood: 'капюшон',
};

/** Словарь по ключу наблюдения — для промпта и проверок. */
export function observationVocabulary(key: ObservationKey): {
  values: readonly string[];
  gloss: Record<string, string>;
} {
  switch (key) {
    case 'neckline':
      return { values: NECKLINE_KINDS, gloss: NECKLINE_GLOSS_RU };
    case 'closure':
      return { values: CLOSURE_KINDS, gloss: CLOSURE_GLOSS_RU };
    case 'cuff':
    case 'hem':
      return { values: EDGE_KINDS, gloss: EDGE_GLOSS_RU };
    case 'pocket':
      return { values: POCKET_KINDS, gloss: POCKET_GLOSS_RU };
    case 'sleeve':
      return { values: SLEEVE_KINDS, gloss: SLEEVE_GLOSS_RU };
    case 'sleeve_length':
      return { values: SLEEVE_LENGTHS, gloss: SLEEVE_LENGTH_GLOSS_RU };
    case 'hood':
      return { values: YES_NO, gloss: YES_NO_GLOSS_RU };
  }
}

/** Человеку: «горловина — уголок, образованный началом молнии». */
export function observationRu(key: ObservationKey, value: string): string {
  const { gloss } = observationVocabulary(key);
  return `${OBSERVATION_LABEL_RU[key]} — ${gloss[value] ?? value}`;
}

/**
 * Глоссы по-английски — терминами швейной индустрии: уходят в задание
 * художнику технического рисунка и в чек-лист сторожа. Те же значения, что
 * по-русски, потому что словарь один.
 */
export const NECKLINE_GLOSS_EN: Record<NecklineKind, string> = {
  crew_rib_band: 'crew neckline with a visible ribbed neckband 2–4 cm deep',
  crew_binding: 'crew neckline finished with a narrow 1 cm binding, no separate neckband',
  v_neck: 'V-neckline',
  v_notch_zip: 'collarless V-notch neckline formed by the start of the zipper, no neckband',
  scoop: 'deep scoop neckline',
  boat: 'boat neckline',
  square: 'square neckline',
  mock_neck: 'low standing mock neck 4–7 cm tall, not folded',
  turtleneck: 'tall folded turtleneck',
  polo_collar: 'polo collar with a buttoned placket',
  shirt_collar: 'shirt collar on a stand',
  stand_collar: 'stand collar in the self fabric',
  lapel_collar: 'notched lapel collar',
  hood: 'hood in place of a collar',
  plain_facing: 'clean neckline edge with an inside facing, no band or binding',
  other: 'neckline as described',
  not_visible: 'neckline not visible',
};

export const CLOSURE_GLOSS_EN: Record<ClosureKind, string> = {
  none: 'no closure, pullover',
  zip_center_full: 'full-length centre-front separating zipper',
  zip_center_partial: 'partial centre-front zipper',
  zip_asymmetric:
    'asymmetric off-centre zipper running diagonally from the neckline towards the side seam',
  zip_invisible_back: 'invisible zipper in the back or side seam',
  buttons_full: 'button-through front',
  buttons_partial: 'partial button placket',
  snaps: 'snap buttons',
  hooks: 'hook closure',
  toggles: 'toggle closure with loops',
  tie: 'tie or belt closure',
  other: 'closure as described',
  not_visible: 'closure not visible',
};

export const EDGE_GLOSS_EN: Record<EdgeKind, string> = {
  rib_band: 'a separate ribbed band attached with a seam',
  turned_hem: 'a plain turned hem with no separate band',
  binding: 'a narrow bound edge',
  elastic: 'elasticated edge',
  drawcord: 'drawcord casing',
  woven_cuff: 'a buttoned shirt cuff in the self fabric',
  raw: 'raw unfinished edge',
  none: 'no edge detail',
  other: 'edge as described',
  not_visible: 'edge not visible',
};

export const POCKET_GLOSS_EN: Record<PocketKind, string> = {
  none: 'no pockets',
  kangaroo: 'a kangaroo pocket on the lower front with angled hand openings',
  patch: 'patch pockets',
  welt: 'welt pockets',
  jetted: 'jetted pockets',
  in_seam: 'in-seam side pockets',
  zip: 'zipped pockets',
  flap: 'flap pockets',
  other: 'pockets as described',
  not_visible: 'pockets not visible',
};

export const SLEEVE_GLOSS_EN: Record<SleeveKind, string> = {
  set_in: 'set-in sleeves with the armhole seam at the shoulder point',
  raglan: 'raglan sleeves with the seam running from the neckline to the underarm',
  dropped: 'dropped shoulders with the armhole seam well below the shoulder point',
  dolman: 'dolman sleeves cut in one with the body',
  kimono: 'kimono sleeves cut in one with the body',
  puff: 'puff sleeves gathered at the sleeve head',
  bishop: 'bishop sleeves gathered into the cuff',
  sleeveless: 'sleeveless',
  other: 'sleeves as described',
  not_visible: 'sleeves not visible',
};

export const SLEEVE_LENGTH_GLOSS_EN: Record<SleeveLength, string> = {
  long: 'long sleeves to the wrist',
  three_quarter: 'three-quarter sleeves',
  elbow: 'elbow-length sleeves',
  short: 'short sleeves',
  cap: 'cap sleeves',
  none: 'no sleeves',
  not_visible: 'sleeve length not visible',
};

export const YES_NO_GLOSS_EN: Record<YesNo, string> = {
  yes: 'present',
  no: 'absent',
  not_visible: 'not visible',
};

export const OBSERVATION_LABEL_EN: Record<ObservationKey, string> = {
  neckline: 'neckline',
  closure: 'closure',
  cuff: 'sleeve ends',
  hem: 'hem',
  pocket: 'pockets',
  sleeve: 'sleeves',
  sleeve_length: 'sleeve length',
  hood: 'hood',
};

export function observationGlossEn(key: ObservationKey, value: string): string {
  const gloss: Record<string, string> = (
    {
      neckline: NECKLINE_GLOSS_EN,
      closure: CLOSURE_GLOSS_EN,
      cuff: EDGE_GLOSS_EN,
      hem: EDGE_GLOSS_EN,
      pocket: POCKET_GLOSS_EN,
      sleeve: SLEEVE_GLOSS_EN,
      sleeve_length: SLEEVE_LENGTH_GLOSS_EN,
      hood: YES_NO_GLOSS_EN,
    } as Record<ObservationKey, Record<string, string>>
  )[key];
  return gloss[value] ?? value;
}

/** Художнику: «neckline: collarless V-notch neckline formed by the start of the zipper». */
export function observationEn(key: ObservationKey, value: string): string {
  return `${OBSERVATION_LABEL_EN[key]}: ${observationGlossEn(key, value)}`;
}
