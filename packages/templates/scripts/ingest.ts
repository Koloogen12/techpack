#!/usr/bin/env tsx
/**
 * Приём покупного датасета силуэтов в библиотеку шаблонов.
 *
 *   pnpm templates:ingest "<путь к каталогу датасета>"
 *
 * Датасет нарисован как мокап для маркетплейса: перед и спинка на одном
 * листе, детали залиты серым, подкладка капюшона чёрная, превью — PNG
 * 6000×6000. Документу нужно другое: два отдельных вида контуром и лёгкое
 * превью, по которому модель может опознать изделие. Разница между этими
 * двумя вещами и есть весь скрипт.
 *
 * Идемпотентен: повторный запуск переписывает результат из исходников.
 * Ничего не удаляет за пределами каталога назначения.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeTemplate } from '../src/normalize.js';
import { boxHeight, boxWidth } from '../src/svg.js';

const OUT_DIR = 'packages/kb/data/templates';
const PREVIEW_DIR = join(OUT_DIR, 'preview');
/** Ширина превью для каталогизации моделью: 6000 px ей не нужны, а стоят денег. */
const PREVIEW_PX = 768;

/**
 * Каталоги датасета к нашим категориям.
 *
 * Одна папка датасета может кормить несколько наших категорий (в «Hoodies»
 * лежат и пуловеры, и на молнии) — точную категорию определяет
 * каталогизация по превью. Здесь только грубая группа, чтобы разложить
 * файлы и не смешивать низ с верхом.
 */
const GROUPS: Record<string, string> = {
  'T-Shirts': 'tshirt_family',
  Hoodies: 'hoodie_family',
  'Tops & Sweaters': 'top_family',
  Outerwears: 'outerwear_family',
  Bottoms: 'bottom_family',
  'Headwear & Accessories': 'accessory_family',
};

interface Entry {
  id: string;
  group: string;
  source_file: string;
  svg_front: string;
  svg_back: string | null;
  preview: string | null;
  /** Габарит переднего вида в единицах его viewBox — им масштабируется чертёж. */
  aspect: number;
  paths_front: number;
  paths_back: number;
  notes: string[];
  /** Переносится с прошлого приёма: получено из превью, а не из вектора. */
  traits?: unknown;
  promotion_score?: number;
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function makePreview(src: string, dest: string): boolean {
  try {
    execFileSync(
      'sips',
      ['-Z', String(PREVIEW_PX), '-s', 'format', 'png', src, '--out', dest],
      { stdio: 'ignore' },
    );
    return existsSync(dest);
  } catch {
    return false;
  }
}

function main(): void {
  const root = process.argv[2];
  if (!root || !existsSync(root)) {
    console.error('укажите каталог датасета: pnpm templates:ingest "<путь>"');
    process.exit(1);
  }

  const single = join(root, 'Single');
  if (!existsSync(single)) {
    console.error(`в датасете нет каталога Single: ${single}`);
    process.exit(1);
  }

  mkdirSync(PREVIEW_DIR, { recursive: true });

  // Разметка переживает повторный приём.
  //
  // Признаки шаблона получены из ПРЕВЬЮ, а превью делается из того же
  // исходника датасета — значит правка конвейера векторов их не отменяет.
  // Терять здесь разметку значило бы платить за каталогизацию заново при
  // каждой починке разбора путей.
  const manifestPath = join(OUT_DIR, 'template_manifest.json');
  const known = new Map<string, { traits?: unknown; promotion_score?: number }>();
  if (existsSync(manifestPath)) {
    try {
      const prev = JSON.parse(readFileSync(manifestPath, 'utf8')) as { entries?: Entry[] };
      for (const e of prev.entries ?? []) {
        const carry: { traits?: unknown; promotion_score?: number } = {};
        if ((e as { traits?: unknown }).traits) carry.traits = (e as { traits?: unknown }).traits;
        const score = (e as { promotion_score?: number }).promotion_score;
        if (score) carry.promotion_score = score;
        if (Object.keys(carry).length) known.set(e.id, carry);
      }
    } catch {
      // Битый манифест — не повод отказаться от приёма: он всё равно
      // пересобирается целиком, а разметку восстановит кэш каталогизации.
    }
  }

  const entries: Entry[] = [];
  let skipped = 0;

  for (const folder of readdirSync(single)) {
    const group = GROUPS[folder];
    if (!group) {
      console.log(`пропущена папка «${folder}»: не сопоставлена ни одной группе`);
      continue;
    }
    const svgDir = join(single, folder, 'SVG');
    const pngDir = join(single, folder, 'PNG');
    if (!existsSync(svgDir)) continue;

    const targetDir = join(OUT_DIR, group);
    // Каталог группы пересобирается целиком: иначе переименованный в датасете
    // файл оставил бы за собой сироту, на которую ссылается манифест.
    rmSync(targetDir, { recursive: true, force: true });
    mkdirSync(targetDir, { recursive: true });

    for (const file of readdirSync(svgDir).sort()) {
      if (extname(file).toLowerCase() !== '.svg') continue;
      const id = `${group}-${slug(basename(file))}`;
      let result;
      try {
        result = normalizeTemplate(readFileSync(join(svgDir, file), 'utf8'));
      } catch (error) {
        skipped++;
        console.log(`пропущен ${file}: ${String(error).slice(0, 80)}`);
        continue;
      }

      const frontPath = join(targetDir, `${id}-front.svg`);
      writeFileSync(frontPath, result.front.svg);
      let backPath: string | null = null;
      if (result.back) {
        backPath = join(targetDir, `${id}-back.svg`);
        writeFileSync(backPath, result.back.svg);
      }

      // Превью берётся из датасета, а не рендерится нами: там оно уже
      // выверено художником, и модели показывать надо именно его.
      let preview: string | null = null;
      const pngName = `${basename(file, extname(file))}.png`;
      const pngSrc = join(pngDir, pngName);
      if (existsSync(pngSrc)) {
        const dest = join(PREVIEW_DIR, `${id}.png`);
        if (makePreview(pngSrc, dest)) preview = dest;
      }

      entries.push({
        ...known.get(id),
        id,
        group,
        source_file: `${folder}/SVG/${file}`,
        svg_front: frontPath,
        svg_back: backPath,
        preview,
        aspect: Number((boxWidth(result.front.box) / boxHeight(result.front.box)).toFixed(4)),
        paths_front: result.front.paths,
        paths_back: result.back?.paths ?? 0,
        notes: result.notes,
      });
    }
  }

  const manifest = {
    id: 'template_library',
    version: '0.1.0',
    description:
      'Библиотека силуэтов, принятая из покупного датасета. Каждый шаблон — два вида ' +
      'контуром и лёгкое превью. Категория, посадка и детали проставляются отдельным ' +
      'шагом каталогизации по превью; здесь только то, что видно из самих файлов.',
    source: 'S.i. Graphics — Clothing Mockups Mega Bundle Vol. 1 (лицензия у СЕО)',
    ingested_entries: entries.length,
    entries,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const withBack = entries.filter((e) => e.svg_back).length;
  const withPreview = entries.filter((e) => e.preview).length;
  const carried = entries.filter((e) => known.has(e.id)).length;
  if (carried) console.log(`разметка перенесена: ${carried}`);
  console.log(
    `принято ${entries.length} шаблонов · со спинкой ${withBack} · с превью ${withPreview} · ` +
      `пропущено ${skipped}`,
  );
  const digest = createHash('sha256')
    .update(entries.map((e) => e.id).join('\n'))
    .digest('hex')
    .slice(0, 12);
  console.log(`отпечаток набора: ${digest}`);
}

main();
