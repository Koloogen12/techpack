#!/usr/bin/env tsx
/**
 * Печать бланка замеров.
 *
 *   pnpm fit:form --category hoodie --out out/бланк-худи.pdf [--required]
 *
 * Бланк идёт в руки тому, кто мерит вещь рулеткой. Точки на нём стоят
 * в порядке ИЗМЕРЕНИЯ, а не в порядке кодов: вещь берут в руки один раз.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';
import { isSeamsterlyError } from '@seamsterly/core';
import { CATEGORIES, type Category } from '@seamsterly/kb';
import { renderMeasurementForm } from '@seamsterly/fit';

interface Cli {
  category: Category;
  out: string;
  requiredOnly: boolean;
  title?: string;
}

function parseArgv(argv: readonly string[]): Cli {
  let category: string | undefined;
  let out = 'out/measurement-form.pdf';
  let requiredOnly = false;
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
  return { category: category as Category, out, requiredOnly, ...(title ? { title } : {}) };
}

async function main(): Promise<void> {
  const cli = parseArgv(process.argv.slice(2));
  const html = renderMeasurementForm({
    category: cli.category,
    requiredOnly: cli.requiredOnly,
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
  if (isSeamsterlyError(e)) {
    console.error(`\n✗ ${e.userMessage}\n  → ${e.userAction}`);
  } else {
    console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  }
  process.exit(1);
});
