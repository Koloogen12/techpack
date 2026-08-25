import { chromium, type Browser } from 'playwright';
import { SpecFormError } from '@specform/core';
import type { StyleSpec } from '@specform/stylespec';
import { renderHtml, type DocVisuals, type HtmlOptions } from './html.js';
import { roleProfile, type ExportRole } from './roles.js';

/**
 * HTML → PDF.
 *
 * Тот же браузерный движок, что рисует веб-интерфейс (ADR-0000): вёрстка
 * документа — обычный HTML и CSS, поэтому превью PDF в приложении достаётся
 * бесплатно, а не пишется вторым рендерером.
 */

export interface PdfOptions extends HtmlOptions {
  /** Переиспользуемый браузер. Запуск занимает секунды — держим один на пакет. */
  browser?: Browser;
}

export async function renderPdf(spec: StyleSpec, options: PdfOptions = {}): Promise<Buffer> {
  const html = renderHtml(spec, options);
  const own = options.browser === undefined;
  let browser: Browser;

  try {
    browser = options.browser ?? (await chromium.launch());
  } catch (cause) {
    throw new SpecFormError('RENDER_FAILED', 'не удалось запустить браузер для печати PDF', {
      userMessage: 'Не удалось собрать документ.',
      userAction: 'Повторить бесплатно. Если повторяется — напишите нам, это на нашей стороне.',
      cause,
    });
  }

  try {
    const page = await browser.newPage();
    // Шрифты подключаются локально в проде; здесь важна геометрия страницы,
    // а не гарнитура, поэтому ждём только загрузку разметки.
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const pdf = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    await page.close();
    return pdf;
  } catch (cause) {
    throw new SpecFormError('RENDER_FAILED', 'ошибка печати PDF', {
      userMessage: 'Не удалось собрать документ.',
      userAction: 'Повторить бесплатно. Если повторяется — напишите нам.',
      cause,
    });
  } finally {
    if (own) await browser.close();
  }
}

/** Выгрузка по ролям цеха: у каждого адресата свой файл (knowledge-base/07 §6.6). */
export async function renderRolePdfs(
  spec: StyleSpec,
  roles: readonly ExportRole[],
  browser?: Browser,
  visuals?: DocVisuals,
): Promise<{ role: ExportRole; label_ru: string; pdf: Buffer }[]> {
  const own = browser === undefined;
  const shared = browser ?? (await chromium.launch());

  try {
    const out: { role: ExportRole; label_ru: string; pdf: Buffer }[] = [];
    for (const role of roles) {
      const profile = roleProfile(role);
      out.push({
        role,
        label_ru: profile.label_ru,
        pdf: await renderPdf(spec, {
          browser: shared,
          sections: profile.sections,
          pro: profile.pro,
          roleLabel: profile.label_ru,
          ...(visuals ? { visuals } : {}),
        }),
      });
    }
    return out;
  } finally {
    if (own) await shared.close();
  }
}
