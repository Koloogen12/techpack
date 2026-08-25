import { describe, expect, it } from 'vitest';
import { buildStyleSpec } from '@specform/assembly';
import { isSpecFormError } from '@specform/core';
import { renderHtml } from '@specform/docgen';
import {
  CATEGORIES,
  CATEGORY_LABEL_RU,
  FIT_INTENT_LABEL_RU,
  MACHINE_LABEL_RU,
  MACHINE_TYPES,
  ZONE_LABEL_RU,
  NODE_ZONES,
} from '@specform/kb';
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
      expect(isSpecFormError(e), String(e)).toBe(true);
      if (isSpecFormError(e)) {
        expect(leaked(e.userMessage), e.userMessage).toEqual([]);
        expect(leaked(e.userAction), e.userAction).toEqual([]);
      }
    }
  });
});
