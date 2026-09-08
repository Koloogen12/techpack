import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Шрифты документа — вшиты в HTML data-URI.
 *
 * PDF печатается в Chromium внутри образа, где шрифтов бренда нет: без
 * вшивки лист выходил в DejaVu, а Sora без кириллицы отдавала русский текст
 * системной заглушке и на машине разработчика. Берутся те же файлы, что
 * у кабинета (packages/ui/fonts, OFL), подмножества latin и cyrillic —
 * китайский лист идёт системным CJK-шрифтом, как и прежде.
 *
 * Читается один раз на процесс: документов много, шрифты одни.
 */
const FONTS_CSS = fileURLToPath(new URL('../../ui/fonts.css', import.meta.url));
const FONTS_DIR = fileURLToPath(new URL('../../ui/fonts/', import.meta.url));

let cached: string | null = null;

export function docFontFaces(): string {
  if (cached !== null) return cached;
  try {
    const css = readFileSync(FONTS_CSS, 'utf8');
    cached = css
      .split('@font-face')
      .slice(1)
      .map((block) => `@font-face${block}`)
      .filter((face) => /-(latin|cyrillic)\.woff2/.test(face))
      .map((face) =>
        face.replace(/url\(["']?\.\/fonts\/([^)"']+)["']?\)/, (_m, name: string) => {
          const bytes = readFileSync(FONTS_DIR + name);
          return `url(data:font/woff2;base64,${bytes.toString('base64')})`;
        }),
      )
      .join('\n');
  } catch {
    // Без файлов шрифтов документ всё равно печатается — системным шрифтом.
    cached = '';
  }
  return cached;
}
