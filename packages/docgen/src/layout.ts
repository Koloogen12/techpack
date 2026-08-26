import { chromium, type Browser } from 'playwright';
import type { StyleSpec } from '@seamsterly/stylespec';
import { renderHtml, type HtmlOptions } from './html.js';

/**
 * Проверка вёрстки документа на переполнение.
 *
 * У страницы фиксированная высота, а разбиение длинных таблиц задано числом
 * строк на лист. Число подобрано на глаз — это догадка, а не гарантия: длинный
 * текст в ячейке переносится на две строки, и лист перестаёт вмещать то же
 * количество записей. Переполнение выглядит как наложение следующего раздела
 * поверх хвоста предыдущего, и часть данных пропадает из виду.
 *
 * Поэтому вёрстка меряется по-настоящему, в браузере: содержимое каждой
 * страницы обязано помещаться в её границы. Тест по этой функции ловит
 * переполнение до того, как документ уедет на фабрику.
 */

export interface PageOverflow {
  index: number;
  section: string;
  part: string | null;
  /** На сколько пикселей содержимое выше страницы. */
  overflowPx: number;
}

export interface LayoutReport {
  pages: number;
  overflows: PageOverflow[];
  /** Разделы, попавшие в документ, по порядку. */
  sections: string[];
}

export async function checkLayout(
  spec: StyleSpec,
  options: HtmlOptions & { browser?: Browser } = {},
): Promise<LayoutReport> {
  const own = options.browser === undefined;
  const browser = options.browser ?? (await chromium.launch());

  try {
    const page = await browser.newPage();
    await page.setContent(renderHtml(spec, options), { waitUntil: 'domcontentloaded' });

    const report = await page.evaluate(() => {
      const sections = [...document.querySelectorAll<HTMLElement>('.page')];
      const overflows: {
        index: number;
        section: string;
        part: string | null;
        overflowPx: number;
      }[] = [];

      sections.forEach((el, index) => {
        // Колонтитул позиционирован абсолютно и в поток не входит,
        // поэтому меряем именно поток содержимого страницы.
        const limit = el.clientHeight;
        const content = el.scrollHeight;
        if (content > limit + 1) {
          overflows.push({
            index,
            section: el.dataset.section ?? '?',
            part: el.dataset.part ?? null,
            overflowPx: Math.round(content - limit),
          });
        }
      });

      return {
        pages: sections.length,
        overflows,
        sections: sections.map((el) => el.dataset.section ?? '?'),
      };
    });

    await page.close();
    return report;
  } finally {
    if (own) await browser.close();
  }
}
