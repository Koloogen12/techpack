import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { imageInfo } from './artwork.js';

/**
 * Файлы ярлыков и упаковки — макеты бренда: составник, навесной ярлык,
 * вкладыш, наклейка на пакет.
 *
 * Спецификация описывает ярлыки ДАННЫМИ: реквизиты по ТР ТС, символы ухода,
 * SKU-матрица. Но у бренда часто уже есть готовый макет ярлыка от дизайнера,
 * и фабрике нужен именно он, а не пересказ. Файлы лежат рядом с паком,
 * в документ уходят отдельным листом «макеты бренда» — по одному на карточку,
 * с именем и размером растра.
 */
export interface LabelFile {
  n: number;
  name: string;
  format: string;
  bytes: number;
  pixels?: { width: number; height: number };
  path: string;
  at: string;
}

const FILE = 'label-files.json';
export const LABEL_FILES_MAX = 12;

export function readLabelFiles(dir: string): LabelFile[] {
  try {
    const raw = JSON.parse(readFileSync(join(dir, FILE), 'utf8')) as { files?: LabelFile[] };
    return Array.isArray(raw.files) ? raw.files : [];
  } catch {
    return [];
  }
}

function write(dir: string, files: readonly LabelFile[]): void {
  writeFileSync(join(dir, FILE), JSON.stringify({ files }, null, 2));
}

function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'label';
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || 'label';
}

export function addLabelFile(
  dir: string,
  bytes: Buffer,
  originalName: string,
): { files: LabelFile[]; added: LabelFile | null; rejected: string | null } {
  const files = readLabelFiles(dir);
  if (files.length >= LABEL_FILES_MAX)
    return { files, added: null, rejected: `не больше ${LABEL_FILES_MAX} файлов ярлыков` };
  const info = imageInfo(bytes, originalName);
  if (!info || (info.format === 'pdf' && bytes.length === 0))
    return {
      files,
      added: null,
      rejected: 'Формат не разобран: нужен PNG, JPG, WebP, SVG или PDF.',
    };
  mkdirSync(join(dir, 'labels'), { recursive: true });
  const n = (files.at(-1)?.n ?? 0) + 1;
  const path = join('labels', `${n}-${safeName(originalName)}`);
  writeFileSync(join(dir, path), bytes);
  const added: LabelFile = {
    n,
    name: originalName.split(/[\\/]/).pop()?.slice(0, 120) || 'label',
    format: info.format,
    bytes: bytes.length,
    ...(info.pixels ? { pixels: info.pixels } : {}),
    path,
    at: new Date().toISOString(),
  };
  const next = [...files, added];
  write(dir, next);
  return { files: next, added, rejected: null };
}

export function removeLabelFile(dir: string, n: number): LabelFile[] {
  const files = readLabelFiles(dir);
  const hit = files.find((f) => f.n === n);
  if (hit) rmSync(join(dir, hit.path), { force: true });
  const next = files.filter((f) => f.n !== n);
  write(dir, next);
  return next;
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
};

export function labelFileBytes(
  dir: string,
  n: number,
): { bytes: Buffer; type: string; name: string } | null {
  const hit = readLabelFiles(dir).find((f) => f.n === n);
  if (!hit || !existsSync(join(dir, hit.path))) return null;
  return {
    bytes: readFileSync(join(dir, hit.path)),
    type: MIME[hit.format] ?? 'application/octet-stream',
    name: hit.name,
  };
}

/** Картинки для документа: PDF не встраивается — только имя в списке. */
export function labelFileImages(
  dir: string,
): { name: string; dataUri: string | null; note: string }[] {
  return readLabelFiles(dir).map((f) => {
    const type = MIME[f.format];
    const full = join(dir, f.path);
    const embeddable = type && type !== 'application/pdf' && existsSync(full);
    return {
      name: f.name,
      dataUri: embeddable ? `data:${type};base64,${readFileSync(full).toString('base64')}` : null,
      note:
        `${f.format.toUpperCase()}` +
        (f.pixels ? ` · ${f.pixels.width}×${f.pixels.height} px` : '') +
        ` · ${Math.max(1, Math.round(f.bytes / 1024))} КБ`,
    };
  });
}
