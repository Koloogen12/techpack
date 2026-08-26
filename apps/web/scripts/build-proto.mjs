#!/usr/bin/env node
/**
 * Сборка кабинета из прототипа хендоффа.
 *
 * Разметка берётся из design_handoff_seamsterly/SpecForm - Воркспейс.dc.html
 * БАЙТ-В-БАЙТ и исполняется рантаймом прототипа (support.js). Никакого
 * пересказа вёрстки: единственные правки — подстановка биндингов в места,
 * где прототип нёс демо-данные текстом (имя пака, артикул, e-mail), и
 * ребрендинг SPECFORM → SEAMSTERLY, разрешённый хендоффом (README, D8).
 *
 * Каждая замена обязана примениться ровно столько раз, сколько заявлено, —
 * иначе сборка падает: молча разъехаться с прототипом нельзя.
 */
import { createRequire } from 'node:module';
import { copyFileSync, cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..');
const repoRoot = join(webRoot, '..', '..');
const handoff = join(repoRoot, 'design_handoff_seamsterly');
const dist = join(webRoot, 'dist');
const require = createRequire(import.meta.url);

// Имя файла с кириллицей: macOS отдаёт его в NFD, Linux хранит как принёс
// rsync — ищем по нормализованной форме, а не по байтам.
const protoName = readdirSync(handoff).find(
  (f) => f.normalize('NFC') === 'SpecForm - Воркспейс.dc.html'.normalize('NFC'),
);
if (!protoName) throw new Error('в хендоффе не найден SpecForm - Воркспейс.dc.html');
const src = readFileSync(join(handoff, protoName), 'utf8');

// ------------------------------------------------------------------ шаблон

const open = src.indexOf('<x-dc>');
const close = src.lastIndexOf('</x-dc>');
if (open < 0 || close < 0) throw new Error('в прототипе не найден блок <x-dc>');
let tpl = src.slice(open + '<x-dc>'.length, close);

let replaced = 0;
const sub = (from, to, times) => {
  const parts = tpl.split(from);
  const n = parts.length - 1;
  if (n !== times) {
    throw new Error(`замена «${from.slice(0, 70)}…»: ожидалось ${times}, нашлось ${n}`);
  }
  tpl = parts.join(to);
  replaced += n;
};

// Ребрендинг — единственная разрешённая правка текста (хендофф, D8).
sub('SPECFORM OS', 'SEAMSTERLY', 2);
sub('SPECFORM · 498BA296', 'SEAMSTERLY · {{ artShort }}', 1);

// Данные, зашитые в разметку текстом, становятся биндингами — сама разметка
// (теги, стили, порядок) не меняется ни на символ.
sub('danilkochneff652@gmail.com', '{{ userEmail }}', 2);
sub('specform.pro/p/498BA296-123E', '{{ shareLink }}', 2);
sub(
  '<span style="font:700 16.6px/23px Sora,sans-serif">Структурный жакет</span>',
  '<span style="font:700 16.6px/23px Sora,sans-serif">{{ docName }}</span>',
  1,
);
sub('Артикул 498BA296–123E', 'Артикул {{ docArt }}', 1);
sub('Обновлён 16 июл, 07:10', 'Обновлён {{ docUpdated }}', 1);
sub('>Структурный жакет · v1.0</div>', '>{{ docName }} · v1.0</div>', 1);
sub(
  '<span style="font-family:\'JetBrains Mono\',monospace">498BA296-123E</span>',
  '<span style="font-family:\'JetBrains Mono\',monospace">{{ docArt }}</span>',
  1,
);
sub(
  '>Бренд</span><span style="font:300 12px/18px Inter,sans-serif;color:#B0ADA6">не указан</span>',
  '>Бренд</span><span style="{{ coverBrandStyle }}">{{ coverBrand }}</span>',
  1,
);
sub(
  '>Артикул</span><span style="font:300 12px/18px Inter,sans-serif;color:#C0392B">498BA296</span>',
  '>Артикул</span><span style="font:300 12px/18px Inter,sans-serif;color:#C0392B">{{ artShort }}</span>',
  1,
);
sub(
  '>Ткань</span><span style="font:300 12px/18px Inter,sans-serif;color:#C0392B">Рибана 2×2</span>',
  '>Ткань</span><span style="font:300 12px/18px Inter,sans-serif;color:#C0392B">{{ coverFabric }}</span>',
  1,
);
sub(
  '>Дата</span><span style="font:300 12px/18px Inter,sans-serif;color:#C0392B">2026-07-16</span>',
  '>Дата</span><span style="font:300 12px/18px Inter,sans-serif;color:#C0392B">{{ coverDate }}</span>',
  1,
);
sub(
  '>Сезон</span><span style="font:300 12px/18px Inter,sans-serif;color:#B0ADA6">не указан</span>',
  '>Сезон</span><span style="{{ coverSeasonStyle }}">{{ coverSeason }}</span>',
  1,
);
sub(
  '>Размер</span><span style="font:300 12px/18px Inter,sans-serif;color:#C0392B">RU 46 / M</span>',
  '>Размер</span><span style="font:300 12px/18px Inter,sans-serif;color:#C0392B">{{ coverSize }}</span>',
  1,
);
sub(
  '<span style="font:400 6.5px/9px \'JetBrains Mono\',monospace;color:#5A5A56">498BA296</span>',
  '<span style="font:400 6.5px/9px \'JetBrains Mono\',monospace;color:#5A5A56">{{ artShort }}</span>',
  1,
);

// Вид фабрики: ткань, размер и иллюстрация — из данных пака.
sub(
  '<span>{{ fabT.fabc }}: Рибана 2×2</span>',
  '<span>{{ fabT.fabc }}: {{ coverFabric }}</span>',
  1,
);
sub('<span>{{ fabT.size }}: M / RU 46</span>', '<span>{{ fabT.size }}: {{ fabSize }}</span>', 1);
sub(
  '<span style="position:absolute;inset:14px;background:url(assets/flat-alt.png) 50% 50%/contain no-repeat"></span>',
  '<span style="{{ fabHeroBg }}"></span>',
  1,
);

// Превью PDF в экспорте — название пака из данных.
sub(
  '<span style="font:300 8.5px/12px Inter,sans-serif;color:#C0392B">Структурный жакет</span>',
  '<span style="font:300 8.5px/12px Inter,sans-serif;color:#C0392B">{{ docName }}</span>',
  1,
);
sub(
  '<span style="font:700 8.5px/12px Sora,sans-serif">Структурный жакет</span>',
  '<span style="font:700 8.5px/12px Sora,sans-serif">{{ docName }}</span>',
  1,
);

// Карточка «Продолжить» на главной — реальный последний пак.
sub(
  '<span style="width:34px;height:34px;flex:none;border-radius:9px;overflow:hidden;border:1px solid #E4E1DC;background:url(assets/thumb.jpg) 50% 50%/cover no-repeat"></span>',
  '<span style="{{ contThumb }}"></span>',
  1,
);
sub(
  '<span style="display:block;font:600 11.5px/16px Sora,sans-serif">Структурный жакет — Обзор</span>',
  '<span style="display:block;font:600 11.5px/16px Sora,sans-serif">{{ contName }}</span>',
  1,
);
sub(
  '{{ contName }}</span>\n</span>\n<span style="font:400 9.7px/14px \'JetBrains Mono\',monospace;color:#B0ADA6">16 июл</span>',
  '{{ contName }}</span>\n</span>\n<span style="font:400 9.7px/14px \'JetBrains Mono\',monospace;color:#B0ADA6">{{ contDate }}</span>',
  1,
);
sub(
  '<div onClick="{{ goDoc }}" style="margin-top:26px;max-width:430px;',
  '<sc-if value="{{ contOn }}" hint-placeholder-val="{{ true }}">\n<div onClick="{{ goDoc }}" style="margin-top:26px;max-width:430px;',
  1,
);
sub(
  '</div>\n<div style="display:flex;gap:18px;margin-top:16px;flex-wrap:wrap"><span onClick="{{ goDash }}"',
  '</div>\n</sc-if>\n<div style="display:flex;gap:18px;margin-top:16px;flex-wrap:wrap"><span onClick="{{ goDash }}"',
  1,
);

// Макетный контент прототипа (сид-материалы библиотеки, история списаний
// с макетными паками) живёт только в демо-режиме ?demo=1 — обычный гость
// и инвайт-пользователь начинают с нуля.
sub(
  '<div style="display:flex;align-items:center;gap:9px;padding:10px 13px;border-bottom:1px solid #EFEDE9">\n<span style="width:14px;height:14px;flex:none;border-radius:5px;background:#0E0E0E;border:1px solid rgba(14,14,14,.14)"></span>\n<span style="flex:1;min-width:0"><span style="display:block;font:600 11.5px/16px Sora,sans-serif">Рибана 2×2 · 240 г/м²</span>',
  '<sc-if value="{{ demoSeedOn }}" hint-placeholder-val="{{ true }}">\n<div style="display:flex;align-items:center;gap:9px;padding:10px 13px;border-bottom:1px solid #EFEDE9">\n<span style="width:14px;height:14px;flex:none;border-radius:5px;background:#0E0E0E;border:1px solid rgba(14,14,14,.14)"></span>\n<span style="flex:1;min-width:0"><span style="display:block;font:600 11.5px/16px Sora,sans-serif">Рибана 2×2 · 240 г/м²</span>',
  1,
);
sub(
  '>877 C</span>\n</div>\n<sc-for list="{{ libMatRows }}"',
  '>877 C</span>\n</div>\n</sc-if>\n<sc-for list="{{ libMatRows }}"',
  1,
);
sub(
  '<div style="border-top:1px solid #E4E1DC">\n<div style="padding:8px 15px;font:600 9.2px/14px Sora,sans-serif;letter-spacing:1.1px;text-transform:uppercase;color:#6B6B67;background:rgba(14,14,14,.02);border-bottom:1px solid #EFEDE9">История списаний</div>',
  '<sc-if value="{{ demoSeedOn }}" hint-placeholder-val="{{ true }}">\n<div style="border-top:1px solid #E4E1DC">\n<div style="padding:8px 15px;font:600 9.2px/14px Sora,sans-serif;letter-spacing:1.1px;text-transform:uppercase;color:#6B6B67;background:rgba(14,14,14,.02);border-bottom:1px solid #EFEDE9">История списаний</div>',
  1,
);
sub(
  'color:#2F7C5A">0</span></div>\n</div>\n</div>',
  'color:#2F7C5A">0</span></div>\n</div>\n</sc-if>\n</div>',
  1,
);

// Баланс генераций — одна логика во всех трёх местах (сайдбар-меню, план).
sub(
  '<span style="font:500 34px/38px \'JetBrains Mono\',monospace">2</span>',
  '<span style="font:500 34px/38px \'JetBrains Mono\',monospace">{{ planBig }}</span>',
  1,
);
sub(
  '<span style="display:block;width:66%;height:100%;border-radius:99px;background:#0E0E0E"></span>',
  '<span style="{{ balBarStyle }}"></span>',
  2,
);
sub(
  '<span style="font:500 10.5px/15px \'JetBrains Mono\',monospace">2 / 3</span>',
  '<span style="font:500 10.5px/15px \'JetBrains Mono\',monospace">{{ balSlash }}</span>',
  1,
);

// Диалог просчёта: в прототипе его список назывался fabRows и затирался
// одноимённым списком вида фабрики (duplicate key в return renderVals) —
// диалог рендерился с пустыми полями. Даём ему своё имя.
sub('<sc-for list="{{ fabRows }}" as="fb"', '<sc-for list="{{ fabsList }}" as="fb"', 1);

// Живой чертёж: в экран «Чертёж» добавляется слой реальных SVG из спеки.
// Демо-SVG прототипа остаётся нетронутым и показывается, пока спеки нет.
sub(
  '<svg viewBox="{{ flatVB }}" preserveAspectRatio="xMidYMid meet" style="{{ flatSvgStyle }}">',
  '<sc-if value="{{ liveFlatOn }}" hint-placeholder-val="{{ false }}">\n' +
    '<sc-for list="{{ liveShots }}" as="lf" hint-placeholder-count="3"><span style="{{ lf.bg }}"></span></sc-for>\n' +
    '</sc-if>\n' +
    '<sc-if value="{{ liveFlatOff }}" hint-placeholder-val="{{ true }}">\n' +
    '<svg viewBox="{{ flatVB }}" preserveAspectRatio="xMidYMid meet" style="{{ flatSvgStyle }}">',
  1,
);
sub(
  '</svg>\n<span style="position:absolute;left:12px;top:12px;padding:5px 10px;border-radius:8px;background:rgba(255,255,255,.92);border:1px solid #E4E1DC;font:400 9.7px/14px \'JetBrains Mono\',monospace;color:#5A5A56">{{ viewBadge }}</span>',
  '</svg>\n</sc-if>\n<span style="position:absolute;left:12px;top:12px;padding:5px 10px;border-radius:8px;background:rgba(255,255,255,.92);border:1px solid #E4E1DC;font:400 9.7px/14px \'JetBrains Mono\',monospace;color:#5A5A56">{{ viewBadge }}</span>',
  1,
);

// ------------------------------------------------------------------- логика

const logic = readFileSync(join(webRoot, 'proto', 'logic.js'), 'utf8');
if (!logic.includes('class Component extends DCLogic')) {
  throw new Error('proto/logic.js обязан определять class Component extends DCLogic');
}

// props прототипа без $preview: standalone-страница живёт во весь вьюпорт.
const dataProps = JSON.stringify({
  proMode: { editor: 'boolean', default: false, tsType: 'boolean', section: 'Режим' },
  density: {
    editor: 'enum',
    options: ['комфортная', 'плотная'],
    default: 'комфортная',
    tsType: 'string',
    section: 'Режим',
  },
}).replace(/"/g, '&quot;');

const page = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Seamsterly</title>
<script src="./react.js"></script>
<script src="./react-dom.js"></script>
<script src="./engine.js"></script>
<script src="./support.js"></script>
</head>
<body>
<x-dc>${tpl}</x-dc>
<script type="text/x-dc" data-dc-script data-props="${dataProps}">
${logic}
</script>
</body>
</html>
`;

mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, 'index.html'), page);
copyFileSync(join(handoff, 'support.js'), join(dist, 'support.js'));
// UMD-сборки React 18 лежат в пакетах, но не экспортируются — берём по пути.
const pkgDir = (name) => dirname(require.resolve(name + '/package.json'));
copyFileSync(join(pkgDir('react'), 'umd', 'react.production.min.js'), join(dist, 'react.js'));
copyFileSync(
  join(pkgDir('react-dom'), 'umd', 'react-dom.production.min.js'),
  join(dist, 'react-dom.js'),
);
cpSync(join(handoff, 'assets'), join(dist, 'assets'), { recursive: true });

console.log(
  `dist собран: шаблон ${Math.round(tpl.length / 1024)} КБ · подстановок ${replaced} · логика ${Math.round(logic.length / 1024)} КБ`,
);
