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
export const FABRIC_KINDS = FabricKindSchema.options;

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
  /**
   * То же для изделия из ткани, если оно у категории бывает.
   *
   * Нужно там, где полотно меняет саму вещь, а не только её ощупь: платье
   * из ткани сидит по фигуре на вытачках и застёгивается на молнию, и
   * назвать его модели «knit dress» значит получить рисунок трикотажного
   * платья при тканой спецификации.
   */
  visual_woven?: string;
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

  // Трикотажный верх из вязаного полотна. От свитшота отличается не отделкой,
  // а сырьём: не футер с начёсом, а полотно из шерстяной, кашемировой или
  // хлопковой пряжи. Отсюда другой уход, другой расход и другая цена, и
  // вписать свитер в свитшот значило бы напечатать фабрике футер там, где
  // закупается пряжа.
  //
  // ВАЖНО про способ производства: обе категории заведены как КРОЙ-И-ШЕЙ —
  // полотно вяжется рулоном, раскраивается и стачивается, как трикотажный
  // верх. Изделие, СВЯЗАННОЕ ПО ФОРМЕ (fully fashioned, детали вывязываются
  // по контуру и соединяются кеттлёвкой), нашим движком не описывается вовсе:
  // у него нет ни раскладки, ни расхода в метрах, ни припусков — расход
  // считается в граммах пряжи. Это названо в gap справочников, а не скрыто.
  cardigan: {
    ru: 'кардиган',
    en: 'cardigan',
    zh: '开衫',
    gender: 'm',
    class: 'top',
    fabric: 'knit',
    visual:
      'button-through knit cardigan, open all the way down the centre front with a full-length button placket, a narrow ribbed neckband, ribbed cuffs and a ribbed hem, no hood',
  },
  sweater: {
    ru: 'свитер',
    en: 'sweater',
    zh: '毛衫',
    gender: 'm',
    class: 'top',
    fabric: 'knit',
    visual:
      'knit pullover sweater with a ribbed crew neckline, ribbed cuffs and a ribbed hem, a closed front with no opening of any kind',
  },

  // Первый тканый верх. Полотно здесь не пометка, а способ сборки: рубашка
  // держится на воротнике со стойкой, планке с петлями и кокетке, а срезы
  // либо обмётываются, либо убираются в запошивочный шов. Трикотажной
  // рубашки не бывает — бывает поло, и оно заведено отдельно.
  shirt: {
    ru: 'рубашка',
    en: 'shirt',
    zh: '衬衫',
    gender: 'f',
    class: 'top',
    fabric: 'woven',
    visual:
      'classic woven shirt with a two-piece stand collar, a buttoned front placket, a back yoke and barrel cuffs',
  },
  // Блузка — не «женская рубашка»: у неё тоньше полотно, мягче посадка и
  // чаще нет кокетки с запошивочным швом. Разводить их по одной категории
  // значило бы печатать фабрике узлы сорочки на блузе из штапеля.
  blouse: {
    ru: 'блузка',
    en: 'blouse',
    zh: '女式衬衣',
    gender: 'f',
    class: 'top',
    fabric: 'woven',
    visual:
      'soft woven blouse with a plain neckline finished with a facing, a buttoned front placket and set-in long sleeves',
  },

  // Первое изделие низа. Здесь впервые меняется опорная величина: юбку
  // держат бёдра, а не грудь, и масштаб считается от них. Всё, что выше
  // талии, у неё отсутствует вовсе — ни проймы, ни горловины, ни рукава.
  skirt: {
    ru: 'юбка',
    en: 'skirt',
    zh: '半身裙',
    gender: 'f',
    class: 'bottom',
    fabric: 'woven',
    visual:
      'woven straight skirt falling below the knee, shaped with waist darts, a set-in waistband and a concealed back zip',
  },

  // Первое изделие с шаговым швом и гульфиком. Опорная величина та же,
  // что у юбки, — бёдра; у мужчин их в стандарте нет, и там масштаб
  // считается от талии, о чём документ говорит вслух.
  trousers: {
    ru: 'брюки',
    en: 'trousers',
    zh: '裤子',
    // «Брюки женские»: множественное число ведёт себя как женский род
    // в реквизите ярлыка.
    gender: 'f',
    class: 'bottom',
    fabric: 'woven',
    visual:
      'woven straight-leg trousers with a set-in waistband, belt loops, a zip fly and side-seam pockets',
  },

  // Первая вещь вне стритвира. Верх у неё конструктивно тот же, что
  // у лонгслива, — та же пройма, тот же втачной рукав, та же обработка
  // горловины; отличие в раскрое, а не в узлах. Поэтому платье честно
  // наследует выверенные отношения, а не заводит выдуманные свои.
  /**
   * Куртка: утеплённая вещь на подкладке.
   *
   * Первая категория класса `outerwear` (11 сентября 2026) и первое
   * изделие, у которого полотен больше одного: верх, подкладка и
   * утеплитель. До неё вся спецификация считала одно полотно.
   *
   * Парка и пуховик отдельными категориями НЕ заводятся: от куртки они
   * отличаются длиной, навеской утеплителя и капюшоном — то есть
   * значениями, а не устройством. Заводить под каждое значение свою
   * категорию значило бы плодить справочники, которые отличаются одной
   * строкой.
   */
  jacket: {
    ru: 'куртка',
    en: 'jacket',
    zh: '夹克',
    gender: 'f',
    class: 'outerwear',
    fabric: 'woven',
    visual:
      'insulated hip-length jacket in technical woven fabric, full-length separating front zip with a storm flap, stand collar, two welt pockets at the hip, elasticated cuffs, quilted body, fully lined',
  },
  /**
   * Пальто: длинная вещь на подкладке из пальтового полотна.
   *
   * От куртки отличается не длиной, а устройством борта: у пальто
   * подборт, лацкан и отложной воротник, втачанный вместе с подбортом.
   * Это другой набор узлов и другие детали кроя, поэтому категория своя.
   */
  coat: {
    ru: 'пальто',
    en: 'coat',
    zh: '大衣',
    gender: 'n',
    class: 'outerwear',
    fabric: 'woven',
    visual:
      'single-breasted wool coat falling below the knee, notched lapels and a flat collar, button-through front, two jetted pockets at the hip, set-in sleeves, back vent, fully lined',
  },
  /**
   * Бомбер: короткая куртка с рибом по низу, манжетам и горловине.
   *
   * Единственное изделие, где основное полотно тканое, а отделочное —
   * трикотажное. Риб здесь не украшение: он держит форму низа и
   * манжеты, и без него бомбер перестаёт быть бомбером.
   */
  bomber: {
    ru: 'бомбер',
    en: 'bomber jacket',
    zh: '飞行员夹克',
    gender: 'm',
    class: 'outerwear',
    fabric: 'woven',
    visual:
      'cropped bomber jacket in technical woven fabric, full-length separating front zip, ribbed stand collar, ribbed cuffs and ribbed hem band, two slash pockets at the side seams, lined',
  },
  dress: {
    ru: 'платье',
    en: 'dress',
    zh: '连衣裙',
    gender: 'n',
    class: 'whole',
    fabric: 'knit',
    visual: 'knit dress falling below the knee, set-in long sleeves',
    visual_woven:
      'woven dress falling below the knee, set-in long sleeves, shaped with waist darts and closed with a concealed back zip',
  },
} as const satisfies Record<string, CategoryEntry>;

export type Category = keyof typeof CATEGORY_REGISTRY;

export const CATEGORIES = Object.keys(CATEGORY_REGISTRY) as readonly Category[];

export const CategorySchema = z.enum(CATEGORIES as [Category, ...Category[]]);

const field = <K extends keyof CategoryEntry>(key: K): Record<Category, CategoryEntry[K]> =>
  Object.fromEntries(
    CATEGORIES.map((c) => [c, (CATEGORY_REGISTRY[c] as CategoryEntry)[key]]),
  ) as Record<Category, CategoryEntry[K]>;

export const CATEGORY_LABEL_RU = field('ru');
export const CATEGORY_LABEL_EN = field('en');
export const CATEGORY_LABEL_ZH = field('zh');
export const CATEGORY_GRAMMATICAL_GENDER = field('gender');
export const CATEGORY_CLASS = field('class');
export const CATEGORY_FABRIC = field('fabric');
export const CATEGORY_VISUAL_EN = field('visual');

/**
 * Описание изделия для рисующей модели с учётом полотна.
 *
 * У категории без тканого исполнения вариант не заводится, и вопрос
 * не возникает: футболка из ткани — уже не футболка, а блузка.
 */
export function categoryVisual(category: Category, fabric: FabricKind): string {
  const entry = CATEGORY_REGISTRY[category] as CategoryEntry;
  return fabric === 'woven' && entry.visual_woven ? entry.visual_woven : entry.visual;
}

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
