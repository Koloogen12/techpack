/**
 * Словарь документа: русский, английский, китайский.
 *
 * Устройство выбрано ради одного свойства: НЕДОПЕРЕВЕДЁННЫЙ ДОКУМЕНТ
 * НЕ ДОЛЖЕН СОБИРАТЬСЯ. Ключи описаны интерфейсом, каждый язык обязан
 * реализовать его целиком, и забытая строка — ошибка компиляции, а не
 * русское слово посреди китайского техпака.
 *
 * Это не педантизм. Фабрика в Китае, получив лист, где половина подписей
 * на незнакомом языке, не станет угадывать — она напишет письмо и будет
 * ждать ответа, и цикл размещения заказа удлинится на сутки.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Доменные тексты — названия точек, инструкции «где мерить»,
 * названия материалов и узлов — живут в справочниках вместе с источником
 * и пометкой проверки. Их место там, а не здесь: перевод инструкции
 * «где мерить» это данные производства, а не подпись кнопки.
 */

export const LOCALES = ['ru', 'en', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABEL: Record<Locale, string> = {
  ru: 'Русский',
  en: 'English',
  zh: '中文',
};

export interface Messages {
  // --- Разделы ---------------------------------------------------------------
  doc_title: string;
  section_cover: string;
  section_changes: string;
  section_preview: string;
  section_flats: string;
  section_measurements: string;
  section_grading: string;
  section_bom: string;
  section_colorways: string;
  section_construction: string;
  section_artwork: string;
  section_pattern_preview: string;
  section_labels: string;
  section_patterns: string;

  // --- Мета-полоса -----------------------------------------------------------
  meta_brand: string;
  meta_model: string;
  meta_article: string;
  meta_season: string;
  meta_base_size: string;
  meta_version: string;
  meta_height: string;
  meta_qty: string;
  meta_empty_brand: string;
  meta_empty_season: string;

  // --- Статусы значений ------------------------------------------------------
  status_fit_confirmed: string;
  status_user_input: string;
  status_measured_by_scale: string;
  status_estimated_from_photo: string;
  status_default_from_base: string;
  status_assumption: string;

  // --- Табель мер ------------------------------------------------------------
  pom_code: string;
  pom_point: string;
  pom_how: string;
  pom_base: string;
  pom_tolerance: string;
  pom_sheet: string;
  pom_intro: string;

  // --- Градация --------------------------------------------------------------
  grading_step: string;
  grading_rule: string;
  grading_origin: string;
  grading_intro: string;
  grading_not_graded: string;
  grading_acceptance_title: string;
  grading_acceptance_intro: string;
  grading_origin_primary: string;
  grading_origin_expert: string;

  // --- Спецификация ----------------------------------------------------------
  bom_code: string;
  bom_item: string;
  bom_purpose: string;
  bom_composition: string;
  bom_gsm: string;
  bom_consumption: string;
  bom_supplier: string;
  bom_supplier_tbd: string;
  bom_colorways: string;

  // --- Конструкция -----------------------------------------------------------
  node_zone: string;
  node_name: string;
  node_seam: string;
  node_stitch: string;
  node_spi: string;
  node_machine: string;
  node_allowance: string;

  // --- Чертёж ----------------------------------------------------------------
  view_front: string;
  view_back: string;
  view_side: string;
  flats_label: string;

  // --- Общее -----------------------------------------------------------------
  sheet_of: (n: number, total: number) => string;
  cm: string;
  pcs: string;
  m: string;
  not_filled: string;

  /**
   * Оговорка о языке. Стоит на обложке любого нерусского комплекта.
   *
   * Документ обязан сказать, что он переведён и кем перевод не проверен:
   * иначе фабрика примет наши формулировки за выверенные и померяет
   * по ним, а мы узнаем об этом на приёмке партии.
   */
  translation_notice: string;
  translation_verified_notice: string;
}
