#!/usr/bin/env tsx
/**
 * Приёмочная сетка: наш чертёж рядом с эталонными техпаками.
 *
 *   pnpm flats:grid
 *
 * Приёмка бенчмарка формы звучит так: «наш флэт в сетке с пятью референсами
 * неотличим по конвенциям». Числовую часть проверяет тест пропорций, а
 * пластику — глаз, и для него нужна именно сетка: на одном листе, в одном
 * масштабе, вперемешку с эталонами.
 *
 * Файлы эталонов кладёт СЕО в kb/benchmarks/hoodie-flats/. Пока их там нет,
 * страница честно показывает пустые рамки с именами — чтобы было видно,
 * чего не хватает, а не казалось, что сравнение уже сделано.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { buildStyleSpec, type StyleSpecInput } from '@seamster/assembly';
import { kb } from '@seamster/kb';
import { flatDefaults, renderFlatsFromSpec } from '../src/index.js';

const REF_DIR = 'kb/benchmarks/hoodie-flats';
const IMAGES = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif']);
const base = kb();

const ours = (['oversize', 'semi_fitted'] as const).map((fit) => {
  const spec = buildStyleSpec({
    id: 'grid',
    name: 'Худи',
    article: 'GRID-1',
    category: 'hoodie',
    gender: 'women',
    base_size_ru: 46,
    base_height_cm: 170,
    fit_intent: fit,
    fabric_kind: 'knit',
    size_range: [46],
    generated_at: new Date('2026-01-01'),
  } as unknown as StyleSpecInput).spec;
  const flats = renderFlatsFromSpec(spec, flatDefaults(spec, base));
  const angle = base.sleeveAngle(70, fit);
  return {
    title: fit === 'oversize' ? 'НАШ · oversize' : 'НАШ · регулярная',
    note: `конвенция ${angle.min_angle_deg}–${angle.max_angle_deg}°`,
    body: `<div class="pair">${flats.front.svg}${flats.back.svg}</div>`,
  };
});

const refs = existsSync(REF_DIR)
  ? readdirSync(REF_DIR)
      .filter((f) => IMAGES.has(extname(f).toLowerCase()))
      .sort()
      .map((f) => ({
        title: f.replace(extname(f), ''),
        note: 'эталон',
        body: `<img src="data:image/${extname(f).slice(1)};base64,${readFileSync(
          join(REF_DIR, f),
        ).toString('base64')}" alt="${f}">`,
      }))
  : [];

const missing = refs.length === 0;
const cards = [...ours, ...refs]
  .map(
    (c) =>
      `<figure><figcaption><b>${c.title}</b><span>${c.note}</span></figcaption>${c.body}</figure>`,
  )
  .join('');

mkdirSync('out', { recursive: true });
writeFileSync(
  'out/reference-grid.html',
  `<!doctype html><meta charset="utf-8"><title>Сетка сравнения с эталонами</title>
<style>
 body{margin:0;background:#F4F2EF;font:14px/1.5 Sora,system-ui,sans-serif;color:#0E0E0E}
 h1{font:700 20px Sora,sans-serif;margin:20px 20px 4px}
 .lead{margin:0 20px 16px;color:#5A5A56;max-width:860px}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;padding:0 20px 24px}
 figure{margin:0;background:#fff;border:1px solid #E4E1DC;border-radius:12px;padding:14px}
 figcaption{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px}
 figcaption span{font-size:11px;color:#6B6B67}
 .pair{display:flex;gap:12px;align-items:flex-start}
 .pair svg{width:50%;height:auto}
 img{width:100%;height:auto;display:block}
 .warn{margin:0 20px 16px;padding:12px 14px;border-radius:10px;background:rgba(192,57,43,.06);
   border:1px solid rgba(192,57,43,.25);color:#C0392B;max-width:860px}
</style>
<h1>Сетка сравнения с эталонами</h1>
<p class="lead">Наш чертёж и реальные техпаки на одном листе. Смотреть на конвенции, а не на
 обводку: угол рукава, выпуклость его внешней линии, переход плеча, посадку капюшона,
 ширину низа относительно груди, массивность рибан.</p>
${
  missing
    ? `<p class="warn">Файлов эталонов в <code>${REF_DIR}</code> нет — сравнивать не с чем.
       Положите туда изображения листов (png/jpg/webp), и они появятся в сетке рядом
       с нашими. Числовую часть конвенций тест проверяет и без них.</p>`
    : ''
}
<div class="grid">${cards}</div>`,
);
console.log(
  missing
    ? `сетка собрана: наши чертежи есть, эталонов в ${REF_DIR} нет`
    : `сетка собрана: наших ${ours.length}, эталонов ${refs.length}`,
);
