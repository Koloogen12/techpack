import { describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '@seamsterly/assembly';
import { isSeamsterlyError } from '@seamsterly/core';
import { renderHtml, renderRfqHtml, rfqText } from '@seamsterly/docgen';
import {
  CATEGORIES,
  type Category,
  CATEGORY_LABEL_RU,
  FIT_INTENT_LABEL_RU,
  MACHINE_LABEL_RU,
  MACHINE_TYPES,
  ZONE_LABEL_RU,
  NODE_ZONES,
} from '@seamsterly/kb';
import { LOCALES, messages } from '@seamsterly/i18n';
import { SCENARIOS } from './scenarios.js';

/**
 * Русский язык всего, что видит человек.
 *
 * Продукт написан на английских ключах внутри и на русском снаружи. Граница
 * между ними ничем не помечена, поэтому ключ утекает в текст незаметно —
 * так в отказе категорийного гейта появилось «Похоже, на фото не tshirt».
 *
 * Здесь эта граница проверяется машиной: любое сообщение, примечание или
 * страница документа обязаны быть на русском.
 */

/**
 * Ключи, которые никогда не должны попадать в текст для человека.
 *
 * «oversize» в списке намеренно ОТСУТСТВУЕТ: в отрасли это заимствованный
 * термин, который пишется латиницей. Именно так он записан в спецификации
 * интерфейса (ux/02, Э3 шаг 2) и в макете — это слово, а не непереведённое
 * значение перечисления.
 */
const INTERNAL_KEYS = [
  ...CATEGORIES,
  ...MACHINE_TYPES,
  ...NODE_ZONES,
  'fitted',
  'semi_fitted',
  'loose',
  'knit',
  'woven',
  'women',
  'men',
  'user_input',
  'estimated_from_photo',
  'default_from_base',
  'assumption',
  'fit_confirmed',
];

function leaked(text: string): string[] {
  // Ищем ключ как отдельное слово: «tshirt» в тексте — утечка,
  // а «pom_templates/tshirt» в адресе источника — нет.
  return INTERNAL_KEYS.filter((key) =>
    new RegExp(`(^|[\\s«"(])${key}([\\s»").,;:!?]|$)`).test(text),
  );
}

describe('словари покрывают все внутренние значения', () => {
  it('у каждой категории есть русское название', () => {
    for (const c of CATEGORIES) expect(CATEGORY_LABEL_RU[c], c).toBeTruthy();
  });

  it('у каждого типа машины есть русское название', () => {
    for (const m of MACHINE_TYPES) expect(MACHINE_LABEL_RU[m], m).toBeTruthy();
  });

  it('у каждой зоны изделия есть русское название', () => {
    for (const z of NODE_ZONES) expect(ZONE_LABEL_RU[z], z).toBeTruthy();
  });

  it('у каждой посадки есть русское название', () => {
    for (const f of ['fitted', 'semi_fitted', 'loose', 'oversize'] as const) {
      expect(FIT_INTENT_LABEL_RU[f], f).toBeTruthy();
    }
  });
});

describe('примечания движков не содержат внутренних ключей', () => {
  it.each(SCENARIOS)('$name', ({ input }) => {
    const { notes } = buildStyleSpec(input);
    const problems = notes.flatMap((n) => leaked(n).map((k) => `«${k}» в «${n}»`));
    expect(problems).toEqual([]);
  });
});

describe('документ не содержит внутренних ключей', () => {
  it.each(SCENARIOS)('$name', ({ input }) => {
    const { spec } = buildStyleSpec(input);
    // Текст без разметки: атрибуты вроде data-section содержат ключи законно.
    const text = renderHtml(spec, { pro: true })
      .replace(/<style>[\s\S]*?<\/style>/g, '')
      .replace(/<[^>]+>/g, ' ');
    expect(leaked(text)).toEqual([]);
  });
});

describe('сообщения об ошибках не содержат внутренних ключей', () => {
  const broken = [
    { ...SCENARIOS[0]!.input, base_size_ru: 99 },
    { ...SCENARIOS[0]!.input, base_height_cm: 300 },
    { ...SCENARIOS[0]!.input, size_range: [46, 46] },
    { ...SCENARIOS[0]!.input, category: 'dress' as never },
    {
      ...SCENARIOS[0]!.input,
      colorways: [
        { id: 'a', name_ru: 'А' },
        { id: 'a', name_ru: 'Б' },
      ],
    },
  ];

  it.each(broken.map((input, i) => ({ i, input })))('вариант $i', ({ input }) => {
    try {
      buildStyleSpec(input);
      expect.unreachable('должно было упасть');
    } catch (e) {
      expect(isSeamsterlyError(e), String(e)).toBe(true);
      if (isSeamsterlyError(e)) {
        expect(leaked(e.userMessage), e.userMessage).toEqual([]);
        expect(leaked(e.userAction), e.userAction).toEqual([]);
      }
    }
  });
});

describe('в документе нет внутренних ключей на английском', () => {
  /**
   * Документ читает русский технолог. Внутренний ключ рядом с русским
   * названием — «screen Шелкография» — это не мелочь: он появляется ровно
   * там, где значение хранится ключом, а показывается словом, и находится
   * только глазами. Найдено на первой же странице нанесения.
   */
  const LEAKS = [
    'screen',
    'sublimation',
    'embroidery',
    'chest_center',
    'back_yoke',
    'front_flat',
    'back_flat',
    'a4_sheet',
    'measured_by_scale',
    'default_from_base',
    'estimated_from_photo',
    'fit_confirmed',
  ];

  it.each(SCENARIOS)('$name', ({ input }) => {
    const { spec } = buildStyleSpec(input);
    // Текст без разметки: ключи внутри data-атрибутов, классов и стилей
    // законны — их читает браузер, а не человек. Блок стилей вырезается
    // ЦЕЛИКОМ, а не по тегам: в нём живут имена классов вроде
    // `.dot-fit_confirmed`, и без этого проверка ловит саму себя.
    const text = renderHtml(spec, { pro: true })
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .toLowerCase();
    for (const key of LEAKS) {
      expect(text, `«${key}» в тексте документа`).not.toContain(key);
    }
  });
});

/**
 * Лист чертежа из библиотеки — на языке комплекта целиком.
 *
 * Плашка вшита в сам SVG силуэта, а не в разметку листа, и об этом легко
 * забыть: русская оговорка в китайском паке выглядит как мелочь ровно до
 * той минуты, когда фабрика её не читает.
 */
describe('библиотечный чертёж говорит на языке комплекта', () => {
  const CYRILLIC = /[А-Яа-яЁё]/;

  it.each(LOCALES.filter((l) => l !== 'ru'))('%s: в оговорках нет кириллицы', (locale) => {
    const t = messages(locale);
    for (const key of [
      'flats_library_disclaimer',
      'flats_library_note',
      'flats_library_missing',
      'flats_library_source',
    ] as const) {
      expect(t[key], `${locale}.${key}`).not.toMatch(CYRILLIC);
    }
  });

  it('у каждого языка своя оговорка, а не копия русской', () => {
    const ru = messages('ru').flats_library_disclaimer;
    for (const locale of LOCALES.filter((l) => l !== 'ru')) {
      expect(messages(locale).flats_library_disclaimer).not.toBe(ru);
    }
  });
});

/**
 * Утечки русского в чужой комплект — по РЕНДЕРУ, а не по словарю.
 *
 * Словарные тесты ловят забытый ключ. Они не ловят русское слово, попавшее
 * в документ иначе: подписью внутри SVG, значением из справочника, вольным
 * текстом поля. Именно так «ПЕРЕД» доехало до китайского листа на просчёт —
 * оно жило не в разметке, а в графике.
 */
describe('в чужом комплекте нет наших слов', () => {
  /** Текст, который человек видит: без стилей, скриптов и разметки. */
  const visible = (html: string): string =>
    html
      // Содержимое ярлыка печатается по-русски по ТР ТС 017/2011 — это
      // требование закона, и документ об этом говорит прямо.
      .replace(/<td data-ru-content>[\s\S]*?<\/td>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ');

  const input = (category: Category): StyleSpecInput => ({
    id: 'lang',
    name: 'Lang',
    article: 'LANG-001',
    category,
    gender: 'women',
    base_size_ru: 46,
    base_height_cm: 170,
    fit_intent: 'semi_fitted',
    fabric_kind: 'knit',
    size_range: [44, 46, 48],
    machine_park: 'base_shop',
    generated_at: new Date('2026-08-27T00:00:00.000Z'),
  });

  const foreign = LOCALES.filter((l) => l !== 'ru');
  const cases = CATEGORIES.flatMap((c) => foreign.map((l) => [c, l] as const));

  it.each(cases)('%s/%s: в техпаке', (category, locale) => {
    const { spec } = buildStyleSpec(input(category));
    const words = visible(renderHtml(spec, { pro: true, locale })).match(/[А-Яа-яЁё]{4,}/g) ?? [];
    expect([...new Set(words)]).toEqual([]);
  });

  it.each(cases)('%s/%s: на листе на просчёт', (category, locale) => {
    const { spec } = buildStyleSpec(input(category));
    const words = visible(renderRfqHtml(spec, { locale })).match(/[А-Яа-яЁё]{4,}/g) ?? [];
    expect([...new Set(words)]).toEqual([]);
  });

  it.each(cases)('%s/%s: в тексте для мессенджера', (category, locale) => {
    const { spec } = buildStyleSpec(input(category));
    expect(rfqText(spec, { locale })).not.toMatch(/[А-Яа-яЁё]{4,}/);
  });
});
