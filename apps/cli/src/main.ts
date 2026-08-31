#!/usr/bin/env tsx
/**
 * Станок фазы 0.
 *
 *   pnpm generate --answers a.json --photos 1.jpg 2.jpg --out out/pack.pdf
 *
 * Тот же код исполняет concierge-заказы и производит артефакты для похода
 * по фабрикам. Веб-обёртка появится поверх него после стоп-крана.
 */
import { createLogger } from '@seamster/core';
import { reportCliError } from './report-error.js';
import { EXPORT_ROLES, type ExportRole } from '@seamster/docgen';
import { LOCALES, type Locale } from '@seamster/i18n';
import { generate, type DrawingSource } from './generate.js';
import type { CandidateView } from '@seamster/templates';

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
  /** Откуда берётся чертёж: auto, library или parametric. */
  drawing: DrawingSource;
  /** Конкретный силуэт: «ask» — спросить, иначе идентификатор шаблона. */
  template?: string;
}

const DRAWING_SOURCES: readonly DrawingSource[] = ['auto', 'library', 'parametric'];

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
    drawing: 'auto',
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
    // Откуда брать чертёж. По умолчанию auto: библиотека, пока подбор
    // уверен, и наше построение, когда нет.
    //   --drawing library     всегда из библиотеки, если она что-то нашла
    //   --drawing parametric  всегда своё построение
    if (arg === '--drawing') {
      const value = argv[++i] ?? '';
      if (!DRAWING_SOURCES.includes(value as DrawingSource)) {
        throw new Error(
          `неизвестный источник чертежа: ${value}. Доступны: ${DRAWING_SOURCES.join(', ')}`,
        );
      }
      cli.drawing = value as DrawingSource;
      mode = null;
      continue;
    }
    // Конкретный силуэт из библиотеки. Сильнее --drawing.
    //   --template ask        показать кандидатов и спросить
    //   --template <id>       взять названный шаблон
    if (arg === '--template') {
      cli.template = argv[++i] ?? 'ask';
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
    drawing: cli.drawing,
    ...(cli.template ? { template: cli.template, askTemplate } : {}),
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
  reportCliError(e);
  process.exit(1);
});

/**
 * Микрошаг мастера в терминале: «какой силуэт ближе?».
 *
 * Вопрос задаётся только когда о библиотеке попросили флагом. Пустой ответ
 * оставляет параметрический чертёж — тот, что строится по табелю и несёт
 * выноски. Отказ здесь не ошибка, а осознанный выбор точности.
 */
async function askTemplate(candidates: readonly CandidateView[]): Promise<string | null> {
  console.log('\nСилуэты из библиотеки, подходящие под изделие:');
  candidates.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.id}  (${c.score})`);
    console.log(`     ${c.reasons.join(', ')}`);
    if (c.preview) console.log(`     превью: ${c.preview}`);
  });
  console.log('  0. оставить параметрический чертёж (по табелю мер, с выносками)');

  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question('Какой ближе? [0] ')).trim();
    const n = Number(answer);
    if (!answer || !Number.isInteger(n) || n < 1 || n > candidates.length) return null;
    return candidates[n - 1]!.id;
  } finally {
    rl.close();
  }
}
