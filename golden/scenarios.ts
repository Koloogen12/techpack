import type { StyleSpecInput } from '@specform/assembly';

/**
 * Матрица сценариев голден-сета.
 *
 * Не «happy path и пара крайних случаев», а перебор того, что реально
 * приходит от пользователей: разные полы, посадки, ряды, наличие или
 * отсутствие профиля бренда, калибровка рулеткой, несколько цветов,
 * наблюдения с фотографий.
 *
 * Каждый сценарий гоняется через полный пайплайн, и на результате
 * проверяется один и тот же набор инвариантов (см. invariants.ts).
 * Так деградация ловится на любом входе, а не только на удобном.
 */

const AT = new Date('2026-08-25T00:00:00.000Z');

const base: StyleSpecInput = {
  id: 'golden',
  name: 'Базовая футболка',
  article: 'TSH-001',
  category: 'tshirt',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'semi_fitted',
  fabric_kind: 'knit',
  size_range: [42, 44, 46, 48, 50, 52],
  generated_at: AT,
};

export interface Scenario {
  name: string;
  /** Что именно проверяет этот вход — попадает в отчёт при падении. */
  why: string;
  input: StyleSpecInput;
}

export const SCENARIOS: Scenario[] = [
  {
    name: 'базовый: женская футболка RU 46',
    why: 'опорный случай продукта, от него считаются остальные',
    input: base,
  },
  {
    name: 'мужская футболка RU 48',
    why: 'мужская сетка заполнена только по груди — обхваты талии и бёдер пустые',
    input: {
      ...base,
      id: 'g-men',
      gender: 'men',
      base_size_ru: 48,
      base_height_cm: 176,
      size_range: [44, 46, 48, 50, 52],
    },
  },
  {
    name: 'прилегающая посадка',
    why: 'минимальная прибавка: изделие не должно схлопнуться в отрицательные размеры',
    input: { ...base, id: 'g-fitted', fit_intent: 'fitted' },
  },
  {
    name: 'oversize',
    why: 'максимальная прибавка: чертёж и градация не должны разъехаться',
    input: { ...base, id: 'g-oversize', fit_intent: 'oversize' },
  },
  {
    name: 'один размер в ряду',
    why: 'градация пустая — колонки размеров и валидация ряда обязаны это пережить',
    input: { ...base, id: 'g-single', size_range: [46] },
  },
  {
    name: 'базовый размер на краю ряда',
    why: 'вся градация идёт в одну сторону, накопление ошибки максимально',
    input: { ...base, id: 'g-edge', base_size_ru: 42, size_range: [42, 44, 46, 48, 50, 52] },
  },
  {
    name: 'низкий рост',
    why: 'ростовка вычитается: длины обязаны уменьшиться, ширины — нет',
    input: { ...base, id: 'g-short', base_height_cm: 158 },
  },
  {
    name: 'высокий рост',
    why: 'ростовка прибавляется',
    input: { ...base, id: 'g-tall', base_height_cm: 182 },
  },
  {
    name: 'калибровка ручным замером',
    why: 'один замер рулеткой перемасштабирует всё изделие',
    input: { ...base, id: 'g-manual', manual: { code: 'T01', value_cm: 64 } },
  },
  {
    name: 'пропорции с фото, включая неправдоподобную',
    why: 'значения вне диапазона обязаны ограничиваться и терять статус «с фото»',
    input: {
      ...base,
      id: 'g-photo',
      photo_ratios: {
        T01: { ratio: 1.42, confidence: 'high', reason: 'контур виден целиком' },
        T06: { ratio: 0.81, confidence: 'low', reason: 'плечи размыты' },
        T10: { ratio: 0.48, confidence: 'medium' },
        T12: { ratio: 3.5, confidence: 'high', reason: 'заведомо неправдоподобно' },
      },
    },
  },
  {
    name: 'три параллельные строчки по низу',
    why: 'наблюдение с фото меняет узел и требует замены под базовый парк машин',
    input: {
      ...base,
      id: 'g-3rows',
      topstitching: [{ location: 'hem', rows: 3, confidence: 'high' }],
    },
  },
  {
    name: 'подтверждённая с фото горловина',
    why: 'узел получает статус «оценка по фото» вместо типового',
    input: {
      ...base,
      id: 'g-neck',
      visible_elements: [{ key: 'neckline_type', value: 'бейка-риб кольцом', confidence: 'high' }],
    },
  },
  {
    name: 'полотно опознано как интерлок',
    why: 'фактура с фото уточняет основное полотно спецификации',
    input: { ...base, id: 'g-interlock', fabric_class: 'interlock', fabric_confidence: 'medium' },
  },
  {
    name: 'полотно, нетипичное для категории',
    why: 'футер трёхнитка на футболке обязан быть отклонён с объяснением',
    input: { ...base, id: 'g-terry', fabric_class: 'french_terry_3t', fabric_confidence: 'low' },
  },
  {
    name: 'два колорвея и тираж',
    why: 'спецификация и матрица SKU строятся на каждый цвет, расход считается на партию',
    input: {
      ...base,
      id: 'g-colors',
      quantity: 250,
      colorways: [
        { id: 'black', name_ru: 'Чёрный', hex_approx: '#111111' },
        { id: 'ecru', name_ru: 'Экрю', hex_approx: '#EFE8DC' },
      ],
    },
  },
  {
    name: 'полный профиль бренда',
    why: 'обязательные реквизиты маркировки заполняются, кроме даты выпуска',
    input: {
      ...base,
      id: 'g-brand',
      brand_profile: {
        company_name: 'ООО «Пример»',
        inn: '7700000000',
        address: '101000, Москва, ул. Примерная, д. 1',
        trademark: 'ПРИМЕР',
        country: 'Россия',
      },
    },
  },
  {
    name: 'без профиля бренда',
    why: 'пробелы маркировки обязаны быть видны и объяснять, как их закрыть',
    input: { ...base, id: 'g-nobrand' },
  },
  {
    name: 'расширенный парк машин',
    why: 'та же модель на фабрике со спецмашинами не требует замен',
    input: {
      ...base,
      id: 'g-extended',
      machine_park: 'extended_shop',
      topstitching: [{ location: 'hem', rows: 3, confidence: 'high' }],
    },
  },
  {
    name: 'всё сразу',
    why: 'сочетание признаков не должно ломать то, что работает по отдельности',
    input: {
      ...base,
      id: 'g-kitchen-sink',
      gender: 'men',
      base_size_ru: 50,
      base_height_cm: 182,
      fit_intent: 'oversize',
      size_range: [46, 48, 50, 52, 54],
      quantity: 500,
      manual: { code: 'T03', value_cm: 62 },
      machine_park: 'base_shop',
      photo_ratios: { T01: { ratio: 1.3, confidence: 'medium' } },
      topstitching: [{ location: 'hem', rows: 3, confidence: 'high' }],
      visible_elements: [{ key: 'neckline_type', value: 'бейка-риб', confidence: 'high' }],
      fabric_class: 'single_jersey',
      fabric_confidence: 'high',
      colorways: [
        { id: 'black', name_ru: 'Чёрный' },
        { id: 'white', name_ru: 'Белый' },
        { id: 'navy', name_ru: 'Тёмно-синий' },
      ],
      brand_profile: {
        company_name: 'ООО «Пример»',
        address: 'Москва',
        trademark: 'X',
        country: 'Россия',
      },
    },
  },
];
