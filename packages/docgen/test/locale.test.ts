import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStyleSpec, type StyleSpec } from '@seamsterly/stylespec';
import { LOCALES } from '@seamsterly/i18n';
import { renderHtml, TRANSLATED_SECTIONS } from '../src/index.js';

const RAW: StyleSpec = parseStyleSpec(
  JSON.parse(
    readFileSync(
      new URL('../../stylespec/examples/hoodie-allover-pattern.json', import.meta.url),
      'utf8',
    ),
  ),
);

/**
 * Название и описание изделия придумывает БРЕНД, и они законно русские.
 * Проверяя язык документа, их надо исключить: иначе тест ловит данные
 * заказчика вместо нашего текста.
 */
const SPEC: StyleSpec = {
  ...RAW,
  style: { ...RAW.style, name: 'Oversize Hoodie', description: 'French terry hoodie' },
  bom: RAW.bom
    ? {
        ...RAW.bom,
        colorways: RAW.bom.colorways.map((c) => ({ ...c, name_ru: c.id })),
      }
    : undefined,
};

const sectionsOf = (h: string): string[] =>
  [...h.matchAll(/data-section="([a-z_]+)"/g)].map((m) => m[1]!);

/**
 * Текст без разметки — по нему проверяется язык, а не имена классов.
 *
 * Ячейки с data-ru-content выброшены намеренно: это надписи, которые
 * фабрика печатает НА ЯРЛЫКЕ, и они русские по ТР ТС 017/2011 в любом
 * комплекте. Перевести их значило бы выдать фабрике текст, который нельзя
 * ставить на изделие.
 */
const textOf = (h: string): string =>
  h
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<td data-ru-content[^>]*>[\s\S]*?<\/td>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ');

describe('комплект на другом языке', () => {
  it.each(LOCALES)('%s собирается', (locale) => {
    expect(renderHtml(SPEC, { locale, pro: true }).length).toBeGreaterThan(1000);
  });

  it.each(['en', 'zh'] as const)('в %s не осталось кириллицы', (locale) => {
    // Главное свойство. Половина подписей на незнакомом языке заставит
    // фабрику написать письмо и ждать ответа — цикл размещения заказа
    // удлинится на сутки. Отсутствующий раздел честнее нечитаемого.
    const text = textOf(renderHtml(SPEC, { locale, pro: true }));
    const cyrillic = text.match(/[а-яА-ЯёЁ]{3,}/g) ?? [];
    expect(cyrillic).toEqual([]);
  });

  it('нерусский комплект содержит только переведённые целиком разделы', () => {
    const sections = new Set(sectionsOf(renderHtml(SPEC, { locale: 'en' })));
    for (const s of sections) expect(TRANSLATED_SECTIONS).toContain(s);
  });

  it('русский комплект содержит всё', () => {
    const sections = new Set(sectionsOf(renderHtml(SPEC, { locale: 'ru', pro: true })));
    expect(sections.size).toBeGreaterThan(TRANSLATED_SECTIONS.length);
  });

  it.each(['en', 'zh'] as const)(
    '%s несёт оговорку о переводе и список непереведённого',
    (locale) => {
      // Умолчать значило бы дать фабрике основание померить по нашей
      // формулировке и предъявить нам партию.
      const html = renderHtml(SPEC, { locale });
      expect(html).toContain('TRANSLATION');
      expect(html).toContain('Issued in Russian only');
    },
  );

  it('русский комплект оговорки о переводе не несёт — он не перевод', () => {
    expect(renderHtml(SPEC, { locale: 'ru' })).not.toContain('TRANSLATION');
  });

  it('названия точек берутся на языке комплекта', () => {
    const en = renderHtml(SPEC, { locale: 'en' });
    const zh = renderHtml(SPEC, { locale: 'zh' });
    expect(en).toContain('Across Shoulder');
    expect(zh).toContain('肩宽');
    expect(en).not.toContain('肩宽');
  });

  it('инструкция «где мерить» переведена, а не оставлена английской в китайском', () => {
    expect(renderHtml(SPEC, { locale: 'zh' })).toContain('平铺');
  });
});
