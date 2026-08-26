#!/usr/bin/env tsx
/**
 * Паттерн-студия: референсы → бесшовный раппорт.
 *
 *   pnpm pattern --refs листок.png дуги.png --brief "ботанический раппорт" \
 *                --out out/tile.png
 *
 * Тайл — не конечный продукт. Физический шаг раппорта и паспорт печати
 * назначаются уже в техпаке: там известен состав полотна и расход на тираж.
 * Здесь только рисунок и доказательство, что он стыкуется.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname } from 'node:path';
import { createLogger, isSeamsterlyError } from '@seamsterly/core';
import {
  extractColors,
  fileTileCache,
  generateTile,
  matchColors,
  separateColors,
} from '@seamsterly/pattern';
import { ArtworkLibrary, type ArtworkAsset } from '@seamsterly/library';
import { chromium } from 'playwright';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

interface Cli {
  refs: string[];
  brief: string;
  out: string;
  density?: 'sparse' | 'balanced' | 'dense';
  colors?: number;
  noMirror: boolean;
  /** Шаг раппорта, см. Нужен, чтобы посчитать разрешение и предел детали. */
  repeatCm?: number;
  /** Имя, под которым сохранить рисунок в библиотеку бренда. */
  save?: string;
}

function parseArgv(argv: readonly string[]): Cli {
  const cli: Cli = { refs: [], brief: '', out: 'out/tile.png', noMirror: false };
  let mode: 'refs' | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--refs') {
      mode = 'refs';
      continue;
    }
    if (arg === '--brief') {
      cli.brief = argv[++i] ?? '';
      mode = null;
      continue;
    }
    if (arg === '--out') {
      cli.out = argv[++i] ?? cli.out;
      mode = null;
      continue;
    }
    if (arg === '--density') {
      const v = argv[++i];
      if (v !== 'sparse' && v !== 'balanced' && v !== 'dense') {
        throw new Error('плотность: sparse, balanced или dense');
      }
      cli.density = v;
      mode = null;
      continue;
    }
    if (arg === '--colors') {
      cli.colors = Number(argv[++i]);
      mode = null;
      continue;
    }
    // Зеркальная укладка меняет рисунок, поэтому от неё можно отказаться —
    // ценой того, что бесшовного тайла может не выйти вовсе.
    if (arg === '--repeat-cm') {
      cli.repeatCm = Number(argv[++i]);
      mode = null;
      continue;
    }
    if (arg === '--save') {
      cli.save = argv[++i] ?? '';
      mode = null;
      continue;
    }
    if (arg === '--no-mirror') {
      cli.noMirror = true;
      mode = null;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`неизвестный флаг: ${arg}`);
    if (mode === 'refs') cli.refs.push(arg);
    else throw new Error(`лишний аргумент: ${arg}`);
  }

  if (cli.refs.length === 0)
    throw new Error('не указаны --refs <файлы>: раппорт строится ИЗ ваших мотивов');
  if (!cli.brief) throw new Error('не указан --brief "что нарисовать"');
  return cli;
}

async function main(): Promise<void> {
  const cli = parseArgv(process.argv.slice(2));
  const browser = await chromium.launch();

  try {
    const result = await generateTile(
      {
        brief: cli.brief,
        references: cli.refs.map((f) => ({
          bytes: readFileSync(f),
          mediaType: MIME[extname(f).toLowerCase()] ?? 'image/png',
        })),
        ...(cli.density ? { density: cli.density } : {}),
        ...(cli.colors ? { colors: cli.colors } : {}),
      },
      {
        cache: fileTileCache(),
        browser,
        logger: createLogger({ level: 'warn' }),
        ...(cli.noMirror ? { allowMirror: false } : {}),
      },
    );

    if (!result.ok) {
      console.error(`\n✗ ${result.userMessage}`);
      process.exit(1);
    }

    const t = result.tile;
    mkdirSync(dirname(cli.out), { recursive: true });
    writeFileSync(cli.out, t.bytes);

    console.log(
      `\n✓ ${cli.out}` +
        `\n  тайл:   ${t.pixels.width} × ${t.pixels.height} px` +
        `\n  стык:   ${t.seam.worst} (горизонталь ${t.seam.horizontal}, вертикаль ${t.seam.vertical})` +
        `\n          ${t.seam.seamless ? 'бесшовный — проверено попиксельно' : 'ШОВ ВИДЕН'}` +
        (t.mirrored
          ? `\n  укладка: зеркальная (блок 2×2) — модель не дала бесшовный тайл.` +
            `\n           Рисунок приобрёл симметрию, мотив занимает четверть блока.`
          : `\n  укладка: прямая`) +
        `\n  ключ:   ${t.key}` +
        (t.cached ? ' (из кэша)' : ''),
    );

    // Цветоделение: сколько сеток жечь и какие. Считается арифметикой,
    // а не моделью — печатнику нужен верный список, а не правдоподобный.
    const report = await extractColors(t.dataUri, cli.colors ?? 6, browser);
    const { matches, notes } = matchColors(report.colors);

    console.log(`\nКраски (${matches.length} — столько же сеток):`);
    for (const m of matches) {
      const share = String(Math.round(m.measured.share * 100)).padStart(3);
      const book = m.book ? `  ${m.book.code} (ΔE ${m.book.delta_e})` : '';
      console.log(`  ${m.measured.hex}  ${share}%  Lab ${m.measured.lab.join(', ')}${book}`);
    }

    const sep = await separateColors(t.dataUri, report, {
      browser,
      ...(cli.repeatCm ? { repeatCm: cli.repeatCm } : {}),
    });

    const stem = cli.out.replace(/\.[a-z]+$/i, '');
    for (const [i, s2] of sep.separations.entries()) {
      const b64 = s2.maskDataUri.slice(s2.maskDataUri.indexOf(',') + 1);
      writeFileSync(`${stem}-sep-${i + 1}.png`, Buffer.from(b64, 'base64'));
    }
    console.log(`\n  маски по краскам: ${stem}-sep-1…${sep.separations.length}.png`);

    if (sep.svg) {
      writeFileSync(`${stem}.svg`, sep.svg);
      console.log(`  вектор:           ${stem}.svg`);
    }
    console.log(`\n${sep.vector_verdict_ru}`);
    for (const n of notes) console.log(`\n${n}`);

    if (cli.save) {
      // В библиотеку уходит ПАСПОРТ, а не только картинка: шаг, краски,
      // отпечаток входа. Переносить эти поля между паками руками значит
      // однажды ошибиться в цифре и не заметить.
      const library = new ArtworkLibrary();
      const asset: ArtworkAsset = {
        id: cli.save,
        kind: 'tile',
        label_ru: cli.brief.slice(0, 80),
        file: `${cli.save}.png`,
        pixels: t.pixels,
        key: t.key,
        brief: cli.brief,
        seam: { ratio: t.seam.worst, seamless: t.seam.seamless, mirrored: t.mirrored },
        colors: matches.map((m) => ({
          hex: m.measured.hex,
          share: m.measured.share,
          ...(m.book ? { book_code: m.book.code, book_source: 'catalog' as const } : {}),
        })),
        vector_available: sep.svg !== null,
        vector_verdict_ru: sep.vector_verdict_ru,
        created_at: new Date().toISOString().slice(0, 10),
        used_in: [],
      };
      library.save(asset, t.bytes);
      console.log(
        `\n✓ сохранено в библиотеку бренда как «${cli.save}»` +
          `\n  В анкете техпака достаточно написать: ` +
          `"patterns": [{ "asset": "${cli.save}", "repeat_cm": 24 }]`,
      );
    } else {
      console.log(
        `\nДальше: укажите этот файл в анкете техпака вместе с ФИЗИЧЕСКИМ ШАГОМ ` +
          `раппорта в сантиметрах, либо сохраните рисунок в библиотеку бренда ` +
          `флагом --save <имя> — тогда паспорт не придётся переносить руками.`,
      );
    }
  } finally {
    await browser.close();
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
