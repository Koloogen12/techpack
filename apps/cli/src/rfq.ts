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
import { reportCliError } from './report-error.js';
import { dirname } from 'node:path';
import { buildStyleSpec } from '@seamsterly/assembly';
import { renderRfqPdf, rfqText, RFQ_TEXT_LIMIT, type RfqOptions } from '@seamsterly/docgen';
import { LOCALES, type Locale } from '@seamsterly/i18n';
import { parseAnswers, specInputFrom } from './index.js';

interface Cli {
  answers: string;
  out: string;
  replyBy?: string;
  /** Языки листа: русский всегда, остальные — по просьбе. */
  langs: Locale[];
}

function parseArgv(argv: readonly string[]): Cli {
  const cli: Cli = { answers: '', out: 'out/rfq.pdf', langs: [] };
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
    if (arg === '--lang') {
      const value = argv[++i] ?? '';
      if (!LOCALES.includes(value as Locale)) {
        throw new Error(`неизвестный язык: ${value}. Доступны: ${LOCALES.join(', ')}`);
      }
      cli.langs.push(value as Locale);
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

  mkdirSync(dirname(cli.out), { recursive: true });
  const text = rfqText(spec, options);
  writeFileSync(cli.out, await renderRfqPdf(spec, options));

  // Фабричный лист на другом языке — ОТДЕЛЬНЫЙ файл, как и техпак: лист
  // отправляют одной фабрике, и чужой язык в нём только мешает.
  const extra: string[] = [];
  for (const locale of new Set(cli.langs)) {
    if (locale === 'ru') continue;
    const path = cli.out.replace(/\.pdf$/i, `--${locale}.pdf`);
    const localized = { ...options, locale };
    writeFileSync(path, await renderRfqPdf(spec, localized));
    writeFileSync(path.replace(/\.pdf$/i, '.txt'), rfqText(spec, localized) + '\n');
    extra.push(path);
  }

  // Текст кладём рядом файлом: его копируют и вставляют в мессенджер,
  // а не переписывают с экрана.
  const textPath = cli.out.replace(/\.pdf$/i, '.txt');
  writeFileSync(textPath, text + '\n');

  console.log(`\n✓ ${cli.out}\n  ${textPath}`);
  for (const path of extra) console.log(`  ${path}`);
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
  reportCliError(e);
  process.exit(1);
});
