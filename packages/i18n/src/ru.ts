import type { Messages } from './messages.js';

export const RU: Messages = {
  doc_title: 'Технический пакет',
  section_cover: 'Технический пакет',
  section_changes: 'Что изменилось',
  section_preview: 'Внешний вид',
  section_flats: 'Технический чертёж',
  section_measurements: 'Табель мер',
  section_grading: 'Градация и приёмка',
  section_bom: 'Спецификация материалов',
  section_colorways: 'Колорвеи',
  section_construction: 'Конструкция',
  section_artwork: 'Нанесение',
  section_pattern_preview: 'Раппорт на изделии',
  section_labels: 'Маркировка и артикулы',
  section_patterns: 'Лекала и раскладка',

  meta_brand: 'Бренд',
  meta_model: 'Модель',
  meta_article: 'Артикул',
  meta_season: 'Сезон',
  meta_base_size: 'Базовый размер',
  meta_version: 'Версия · тираж',
  meta_height: 'рост',
  meta_qty: 'шт',
  meta_empty_brand: '[не заполнено — профиль бренда]',
  meta_empty_season: '[не заполнено — анкета]',

  status_fit_confirmed: 'подтверждено по образцу',
  status_user_input: 'указано вами',
  status_measured_by_scale: 'снято по масштабу',
  status_estimated_from_photo: 'оценка по фото',
  status_default_from_base: 'типовое значение',
  status_assumption: 'предположение',

  pom_code: 'Код',
  pom_point: 'Точка измерения',
  pom_how: 'Как мерить',
  pom_base: 'База',
  pom_tolerance: 'Допуск',
  pom_sheet: 'Табель мер',
  pom_intro:
    'Все замеры — изделие в разложенном виде, если не сказано иное. ' +
    'Допуск ± по каждой точке: по нему работает приёмка.',

  grading_step: 'На размер, см',
  grading_rule: 'Правило',
  grading_origin: 'Происхождение',
  grading_intro:
    'Таблица размеров — в табеле мер. Здесь правило, по которому она построена: ' +
    'на сколько растёт каждая точка при переходе на размер вверх.',
  grading_not_graded: 'Не градуируются',
  grading_acceptance_title: 'Приёмка: правила, которых поточечный допуск не выражает',
  grading_acceptance_intro:
    'Табель мер задаёт допуск на каждую точку. Этого мало: ' +
    'часть брака поточечная проверка пропускает по устройству.',
  grading_origin_primary: 'первоисточник',
  grading_origin_expert: 'экспертная оценка',

  bom_code: 'Код',
  bom_item: 'Позиция',
  bom_purpose: 'Назначение',
  bom_composition: 'Состав',
  bom_gsm: 'г/м²',
  bom_consumption: 'Расход',
  bom_supplier: 'Артикул поставщика',
  bom_supplier_tbd: 'уточняется у поставщика',
  bom_colorways: 'Колорвеи',

  node_zone: 'Зона',
  node_name: 'Узел',
  node_seam: 'Шов',
  node_stitch: 'Стежок',
  node_spi: 'SPI',
  node_machine: 'Машина',
  node_allowance: 'Припуск',

  view_front: 'Перед',
  view_back: 'Спинка',
  view_side: 'Бок',
  flats_label: 'Технический чертёж · виды в одном масштабе между собой, размеры — в табеле мер',

  sheet_of: (n, total) => `Лист ${n} из ${total}`,
  cm: 'см',
  pcs: 'шт',
  m: 'м',
  not_filled: 'не заполнено',

  translation_notice: '',
  translation_verified_notice: '',
};
