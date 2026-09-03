import { z } from 'zod';

/**
 * Реестр изделий.
 *
 * Раньше категория жила шестью разными картами в трёх пакетах: метки на трёх
 * языках, грамматический род, английское описание для картинок, описание для
 * эскиза. Добавить вещь значило вспомнить про все шесть — и про седьмую,
 * о которой не вспомнил никто.
 *
 * Теперь одна запись описывает изделие целиком, а карты выводятся из неё.
 * Забыть поле нельзя: тип записи требует все. Добавление вещи — это дописать
 * запись сюда и положить рядом её данные (табель мер, узлы, прибавки).
 *
 * Реестр — TypeScript, а не JSON, СОЗНАТЕЛЬНО: из объекта выводится тип
 * `Category`, и всё, что берёт категорию, продолжает проверяться компилятором.
 * В JSON эта защита исчезла бы, а вместе с ней — гарантия, что у новой вещи
 * есть китайская метка и род для ярлыка.
 */

/**
 * Куда изделие надевается. От этого зависит, что вообще можно померить.
 *
 * У верха есть длина от плеча и ширина груди; у низа — обхват талии, бёдер
 * и шаговый шов; у цельного и то и другое плюс длина юбки. Движок сборки
 * категорий не знает и знать не должен — он знает класс.
 */
export const GarmentClassSchema = z.enum(['top', 'bottom', 'whole', 'outerwear']);
export type GarmentClass = z.infer<typeof GarmentClassSchema>;

export const GARMENT_CLASS_LABEL_RU: Record<GarmentClass, string> = {
  top: 'верх',
  bottom: 'низ',
  whole: 'цельное изделие',
  outerwear: 'верхняя одежда',
};

/** Класс материала верхнего уровня. Определяет допуски, градацию и набор узлов. */
export const FabricKindSchema = z.enum(['knit', 'woven']);
export type FabricKind = z.infer<typeof FabricKindSchema>;

export interface CategoryEntry {
  /** Название на языках документа. */
  ru: string;
  en: string;
  zh: string;
  /**
   * Грамматический род русского названия.
   *
   * Нужен для наименования товара на ярлыке: реквизит по статье 9 ТР ТС 017
   * читает живой человек, а «свитшот женская» — брак печати, а не мелочь.
   */
  gender: 'f' | 'm' | 'n';
  /** Куда надевается. Определяет, какие точки замера вообще применимы. */
  class: GarmentClass;
  /** Полотно по умолчанию. Анкета может переопределить. */
  fabric: FabricKind;
  /**
   * Как назвать изделие модели, которая рисует картинку.
   *
   * Отдельно от `en`: на ярлыке нужно короткое «hoodie», а картинке —
   * описание с узлами, иначе она рисует усреднённую вещь категории.
   */
  visual: string;
}

export const CATEGORY_REGISTRY = {
  tshirt: {
    ru: 'футболка',
    en: 't-shirt',
    zh: 'T恤',
    gender: 'f',
    class: 'top',
    fabric: 'knit',
    visual: 'short-sleeve crew-neck t-shirt',
  },
  longsleeve: {
    ru: 'лонгслив',
    en: 'long sleeve tee',
    zh: '长袖T恤',
    gender: 'm',
    class: 'top',
    fabric: 'knit',
    visual: 'long-sleeve crew-neck knit top',
  },
  sweatshirt: {
    ru: 'свитшот',
    en: 'sweatshirt',
    zh: '卫衣',
    gender: 'm',
    class: 'top',
    fabric: 'knit',
    visual: 'crew-neck sweatshirt',
  },
  hoodie: {
    ru: 'худи',
    en: 'hoodie',
    zh: '连帽卫衣',
    // Худи не склоняется и в отраслевой речи среднего рода: «худи женское».
    gender: 'n',
    class: 'top',
    fabric: 'knit',
    visual: 'pullover hoodie',
  },
  zip_hoodie: {
    ru: 'худи на молнии',
    en: 'zip-through hoodie',
    zh: '拉链连帽卫衣',
    // «Худи на молнии женское» — та же несклоняемая форма, что у худи.
    gender: 'n',
    class: 'top',
    fabric: 'knit',
    visual: 'full-zip hoodie with a two-way front zipper',
  },
  polo: {
    ru: 'поло',
    en: 'polo shirt',
    zh: 'POLO衫',
    // «Поло» тоже не склоняется: на ярлыке «поло женское».
    gender: 'n',
    class: 'top',
    fabric: 'knit',
    visual: 'short-sleeve polo shirt with a ribbed collar and a two-button placket',
  },
  tank_top: {
    ru: 'майка',
    en: 'tank top',
    zh: '背心',
    gender: 'f',
    class: 'top',
    fabric: 'knit',
    visual: 'sleeveless tank top with bound armholes',
  },

  // Первая вещь вне стритвира. Верх у неё конструктивно тот же, что
  // у лонгслива, — та же пройма, тот же втачной рукав, та же обработка
  // горловины; отличие в раскрое, а не в узлах. Поэтому платье честно
  // наследует выверенные отношения, а не заводит выдуманные свои.
  dress: {
    ru: 'платье',
    en: 'dress',
    zh: '连衣裙',
    gender: 'n',
    class: 'whole',
    fabric: 'knit',
    visual: 'knit dress falling below the knee, set-in long sleeves',
  },
} as const satisfies Record<string, CategoryEntry>;

export type Category = keyof typeof CATEGORY_REGISTRY;

export const CATEGORIES = Object.keys(CATEGORY_REGISTRY) as readonly Category[];

export const CategorySchema = z.enum(CATEGORIES as [Category, ...Category[]]);

const field = <K extends keyof CategoryEntry>(key: K): Record<Category, CategoryEntry[K]> =>
  Object.fromEntries(CATEGORIES.map((c) => [c, CATEGORY_REGISTRY[c][key]])) as Record<
    Category,
    CategoryEntry[K]
  >;

export const CATEGORY_LABEL_RU = field('ru');
export const CATEGORY_LABEL_EN = field('en');
export const CATEGORY_LABEL_ZH = field('zh');
export const CATEGORY_GRAMMATICAL_GENDER = field('gender');
export const CATEGORY_CLASS = field('class');
export const CATEGORY_FABRIC = field('fabric');
export const CATEGORY_VISUAL_EN = field('visual');

export const GenderSchema = z.enum(['women', 'men']);
export type Gender = z.infer<typeof GenderSchema>;

const GENDER_FORMS: Record<Gender, Record<'f' | 'm' | 'n', string>> = {
  women: { f: 'женская', m: 'женский', n: 'женское' },
  men: { f: 'мужская', m: 'мужской', n: 'мужское' },
};

/** «Футболка женская», «Свитшот мужской», «Худи женское». */
export function categoryWithGender(category: Category, gender: Gender): string {
  const label = CATEGORY_LABEL_RU[category];
  const form = GENDER_FORMS[gender][CATEGORY_GRAMMATICAL_GENDER[category]];
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} ${form}`;
}
