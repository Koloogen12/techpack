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
import { createLogger, isSpecFormError } from '@specform/core';
import { fileTileCache, generateTile } from '@specform/pattern';
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

    console.log(
      `\nДальше: укажите этот файл в анкете техпака вместе с ФИЗИЧЕСКИМ ШАГОМ ` +
        `раппорта в сантиметрах. Без шага тайл можно напечатать в любом масштабе, ` +
        `и мотив выйдет хоть с ладонь, хоть с монету.`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((e: unknown) => {
  if (isSpecFormError(e)) {
    console.error(`\n✗ ${e.userMessage}\n  → ${e.userAction}`);
  } else {
    console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  }
  process.exit(1);
});
