#!/usr/bin/env tsx
/**
 * Станок фазы 0.
 *
 *   pnpm generate --answers a.json --photos 1.jpg 2.jpg --out out/pack.pdf
 *
 * Тот же код исполняет concierge-заказы и производит артефакты для похода
 * по фабрикам. Веб-обёртка появится поверх него после стоп-крана.
 */
import { createLogger, isSeamsterlyError } from '@seamsterly/core';
import { EXPORT_ROLES, type ExportRole } from '@seamsterly/docgen';
import { LOCALES, type Locale } from '@seamsterly/i18n';
import { generate } from './generate.js';

interface Cli {
  answers: string;
  photos: string[];
  out: string;
  roles: ExportRole[];
  spec: boolean;
  quiet: boolean;
  render: boolean;
  /** Где лежит файл раппорта. По умолчанию библиотека бренда. */
  tileDir?: string;
  versionsDir?: string;
  langs: Locale[];
}

function parseArgv(argv: readonly string[]): Cli {
  const cli: Cli = {
    answers: '',
    photos: [],
    out: 'out/pack.pdf',
    roles: [],
    langs: [],
    spec: false,
    quiet: false,
    render: false,
  };
  let mode: 'photos' | 'roles' | 'langs' | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--answers') {
      cli.answers = argv[++i] ?? '';
      mode = null;
      continue;
    }
    if (arg === '--out') {
      cli.out = argv[++i] ?? cli.out;
      mode = null;
      continue;
    }
    if (arg === '--photos') {
      mode = 'photos';
      continue;
    }
    if (arg === '--roles') {
      mode = 'roles';
      continue;
    }
    if (arg === '--spec') {
      cli.spec = true;
      mode = null;
      continue;
    }
    if (arg === '--quiet') {
      cli.quiet = true;
      mode = null;
      continue;
    }
    // История версий ведётся только по явной просьбе: концьерж часто
    // пересобирает документ на ходу, и каждая пересборка не должна
    // превращаться в новую версию для фабрики.
    // Нерусский комплект — ФАБРИЧНЫЙ и уходит отдельным файлом. Смешивать
    // языки в одном PDF нельзя: фабрика печатает его и раскладывает по цеху,
    // и лист на чужом языке в этой пачке просто не прочтут.
    if (arg === '--lang') {
      mode = 'langs';
      continue;
    }
    if (arg === '--versions') {
      cli.versionsDir = argv[++i] ?? 'versions';
      mode = null;
      continue;
    }
    if (arg === '--tile-dir') {
      cli.tileDir = argv[++i] ?? '';
      mode = null;
      continue;
    }
    // Визуализация — платный внешний вызов, поэтому только по явному флагу.
    // Без него страница внешнего вида всё равно соберётся, если картинка
    // уже лежит в кэше или если приложены снимки заказчика.
    if (arg === '--render') {
      cli.render = true;
      mode = null;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`неизвестный флаг: ${arg}`);
    if (mode === 'photos') cli.photos.push(arg);
    else if (mode === 'langs') {
      if (!LOCALES.includes(arg as Locale)) {
        throw new Error(`неизвестный язык: ${arg}. Доступны: ${LOCALES.join(', ')}`);
      }
      cli.langs.push(arg as Locale);
    } else if (mode === 'roles') {
      if (!EXPORT_ROLES.includes(arg as ExportRole)) {
        throw new Error(`неизвестная роль: ${arg}. Доступны: ${EXPORT_ROLES.join(', ')}`);
      }
      cli.roles.push(arg as ExportRole);
    } else throw new Error(`лишний аргумент: ${arg}`);
  }

  if (!cli.answers) throw new Error('не указан --answers <файл>');
  return cli;
}

async function main(): Promise<void> {
  const cli = parseArgv(process.argv.slice(2));
  const started = Date.now();

  const result = await generate({
    answersPath: cli.answers,
    photoPaths: cli.photos,
    outPath: cli.out,
    roles: cli.roles,
    writeSpec: cli.spec,
    render: cli.render,
    ...(cli.tileDir ? { tileDir: cli.tileDir } : {}),
    ...(cli.versionsDir ? { versionsDir: cli.versionsDir } : {}),
    langs: cli.langs,
    logger: createLogger({ level: cli.quiet ? 'error' : 'warn' }),
  });

  const { spec, cost } = result;
  console.log(`\n✓ ${result.pdfPath}`);
  for (const l of result.langPaths) console.log(`  ${l.path}`);
  for (const r of result.rolePaths) console.log(`  ${r.path}`);
  if (result.specPath) console.log(`  ${result.specPath}`);

  console.log(
    `\n${spec.style.name} · ${spec.style.article}` +
      `\n  замеров:      ${spec.measurements.points.length}` +
      `\n  узлов:        ${spec.construction?.nodes.length ?? 0}` +
      `\n  материалов:   ${spec.bom?.lines.length ?? 0}` +
      `\n  артикулов:    ${spec.labels?.sku_matrix.length ?? 0}` +
      `\n  предположений:${String(spec.meta.assumptions_count).padStart(3)}`,
  );

  if (result.vision.used) {
    console.log(
      `\nРазбор фото: ${result.vision.fromCache ? 'из кэша, обращения к API не было' : 'вызов API'}` +
        `\n  ключ: ${result.vision.cacheKey}`,
    );
  }

  if (result.visual.used) {
    console.log(
      `\nВизуализация: ${result.visual.fromCache ? 'из кэша, обращения к сервису не было' : 'вызов сервиса'}`,
    );
  } else if (cli.render) {
    console.log('\nВизуализация: не получилась, документ собран без неё');
  }

  if (result.notes.length) {
    console.log('\nЧто стоит знать:');
    for (const n of result.notes) console.log(`  · ${n}`);
  }

  console.log(
    `\nСебестоимость: $${cost.usd.toFixed(4)} · пайплайн ${(cost.ms / 1000).toFixed(1)} c ` +
      `· всего ${((Date.now() - started) / 1000).toFixed(1)} c`,
  );
  for (const s of cost.stages) {
    console.log(`  ${s.stage.padEnd(10)} $${s.usd.toFixed(4)}  ${(s.ms / 1000).toFixed(1)} c`);
  }
  // Тариф генерации изображений считает сторонний сервис, у нас его цены нет.
  // Показать $0.0000 и промолчать значит занизить COGS и не заметить этого.
  if (result.visual.used && !result.visual.fromCache) {
    console.log('  ↑ стоимость визуализации в сумму не входит: тариф стороннего сервиса');
  }
  console.log(`\nОтпечаток спеки: ${result.fingerprint}`);
}

main().catch((e: unknown) => {
  if (isSeamsterlyError(e)) {
    console.error(`\n✗ ${e.userMessage}\n  → ${e.userAction}\n  (${e.code})`);
    if (typeof e.details.issues === 'string') console.error(e.details.issues);
  } else {
    console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  }
  process.exit(1);
});
