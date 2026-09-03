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
  /** Легенда к схемам швов под таблицей узлов. */
  seam_legend_title: string;
  seam_legend_body: string;
  node_stitch: string;
  node_spi: string;
  node_machine: string;
  node_allowance: string;

  // --- Чертёж ----------------------------------------------------------------
  view_front: string;
  view_back: string;
  view_side: string;
  flats_label: string;
  /**
   * Оговорка на чертеже из библиотеки силуэтов.
   *
   * Такой вид масштабирован под габарит изделия, но не деформирован под
   * каждый замер: контрольных точек у покупного силуэта нет. Молчать об
   * этом нельзя — с чертежа снимают размеры, и лист обязан сказать, что
   * источник размеров здесь один: табель мер.
   */
  flats_library_disclaimer: string;
  flats_library_note: string;
  /**
   * Оговорка о деталях, которых на подобранном силуэте нет.
   *
   * Изделие их требует — узел обработки есть, — а библиотечный силуэт
   * такой детали не рисует. Выноску на пустое место мы не ставим, но и
   * молчать нельзя: технолог обязан узнать, что карман на иллюстрации не
   * показан, а не искать его глазами.
   */
  flats_library_missing: string;
  /**
   * Откуда взят силуэт и что исходник приложен.
   *
   * Фабрике это не мелочь: по идентификатору она находит в комплекте тот
   * самый вектор и не обводит растр заново.
   */
  flats_library_source: string;
  /**
   * Пометка «значение подлежит подтверждению».
   *
   * Само объяснение, ЧТО именно подтвердить, написано по-русски и адресовано
   * нам: это рабочая заметка справочника, а не сообщение фабрике. В чужом
   * комплекте от неё остаётся только флаг — иначе в китайском паке стоит
   * русский абзац, который там никто не прочтёт.
   */
  to_be_confirmed: string;

  // --- Паспорт изделия на обложке --------------------------------------------
  cover_category: string;
  cover_fit: string;
  cover_sizes: string;
  cover_shell: string;

  // --- Бланк замеров ---------------------------------------------------------
  //
  // Самый ответственный текст продукта. По этим правилам человек мерит
  // отшитый образец, и от них зависит, СРАВНИМЫ ли замеры вообще. Натянутая
  // лента даёт плюс сантиметр, замер на манекене — систематический сдвиг,
  // и оба испортят не один документ, а всю калибровку.
  form_kicker: string;
  form_who: string;
  form_date: string;
  form_label_size: string;
  form_tool: string;
  form_rules_title: string;
  form_rules: readonly string[];
  form_th_point: string;
  form_th_value: string;
  form_th_repeat: string;
  form_th_note: string;
  form_foot: string;

  // --- Технологическая последовательность ------------------------------------
  seq_title: string;
  seq_no: string;
  seq_operation: string;
  seq_specialty: string;
  seq_machine: string;
  seq_time: string;
  seq_time_note: string;

  // --- Маркировка, нанесение, колорвеи ---------------------------------------
  //
  // Разделы фабричного комплекта: подписи и таблицы переведены, а длинные
  // пояснения о происхождении значений — нет. Они написаны для основателя
  // бренда, фабрике не нужны, и переводить их значило бы гнать объём.
  labels_requisites: string;
  labels_care: string;
  labels_care_ru_only: string;
  labels_sku_matrix: string;
  labels_col_sku: string;
  labels_col_color: string;
  labels_col_size: string;
  labels_col_gtin: string;
  labels_gtin_tbd: string;
  labels_ru_only: string;

  art_zone: string;
  art_technique: string;
  art_offset: string;
  art_size: string;
  art_repeat_step: string;
  art_colors: string;
  art_colors_full: string;
  /** Слово после числа: «3 плашечных». Число печатается со своим статусом. */
  art_colors_spot: string;
  art_file: string;
  art_file_none: string;
  art_repeat_type: string;
  art_repeat_mirror: string;
  art_repeat_straight: string;
  art_grain: string;
  art_yardage: string;
  art_yardage_tbd: string;
  art_ru_only: string;

  cw_origin: string;
  cw_from_swatch: (file: string) => string;
  cw_from_brand: string;
  cw_not_set: string;
  cw_screen_color: string;
  cw_lab: string;
  cw_book_code: string;
  cw_ru_only: string;

  // --- Общее -----------------------------------------------------------------
  sheet_of: (n: number, total: number) => string;

  // ------------------------------------------------------------ лист на просчёт
  //
  // Отдельный документ на языке фабрики. Русский лист китайскому цеху
  // бесполезен ровно так же, как русский техпак: просчёт — первый контакт,
  // и непонятная бумага на нём заканчивается.
  rfq_kicker: string;
  rfq_row_category: string;
  rfq_row_article: string;
  rfq_row_fit: string;
  rfq_row_fabric: string;
  rfq_row_trim: string;
  rfq_row_qty: string;
  rfq_row_sizes: string;
  rfq_row_consumption: string;
  rfq_units_pcs: string;
  /** Единица плотности полотна: заголовок колонки для этого не годится. */
  rfq_gsm_unit: string;
  /** Подпись под эскизом: тот же чертёж, что в паке. */
  rfq_sketch_caption: string;
  /** Раскладка тиража по размерам не задана — так и говорим. */
  rfq_ratio_tbc: string;
  rfq_consumption: (perUnit: string, perBatch: string | null) => string;
  rfq_affects_title: string;
  rfq_ask_title: string;
  rfq_ask_price: string;
  rfq_ask_reply_by: (date: string) => string;
  rfq_ask_moq: string;
  rfq_ask_lead_time: string;
  rfq_ask_outsourced: string;
  /** Что лежит в полном техпаке. */
  rfq_pack_note: string;
  rfq_pack_on_request: string;
  rfq_pack_open: (link: string) => string;
  rfq_contact_title: string;
  rfq_contact_missing: string;
  /** Первая фраза сообщения: категория и посадка. */
  rfq_text_quote: (category: string, fit: string) => string;
  rfq_text_fabric: (name: string, gsm: string | null) => string;
  rfq_text_qty: (qty: number | null) => string;
  rfq_text_sizes: (line: string) => string;
  rfq_text_pack: string;
  rfq_text_pack_link: (link: string) => string;
  rfq_text_contact: (who: string) => string;
  /** Особенности, которые меняют цену и срок. */
  rfq_hl_allover: (stepCm: string, roll: boolean) => string;
  rfq_hl_artwork: (zone: string, w: string, h: string, technique: string) => string;
  rfq_hl_special: (nodes: string) => string;
  rfq_hl_colorways: (n: number) => string;
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
