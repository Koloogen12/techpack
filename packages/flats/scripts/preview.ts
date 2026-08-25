/**
 * Предпросмотр чертежа: оба вида рядом, в HTML.
 *
 * Запуск: pnpm flats:preview [файл-спеки]
 * Нужен для чекпоинта недели 2 — решение по параметрике принимается
 * по картинке, а не по описанию (ADR-0002).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseStyleSpec } from '@specform/stylespec';
import { renderFlatsFromSpec } from '../src/index.js';

const specPath =
  process.argv[2] ??
  new URL('../../stylespec/examples/tshirt-women-46.json', import.meta.url).pathname;
const out = process.argv[3] ?? 'out/flat-preview.html';

const spec = parseStyleSpec(JSON.parse(readFileSync(specPath, 'utf8')));
const { front, back } = renderFlatsFromSpec(spec);

const html = `<!doctype html>
<meta charset="utf-8">
<title>Чертёж — ${spec.style.name}</title>
<style>
  body { margin: 0; padding: 48px; background: #F4F2EF; font-family: Sora, system-ui, sans-serif; color: #0E0E0E;
         background-image: radial-gradient(rgba(14,14,14,.075) 1px, transparent 1.2px);
         background-size: 26px 26px; background-position: 13px 13px; }
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
  .sub { color: #6B6B67; font-size: 13px; margin-bottom: 28px; }
  .sheet { background: #fff; border-radius: 14px; padding: 32px; display: flex; gap: 32px;
           box-shadow: 0 20px 48px rgba(14,14,14,.1), 0 4px 14px rgba(14,14,14,.06); }
  .view { flex: 1; text-align: center; }
  .view svg { width: 100%; height: auto; max-height: 620px; }
  .cap { font-size: 10px; letter-spacing: 1.4px; text-transform: uppercase; color: #6B6B67; margin-top: 12px; }
  table { margin-top: 28px; border-collapse: collapse; font-size: 12px; }
  td { padding: 3px 14px 3px 0; font-family: 'JetBrains Mono', monospace; color: #5A5A56; }
  td.v { color: #C0392B; }
</style>
<h1>${spec.style.name}</h1>
<div class="sub">${spec.style.article} · база RU ${spec.base.base_size_ru} · ${spec.base.fit_intent}</div>
<div class="sheet">
  <div class="view">${front.svg}<div class="cap">Перед</div></div>
  <div class="view">${back.svg}<div class="cap">Спинка</div></div>
</div>
<table>
${spec.measurements.points
  .filter((p) =>
    ['T01', 'T03', 'T05', 'T06', 'T09', 'T10', 'T12', 'T13', 'T14', 'T15'].includes(p.code),
  )
  .map((p) => `<tr><td>${p.code}</td><td>${p.name_ru}</td><td class="v">${p.base.value}</td></tr>`)
  .join('\n')}
</table>
`;

writeFileSync(out, html);
console.log(`✓ ${out}`);
console.log(`  угол рукава: ${((front.geometry.sleeveAngle * 180) / Math.PI).toFixed(1)}°`);
console.log(
  `  габарит половины: ${front.geometry.bounds.width.toFixed(1)} × ${front.geometry.bounds.height.toFixed(1)} см`,
);
