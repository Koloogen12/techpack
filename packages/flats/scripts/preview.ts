/**
 * Предпросмотр чертежей всех категорий трикотажного ядра.
 * Запуск: pnpm flats:preview
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildStyleSpec } from '@seamsterly/assembly';
import type { Category } from '@seamsterly/kb';
import { flatDefaults, renderFlatsFromSpec } from '../src/index.js';

const CATEGORIES: Category[] = (process.env.FLATS_ONLY?.split(',') as Category[]) ?? [
  'tshirt',
  'longsleeve',
  'sweatshirt',
  'hoodie',
];
const LABEL: Record<Category, string> = {
  tshirt: 'Футболка',
  longsleeve: 'Лонгслив',
  sweatshirt: 'Свитшот',
  hoodie: 'Худи',
};

const blocks = CATEGORIES.map((category) => {
  const { spec } = buildStyleSpec({
    id: `preview-${category}`,
    name: LABEL[category],
    article: `PRV-${category}`,
    category,
    gender: 'women',
    base_size_ru: 46,
    base_height_cm: 170,
    fit_intent: 'semi_fitted',
    fabric_kind: 'knit',
    size_range: [42, 44, 46, 48, 50, 52],
    generated_at: new Date('2026-08-25T00:00:00.000Z'),
  });
  // Величины, которых нет в табеле мер, собираются одним вызовом:
  // глубина для бока и минимальный угол отведения рукава.
  const side = flatDefaults(spec);
  const flats = renderFlatsFromSpec(spec, side);
  // Колонки пропорциональны ширинам видов в сантиметрах: все виды в одном масштабе.
  const view = (r: { svg: string; viewBox: { width: number } }, cap: string): string =>
    `<div class="view" style="flex:${r.viewBox.width}">${r.svg}<div class="cap">${cap}</div></div>`;
  return `<section>
  <h2>${LABEL[category]}${flats.side ? ` · глубина ${side.depthCm!.toFixed(1)} см` : ''}</h2>
  <div class="sheet">
    ${view(flats.front, 'Перед')}
    ${view(flats.back, 'Спинка')}
    ${flats.side ? view(flats.side, 'Бок') : ''}
  </div>
</section>`;
}).join('\n');

mkdirSync('out', { recursive: true });
writeFileSync(
  'out/flat-preview.html',
  `<!doctype html><meta charset="utf-8"><title>Чертежи трикотажного ядра</title>
<style>
 body { margin:0; padding:40px; background:#F4F2EF; color:#0E0E0E;
        font-family: Sora, system-ui, sans-serif;
        background-image: radial-gradient(rgba(14,14,14,.075) 1px, transparent 1.2px);
        background-size:26px 26px; background-position:13px 13px; }
 h2 { font-size:15px; font-weight:700; margin:0 0 12px; }
 section { margin-bottom:36px; }
 .sheet { background:#fff; border-radius:14px; padding:26px; display:flex; gap:26px;
          box-shadow:0 20px 48px rgba(14,14,14,.1), 0 4px 14px rgba(14,14,14,.06); }
 .view { flex:1; text-align:center; }
 .view svg { width:100%; height:auto; max-height:640px; }
 .cap { font-size:9px; letter-spacing:1.4px; text-transform:uppercase; color:#6B6B67; margin-top:10px; }
</style>
${blocks}`,
);
console.log('✓ out/flat-preview.html — 4 категории');
