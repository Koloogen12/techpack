import { assume, fromBase, userInput, type Tracked } from '@specform/core';
import {
  categoryWithGender,
  kb as defaultKb,
  type Category,
  type Gender,
  type KnowledgeBase,
} from '@specform/kb';

/**
 * Движок маркировки.
 *
 * Дифференциатор R9: у конкурента локальной нормативки нет вообще.
 * Незаполненный обязательный реквизит по статье 9 ТР ТС 017 блокирует продажу,
 * поэтому документ обязан показывать пробел, а не прятать его.
 */

export interface BrandProfile {
  /**
   * Юрлицо-изготовитель.
   *
   * Все поля объявлены как `?: T | undefined` намеренно: профиль приходит
   * из JSON через zod, а тот выводит именно такую форму. В строгом режиме
   * `?: T` и `?: T | undefined` — разные типы, и подменять одно другим
   * означало бы врать компилятору на границе данных.
   */
  company_name?: string | undefined;
  inn?: string | undefined;
  /** Юридический адрес производства. */
  address?: string | undefined;
  trademark?: string | undefined;
  country?: string | undefined;
}

export interface LabelsInput {
  category: Category;
  gender: Gender;
  /** Артикул модели — основа кодов SKU. */
  article: string;
  size_range: readonly number[];
  colorways: readonly { id: string; name_ru: string }[];
  /** Состав основного полотна — берётся из спецификации, не выдумывается заново. */
  composition: string;
  /** Профиль ухода полотна. */
  care_profile_id: string;
  brand?: BrandProfile;
}

export interface LabelRequisiteValue {
  id: string;
  label_ru: string;
  value: Tracked<string> | null;
  required: boolean;
  /** Что сделать, чтобы реквизит заполнился. Пусто, если значение есть. */
  action_ru: string | null;
}

export interface CareSymbolValue {
  group: string;
  id: string;
  label_ru: string;
}

export interface SkuRow {
  /** Артикул позиции: модель-цвет-размер. */
  sku: string;
  colorway_id: string;
  colorway_ru: string;
  size_ru: number;
  /** Плейсхолдер под GTIN из Нацкаталога. Мы его не выдаём и не выдумываем. */
  gtin: null;
}

export interface LabelsResult {
  /** Символы ухода в обязательном порядке ГОСТ ISO 3758. */
  care_symbols: CareSymbolValue[];
  /** Обязательные реквизиты по статье 9 ТР ТС 017. */
  requisites: LabelRequisiteValue[];
  sku_matrix: SkuRow[];
  notes: string[];
}

export function buildLabels(input: LabelsInput, base: KnowledgeBase = defaultKb()): LabelsResult {
  const notes: string[] = [];
  const brand = input.brand ?? {};

  const care_symbols = base.careSymbolsOrdered(input.care_profile_id);
  // Регистр не трогаем: «30 °C» в нижнем регистре превращается в «30 °c»,
  // а на ярлыке это уже не обозначение температуры.
  const careText = care_symbols.map((s) => s.label_ru).join(' · ');

  const values: Record<string, Tracked<string> | null> = {
    // Категория и пол приходят из анкеты, а не из справочника: реквизит
    // обязательный, и показывать его «типовым значением» значит занижать
    // доверие к тому, что пользователь сам же и указал.
    product_name: userInput(
      categoryWithGender(input.category, input.gender),
      'user:answers.category+gender',
    ),
    country: brand.country ? userInput(brand.country, 'user:brand_profile.country') : null,
    manufacturer:
      brand.company_name && brand.address
        ? userInput(`${brand.company_name}, ${brand.address}`, 'user:brand_profile.manufacturer')
        : null,
    importer: null,
    size: fromBase(
      input.size_range.map((ru) => `RU ${ru}`).join(' · '),
      'engine:labels/size',
      'на ярлык каждого изделия печатается его собственный размер',
    ),
    // Типовой состав из справочника описателен («возможен эластан 5–10%») и на ярлык
    // как есть не годится: статья 9 ТР ТС требует точные проценты по волокнам
    // в порядке убывания. Поэтому значение помечено предположением с прямым указанием.
    composition: assume(
      input.composition,
      'engine:labels/composition',
      'типовой состав категории. На ярлык нужны точные проценты по волокнам ' +
        'в порядке убывания — возьмите их из паспорта полотна у поставщика',
    ),
    trademark: brand.trademark ? userInput(brand.trademark, 'user:brand_profile.trademark') : null,
    production_date: null,
    care_symbols: fromBase(careText, `kb:care_symbols#${input.care_profile_id}`),
    eac: fromBase('EAC', 'kb:labeling_requirements#eac'),
  };

  const ACTIONS: Record<string, string> = {
    country: 'Заполните страну производства в профиле бренда',
    manufacturer: 'Заполните юрлицо и адрес в профиле бренда',
    trademark: 'Заполните товарный знак в профиле бренда',
    production_date: 'Дату проставляет фабрика при выпуске партии',
    importer: 'Заполняется только для импортной продукции',
  };

  const requisites: LabelRequisiteValue[] = base.labelRequisites().map((r) => {
    const value = values[r.id] ?? null;
    return {
      id: r.id,
      label_ru: r.label_ru,
      value,
      required: r.required,
      action_ru: value === null ? (ACTIONS[r.id] ?? 'Заполните значение вручную') : null,
    };
  });

  const missing = requisites.filter((r) => r.required && r.value === null);
  if (missing.length) {
    notes.push(
      `Не заполнено обязательных реквизитов маркировки: ${missing.length} ` +
        `(${missing.map((r) => r.label_ru.toLowerCase()).join(', ')}). ` +
        `Без них продажа в ЕАЭС невозможна — заполните профиль бренда.`,
    );
  }

  // --- Матрица SKU ------------------------------------------------------------
  const sku_matrix: SkuRow[] = input.colorways.flatMap((c) =>
    input.size_range.map((ru) => ({
      sku: `${input.article}-${c.id.toUpperCase()}-${ru}`,
      colorway_id: c.id,
      colorway_ru: c.name_ru,
      size_ru: ru,
      gtin: null,
    })),
  );

  notes.push(
    `Матрица артикулов: ${sku_matrix.length} позиций (${input.colorways.length} цвет` +
      `${input.colorways.length === 1 ? '' : 'а'} × ${input.size_range.length} размеров). ` +
      `Коды GTIN получает бренд в Нацкаталоге — мы оставляем плейсхолдеры.`,
  );

  return { care_symbols, requisites, sku_matrix, notes };
}

/** Сколько реквизитов маркировки не заполнено и блокирует продажу. */
export function countLabelGaps(requisites: readonly LabelRequisiteValue[]): number {
  return requisites.filter((r) => r.required && r.value === null).length;
}
