#!/usr/bin/env tsx
/**
 * Комплект на просчёт: один лист PDF плюс текст для мессенджера.
 *
 *   pnpm rfq --answers anketa.json --out out/rfq.pdf
 *
 * Собирается из ГОТОВОЙ спеки тем же кодом, что и техпак: лист на просчёт
 * не может разойтись с документом, потому что это его проекция, а не
 * пересказ. Пересказ разошёлся бы на первой же правке замера.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isSeamsterlyError } from '@seamsterly/core';
import { buildStyleSpec } from '@seamsterly/assembly';
import { renderRfqHtml, rfqText, RFQ_TEXT_LIMIT, type RfqOptions } from '@seamsterly/docgen';
import { chromium } from 'playwright';
import { parseAnswers, specInputFrom } from './index.js';

interface Cli {
  answers: string;
  out: string;
  replyBy?: string;
}

function parseArgv(argv: readonly string[]): Cli {
  const cli: Cli = { answers: '', out: 'out/rfq.pdf' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--answers') {
      cli.answers = argv[++i] ?? '';
      continue;
    }
    if (arg === '--out') {
      cli.out = argv[++i] ?? cli.out;
      continue;
    }
    if (arg === '--reply-by') {
      cli.replyBy = argv[++i] ?? '';
      continue;
    }
    throw new Error(`неизвестный аргумент: ${arg}`);
  }
  if (!cli.answers) throw new Error('не указан --answers <файл>');
  return cli;
}

async function main(): Promise<void> {
  const cli = parseArgv(process.argv.slice(2));
  const answers = parseAnswers(JSON.parse(readFileSync(cli.answers, 'utf8')));
  const { spec } = buildStyleSpec(specInputFrom(answers, null, { now: new Date() }));

  const brand = answers.brand_profile;
  const options: RfqOptions = {
    ...(answers.size_ratio ? { sizeRatio: answers.size_ratio } : {}),
    ...(cli.replyBy ? { replyBy: cli.replyBy } : {}),
    contact: {
      ...(brand?.company_name ? { company: brand.company_name } : {}),
      ...(brand?.contact_name ? { name: brand.contact_name } : {}),
      ...(brand?.contact_phone ? { phone: brand.contact_phone } : {}),
      ...(brand?.contact_email ? { email: brand.contact_email } : {}),
    },
  };

  const html = renderRfqHtml(spec, options);
  const text = rfqText(spec, options);

  mkdirSync(dirname(cli.out), { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    writeFileSync(cli.out, await page.pdf({ format: 'A4', printBackground: true }));
    await page.close();
  } finally {
    await browser.close();
  }

  // Текст кладём рядом файлом: его копируют и вставляют в мессенджер,
  // а не переписывают с экрана.
  const textPath = cli.out.replace(/\.pdf$/i, '.txt');
  writeFileSync(textPath, text + '\n');

  console.log(`\n✓ ${cli.out}\n  ${textPath}`);
  console.log(`\n--- текст для мессенджера (${text.length} из ${RFQ_TEXT_LIMIT} знаков) ---`);
  console.log(text);

  const hasContact = Boolean(brand?.contact_name || brand?.contact_phone || brand?.contact_email);
  if (!hasContact) {
    console.log(
      `\n⚠  Контакт не указан — фабрике некуда ответить. Добавьте contact_name, ` +
        `contact_phone или contact_email в brand_profile.`,
    );
  }
  if (!answers.size_ratio) {
    console.log(
      `\n⚠  Раскладка по размерам не задана. Фабрика считает цену по ней, а не ` +
        `по одному тиражу: расход и раскладка зависят от того, каких размеров сколько. ` +
        `Добавьте size_ratio — например {"46": 30, "48": 40, "50": 30}.`,
    );
  }
}

main().catch((e: unknown) => {
  if (isSeamsterlyError(e)) {
    console.error(`\n✗ ${e.userMessage}\n  → ${e.userAction}`);
  } else {
    console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  }
  process.exit(1);
});
