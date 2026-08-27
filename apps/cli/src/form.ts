#!/usr/bin/env tsx
/**
 * Печать бланка замеров.
 *
 *   pnpm fit:form --category hoodie --out out/бланк-худи.pdf [--required] [--lang zh]
 *
 * Бланк идёт в руки тому, кто мерит вещь рулеткой. Точки на нём стоят
 * в порядке ИЗМЕРЕНИЯ, а не в порядке кодов: вещь берут в руки один раз.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { reportCliError } from './report-error.js';
import { dirname } from 'node:path';
import { chromium } from 'playwright';
import { CATEGORIES, type Category } from '@seamsterly/kb';
import { renderMeasurementForm } from '@seamsterly/fit';
import { LOCALES, type Locale } from '@seamsterly/i18n';

interface Cli {
  category: Category;
  out: string;
  requiredOnly: boolean;
  locale: Locale;
  title?: string;
}

function parseArgv(argv: readonly string[]): Cli {
  let category: string | undefined;
  let out = 'out/measurement-form.pdf';
  let requiredOnly = false;
  let locale: Locale = 'ru';
  let title: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--category') {
      category = argv[++i];
      continue;
    }
    if (arg === '--out') {
      out = argv[++i] ?? out;
      continue;
    }
    if (arg === '--lang') {
      const value = argv[++i];
      if (!LOCALES.includes(value as Locale)) {
        throw new Error(`неизвестный язык: ${value}. Доступны: ${LOCALES.join(', ')}`);
      }
      locale = value as Locale;
      continue;
    }
    if (arg === '--title') {
      title = argv[++i];
      continue;
    }
    if (arg === '--required') {
      requiredOnly = true;
      continue;
    }
    throw new Error(`неизвестный аргумент: ${arg}`);
  }

  if (!category) throw new Error(`не указан --category. Доступны: ${CATEGORIES.join(', ')}`);
  if (!CATEGORIES.includes(category as Category)) {
    throw new Error(`неизвестная категория: ${category}. Доступны: ${CATEGORIES.join(', ')}`);
  }
  return {
    category: category as Category,
    out,
    requiredOnly,
    locale,
    ...(title ? { title } : {}),
  };
}

async function main(): Promise<void> {
  const cli = parseArgv(process.argv.slice(2));
  const html = renderMeasurementForm({
    category: cli.category,
    requiredOnly: cli.requiredOnly,
    locale: cli.locale,
    ...(cli.title ? { title: cli.title } : {}),
  });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    mkdirSync(dirname(cli.out), { recursive: true });
    writeFileSync(
      cli.out,
      await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      }),
    );
    await page.close();
  } finally {
    await browser.close();
  }

  console.log(`\n✓ ${cli.out}`);
  console.log(`  Распечатайте, померьте вещь и сфотографируйте её же сверху на том же столе.`);
  console.log(`  Дальше — docs/RULER-PROTOCOL.md, шаг 3.`);
}

main().catch((e: unknown) => {
  reportCliError(e);
  process.exit(1);
});
