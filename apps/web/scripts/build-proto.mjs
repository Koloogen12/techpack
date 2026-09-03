#!/usr/bin/env node
/**
 * Сборка кабинета из прототипа хендоффа.
 *
 * Разметка берётся из design_handoff_seamster/SpecForm - Воркспейс.dc.html
 * БАЙТ-В-БАЙТ и исполняется рантаймом прототипа (support.js). Никакого
 * пересказа вёрстки: единственные правки — подстановка биндингов в места,
 * где прототип нёс демо-данные текстом (имя пака, артикул, e-mail), и
 * ребрендинг SPECFORM → SEAMSTER, разрешённый хендоффом (README, D8).
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
const handoff = join(repoRoot, 'design_handoff_seamster');
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

// Ребрендинг — разрешён хендоффом (README, D8). Прототип нёс рабочее название
// текстом, а рядом — заглушечную иконку из двух линий. Оба места получают
// настоящий знак: словесный вместо текста, монограмма внутрь готовой плашки.
// Контейнеры, отступы и размеры прототипа при этом не трогаются — меняется
// только содержимое: строка на картинку, иконка на букву.
const icon = (px, stroke) =>
  `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="#fff" ` +
  `stroke-width="${stroke}" stroke-linecap="round"><path d="M5 9h14"></path>` +
  `<path d="M5 15h9"></path></svg>`;
// Буква занимает ту же высоту, что занимала иконка.
const letter = (px) => `<img src="./mark-s.svg" alt="" style="height:${px}px;display:block">`;
sub(icon(15, '2.4'), letter(14), 1);
sub(icon(19, '2.6'), letter(18), 1);

// Кегль знака подобран по высоте прописных, которые стояли здесь текстом:
// строчное слово рядом с капсом читается мельче при равной высоте кегля.
const word = (px) => `<img src="./logo.svg" alt="Seamster" style="height:${px}px;display:block">`;
sub(
  '<span style="font:700 12px/16px Sora,sans-serif;letter-spacing:2.2px">SPECFORM OS</span>',
  word(13),
  1,
);
sub(
  '<span style="font:700 13px/18px Sora,sans-serif;letter-spacing:2.4px">SPECFORM OS</span>',
  word(14),
  1,
);
// Превью документа. Прототип рисовал первую страницу РУКАМИ: чужое изделие,
// чужие узлы, дата из макета. Человек грузил худи и видел в превью жакет с
// молнией по асимметрии. Показываем настоящий документ — тот же renderHtml,
// что печатает PDF, во врезке. Артикул внутри макета уезжает вместе с ним,
// поэтому отдельной подстановки на него больше нет.
const fakePreview = `<div style="align-self:center;width:100%;max-width:620px;aspect-ratio:297/210;background:#fff;border:1px solid #E4E1DC;box-shadow:0 12px 34px rgba(14,14,14,.1);border-radius:4px;padding:20px 22px;display:flex;flex-direction:column;gap:8px;overflow:hidden">
<div style="display:flex;align-items:center;justify-content:space-between">
<span style="font:500 8px/11px 'JetBrains Mono',monospace;color:#5A5A56">SPECFORM · 498BA296</span>
<span style="font:400 7px/10px Sora,sans-serif;letter-spacing:1.4px;text-transform:uppercase;color:#B0ADA6">{{ pvSection }}</span>
</div>
<div style="height:1px;background:#E4E1DC"></div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
<span style="display:flex;flex-direction:column"><span style="font:600 6.5px/9px Sora,sans-serif;letter-spacing:.8px;text-transform:uppercase;color:#B0ADA6">{{ pvL1 }}</span><span style="font:300 8.5px/12px Inter,sans-serif;color:#B0ADA6">{{ pvNA }}</span></span>
<span style="display:flex;flex-direction:column"><span style="font:600 6.5px/9px Sora,sans-serif;letter-spacing:.8px;text-transform:uppercase;color:#B0ADA6">{{ pvL2 }}</span><span style="font:300 8.5px/12px Inter,sans-serif;color:#C0392B">Структурный жакет</span></span>
<span style="display:flex;flex-direction:column"><span style="font:600 6.5px/9px Sora,sans-serif;letter-spacing:.8px;text-transform:uppercase;color:#B0ADA6">{{ pvL3 }}</span><span style="font:300 8.5px/12px Inter,sans-serif;color:#B0ADA6">{{ pvNA }}</span></span>
<span style="display:flex;flex-direction:column"><span style="font:600 6.5px/9px Sora,sans-serif;letter-spacing:.8px;text-transform:uppercase;color:#B0ADA6">{{ pvL4 }}</span><span style="font:300 8.5px/12px Inter,sans-serif;color:#C0392B">M</span></span>
</div>
<div style="flex:1;min-height:0;display:flex;gap:12px">
<span style="flex:1.5;display:flex;align-items:center;justify-content:center;border:1px solid #EFEDE9;border-radius:3px;overflow:hidden">
<img src="assets/flat-alt.png" alt="" style="max-width:94%;max-height:94%;object-fit:contain">
</span>
<span style="flex:1;display:flex;flex-direction:column;gap:5px;border:1px solid #EFEDE9;border-radius:3px;padding:9px">
<span style="font:700 8.5px/12px Sora,sans-serif">Структурный жакет</span>
<span style="display:flex;justify-content:space-between"><span style="font:400 7px/10px Sora,sans-serif;color:#B0ADA6">{{ pvR1 }}</span><span style="font:300 7.5px/10px Inter,sans-serif;color:#C0392B">{{ pvV1 }}</span></span>
<span style="display:flex;justify-content:space-between"><span style="font:400 7px/10px Sora,sans-serif;color:#B0ADA6">{{ pvR2 }}</span><span style="font:300 7.5px/10px Inter,sans-serif;color:#C0392B">{{ pvV2 }}</span></span>
<span style="display:flex;justify-content:space-between"><span style="font:400 7px/10px Sora,sans-serif;color:#B0ADA6">{{ pvR3 }}</span><span style="font:300 7.5px/10px Inter,sans-serif;color:#C0392B">{{ pvV3 }}</span></span>
<span style="display:flex;justify-content:space-between"><span style="font:400 7px/10px Sora,sans-serif;color:#B0ADA6">Ряд</span><span style="font:300 7.5px/10px Inter,sans-serif;color:#C0392B">XS–XL</span></span>
<span style="height:1px;background:#EFEDE9;margin:2px 0"></span>
<span style="font:600 6.5px/9px Sora,sans-serif;letter-spacing:.8px;text-transform:uppercase;color:#B0ADA6">Ключевые узлы</span>
<span style="font:400 7px/10.5px Sora,sans-serif;color:#5A5A56">— Горловина: обтачка косой бейкой</span>
<span style="font:400 7px/10.5px Sora,sans-serif;color:#5A5A56">— Молния по асимметрии, лента под припуск</span>
<span style="font:400 7px/10.5px Sora,sans-serif;color:#5A5A56">— Низ: подгибка 2 см двойной иглой</span>
</span>
</div>
</div>`;
sub(
  fakePreview,
  '<iframe src="{{ docPreviewUrl }}" title="Превью документа" ' +
    'style="align-self:center;width:100%;max-width:620px;aspect-ratio:297/210;background:#fff;' +
    'border:1px solid #E4E1DC;box-shadow:0 12px 34px rgba(14,14,14,.1);border-radius:4px;' +
    'pointer-events:none"></iframe>',
  1,
);
sub('Превью PDF · страница 1 из 9', 'Превью документа · {{ docPages }}', 1);
sub('PDF полный · 9 страниц', 'PDF полный · {{ docPages }}', 1);
sub(
  `<span style="font:400 9.7px/14px 'JetBrains Mono',monospace;color:#B0ADA6">16 июл, 07:12</span>`,
  `<span style="font:400 9.7px/14px 'JetBrains Mono',monospace;color:#B0ADA6">{{ docUpdated }}</span>`,
  1,
);

// Дополнительный ряд вопроса анкеты нёс подпись «Тираж» и ценовую подсказку
// как единственный случай. Теперь такой ряд есть и у вопроса про пол —
// подпись и подсказка идут из данных вопроса, а не из разметки.
sub('color:#6B6B67">Тираж</span>', 'color:#6B6B67">{{ q.extraLabel }}</span>', 1);
sub('color:#2F7C5A">{{ qtyHint }}</span>', 'color:#2F7C5A">{{ q.extraHint }}</span>', 1);

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

// Уведомления: три выдуманные строки макета заменяются реальным списком.
// Разметка строки — та же самая, что в прототипе, только повторяется по данным.
sub(
  `<div onClick="{{ notifCalc }}" style="display:flex;gap:9px;padding:8px 9px;border-radius:9px;cursor:pointer" style-hover="background:rgba(14,14,14,.045)">
<span style="width:7px;height:7px;flex:none;border-radius:50%;background:#2F7C5A;margin-top:4px"></span>
<span style="min-width:0"><span style="display:block;font:600 11px/15px Sora,sans-serif">Пришли просчёты — 2 фабрики</span><span style="display:block;font:400 9.5px/13px Sora,sans-serif;color:#6B6B67">Структурный жакет · сегодня, 09:12</span></span>
</div>
<div onClick="{{ notifPom }}" style="display:flex;gap:9px;padding:8px 9px;border-radius:9px;cursor:pointer" style-hover="background:rgba(14,14,14,.045)">
<span style="width:7px;height:7px;flex:none;border-radius:50%;background:#C0392B;margin-top:4px"></span>
<span style="min-width:0"><span style="display:block;font:600 11px/15px Sora,sans-serif">Подтвердите 5 предположений</span><span style="display:block;font:400 9.5px/13px Sora,sans-serif;color:#6B6B67">до отправки на производство</span></span>
</div>
<div onClick="{{ closeNotif }}" style="display:flex;gap:9px;padding:8px 9px;border-radius:9px;cursor:pointer" style-hover="background:rgba(14,14,14,.045)">
<span style="width:7px;height:7px;flex:none;border-radius:50%;background:#B0ADA6;margin-top:4px"></span>
<span style="min-width:0"><span style="display:block;font:600 11px/15px Sora,sans-serif;color:#6B6B67">Генерация «Худи оверсайз» готова</span><span style="display:block;font:400 9.5px/13px Sora,sans-serif;color:#B0ADA6">12 июл, 18:02 · прочитано</span></span>
</div>`,
  `<sc-for list="{{ notifItems }}" as="nt" hint-placeholder-count="3">
<div onClick="{{ nt.go }}" style="display:flex;gap:9px;padding:8px 9px;border-radius:9px;cursor:pointer" style-hover="background:rgba(14,14,14,.045)">
<span style="{{ nt.dotStyle }}"></span>
<span style="min-width:0"><span style="{{ nt.titleStyle }}">{{ nt.title }}</span><span style="{{ nt.subStyle }}">{{ nt.sub }}</span></span>
</div>
</sc-for>
<sc-if value="{{ notifEmpty }}" hint-placeholder-val="{{ false }}">
<div style="display:flex;gap:9px;padding:8px 9px;border-radius:9px">
<span style="width:7px;height:7px;flex:none;border-radius:50%;background:#B0ADA6;margin-top:4px"></span>
<span style="min-width:0"><span style="display:block;font:600 11px/15px Sora,sans-serif;color:#6B6B67">Пока пусто</span><span style="display:block;font:400 9.5px/13px Sora,sans-serif;color:#B0ADA6">события появятся после первой генерации</span></span>
</div>
</sc-if>`,
  1,
);

// Просчёт: выбирать из трёх выдуманных фабрик человеку не дадим. В рабочем
// режиме это заявка консьержу — с полем комментария и честным сроком.
sub(
  `<div style="display:flex;flex-direction:column;gap:7px">
<sc-for list="{{ fabRows }}" as="fb" hint-placeholder-count="3">`,
  `<sc-if value="{{ quoteRealOn }}" hint-placeholder-val="{{ true }}">
<div style="display:flex;flex-direction:column;gap:7px">
<div style="border-radius:10px;border:1px solid rgba(31,138,76,.28);background:#fff;padding:11px 12px">
<div style="font:600 11.5px/16px Sora,sans-serif">Партнёрская сеть фабрик Seamster</div>
<div style="font:400 10px/15px Sora,sans-serif;color:#6B6B67;margin-top:3px">Отправим ваш техпак фабрикам, которые шьют такие изделия, и вернёмся с ценами. Выбор фабрик и переписку берём на себя.</div>
</div>
<input value="{{ quoteComment }}" onChange="{{ onQuoteComment }}" placeholder="Что важно учесть: сроки, тираж, пожелания по цене" style="width:100%;padding:9px 10px;border-radius:9px;border:1px solid rgba(14,14,14,.14);background:#fff;font:400 11px/15px Sora,sans-serif" style-focus="border-color:rgba(14,14,14,.35)">
</div>
</sc-if>
<div style="display:flex;flex-direction:column;gap:7px">
<sc-for list="{{ fabsList }}" as="fb" hint-placeholder-count="3">`,
  1,
);
sub(
  `<span style="font:400 10px/15px Sora,sans-serif;color:#6B6B67;text-wrap:pretty">Фабрики получат PDF и вернут цену за единицу при вашем тираже. Статус пака сменится на «На просчёте».</span>`,
  `<span style="font:400 10px/15px Sora,sans-serif;color:#6B6B67;text-wrap:pretty">{{ quoteNote }}</span>`,
  1,
);

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
// Пункт «Пригласить друга» в меню аккаунта вёл в closeUserMenu (заглушка) —
// теперь открывает реальную реферальную программу.
sub(
  '<div onClick="{{ closeUserMenu }}" style="display:flex;align-items:center;gap:9px;padding:8px 9px;border-radius:9px;cursor:pointer;margin-top:4px"',
  '<div onClick="{{ inviteFriend }}" style="display:flex;align-items:center;gap:9px;padding:8px 9px;border-radius:9px;cursor:pointer;margin-top:4px"',
  1,
);

// Три модальных окна, которых в прототипе не было, потому что там эти
// действия были тостами-имитациями. Собраны из его же токенов и паттерна
// модалки «Выйти из мастера?»: белая карточка 14px, тень 0 24px 56px,
// sfup, кнопки 27px — ничего нового не изобретено.
sub(
  '<sc-if value="{{ tipOn }}" hint-placeholder-val="{{ false }}">',
  `<sc-if value="{{ modalOn }}" hint-placeholder-val="{{ false }}">
<div onClick="{{ closeModal }}" style="position:fixed;inset:0;z-index:44;background:rgba(14,14,14,.34);display:flex;align-items:center;justify-content:center;padding:20px">
<div onClick="{{ modalStop }}" style="width:100%;max-width:420px;border-radius:14px;background:#fff;border:1px solid rgba(14,14,14,.1);box-shadow:0 24px 56px rgba(0,0,0,.24);padding:20px 22px 18px;animation:sfup .18s ease">
<div style="display:flex;align-items:center;gap:10px">
<span style="{{ modalIconStyle }}">
<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4.5 4.5L19 7"></path></svg>
</span>
<span style="font:700 15px/21px Sora,sans-serif;letter-spacing:-.1px">{{ modalTitle }}</span>
</div>
<div style="font:400 11.5px/18px Sora,sans-serif;color:#5A5A56;margin-top:11px;text-wrap:pretty">{{ modalText }}</div>
<sc-if value="{{ modalLinkOn }}" hint-placeholder-val="{{ false }}">
<div style="display:flex;align-items:center;gap:7px;margin-top:13px">
<span style="flex:1;min-width:0;padding:9px 11px;border-radius:9px;background:rgba(14,14,14,.04);font:400 10.5px/15px 'JetBrains Mono',monospace;color:#5A5A56;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ modalLink }}</span>
<span onClick="{{ modalCopy }}" style="flex:none;height:33px;border-radius:9px;border:1px solid rgba(14,14,14,.12);background:#fff;display:flex;align-items:center;padding:0 12px;font:600 10.5px/15px Sora,sans-serif;cursor:pointer" style-hover="background:#FAF9F7">Скопировать</span>
</div>
</sc-if>
<sc-if value="{{ modalStatsOn }}" hint-placeholder-val="{{ false }}">
<div style="display:flex;gap:9px;margin-top:13px">
<span style="flex:1;border-radius:10px;border:1px solid #E4E1DC;padding:10px 12px"><span style="display:block;font:500 19px/24px 'JetBrains Mono',monospace">{{ refInvited }}</span><span style="display:block;font:400 9.5px/13px Sora,sans-serif;color:#6B6B67">приглашено</span></span>
<span style="flex:1;border-radius:10px;border:1px solid #E4E1DC;padding:10px 12px"><span style="display:block;font:500 19px/24px 'JetBrains Mono',monospace">{{ refJoined }}</span><span style="display:block;font:400 9.5px/13px Sora,sans-serif;color:#6B6B67">подключилось</span></span>
<span style="flex:1;border-radius:10px;border:1px solid rgba(41,117,82,.22);background:rgba(228,247,239,.5);padding:10px 12px"><span style="display:block;font:500 19px/24px 'JetBrains Mono',monospace;color:#2F7C5A">{{ refCredits }}</span><span style="display:block;font:400 9.5px/13px Sora,sans-serif;color:#2F7C5A">генераций</span></span>
</div>
</sc-if>
<sc-if value="{{ modalSilhOn }}" hint-placeholder-val="{{ false }}">
<div style="display:flex;gap:9px;margin-top:13px">
<sc-for list="{{ silhCards }}" as="c" hint-placeholder-count="3">
<span onClick="{{ c.go }}" style="{{ c.style }}">
<span style="{{ c.imgStyle }}"></span>
<span style="display:block;font:600 10px/14px Sora,sans-serif;margin-top:7px">{{ c.title }}</span>
<span style="display:block;font:400 9.5px/13px Sora,sans-serif;color:#6B6B67;margin-top:1px">{{ c.sub }}</span>
</span>
</sc-for>
</div>
</sc-if>
<sc-if value="{{ modalFormOn }}" hint-placeholder-val="{{ false }}">
<div style="display:flex;flex-direction:column;gap:8px;margin-top:13px">
<input value="{{ claimName }}" onChange="{{ onClaimName }}" placeholder="Как вас зовут" style="width:100%;padding:10px 11px;border-radius:9px;border:1px solid rgba(14,14,14,.14);background:#FAF9F7;font:400 11.5px/16px Sora,sans-serif" style-focus="border-color:#0E0E0E;background:#fff">
<input value="{{ claimContact }}" onChange="{{ onClaimContact }}" placeholder="Телеграм или почта для ответа" style="width:100%;padding:10px 11px;border-radius:9px;border:1px solid rgba(14,14,14,.14);background:#FAF9F7;font:400 11.5px/16px Sora,sans-serif" style-focus="border-color:#0E0E0E;background:#fff">
<input value="{{ claimNote }}" onChange="{{ onClaimNote }}" placeholder="Что шьёте — пара слов" style="width:100%;padding:10px 11px 26px;border-radius:9px;border:1px solid rgba(14,14,14,.14);background:#FAF9F7;font:400 11.5px/16px Sora,sans-serif" style-focus="border-color:#0E0E0E;background:#fff">
</div>
</sc-if>
<div style="display:flex;gap:7px;margin-top:16px">
<span onClick="{{ modalGo }}" style="{{ modalCtaStyle }}">{{ modalCta }}</span>
<sc-if value="{{ modalCancelOn }}" hint-placeholder-val="{{ false }}">
<span onClick="{{ closeModal }}" style="flex:none;height:34px;border-radius:9px;border:1px solid rgba(14,14,14,.12);display:flex;align-items:center;padding:0 14px;font:600 11px/16px Sora,sans-serif;cursor:pointer" style-hover="background:#FAF9F7">Отмена</span>
</sc-if>
</div>
</div>
</div>
</sc-if>

<sc-if value="{{ tipOn }}" hint-placeholder-val="{{ false }}">`,
  1,
);

// Замена силуэта на экране чертежа. В прототипе её не было: там чертёж
// всегда строился нашим движком, а библиотеки покупных силуэтов ещё не
// существовало. Полоса собрана из той же конструкции, что и соседняя
// подсказка под холстом: та же рамка, тот же кегль, кнопка 27px.
// Пункты меню выгрузки получают своё действие. В прототипе все четыре вели
// в раздел «Экспорт» — там нашлись карточки для PDF и SVG, но не для таблицы
// замеров: пункт был обещанием без исполнения.
sub(
  '<sc-for list="{{ exports }}" as="e" hint-placeholder-count="4">\n<div onClick="{{ goExportSec }}"',
  '<sc-for list="{{ exports }}" as="e" hint-placeholder-count="4">\n<div onClick="{{ e.go }}"',
  1,
);

sub(
  'чертёж перестроится сам. Кликните по номеру на чертеже, чтобы открыть узел конструкции.</span>\n</div>',
  `чертёж перестроится сам. Кликните по номеру на чертеже, чтобы открыть узел конструкции.</span>
</div>
<sc-if value="{{ silhOn }}" hint-placeholder-val="{{ false }}">
<div style="border-top:1px solid #E4E1DC;padding:10px 13px;display:flex;align-items:center;gap:9px">
<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6B6B67" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 9 5-9 5-9-5 9-5Z"></path><path d="m3 14 9 5 9-5"></path></svg>
<span style="flex:1;min-width:0;font:400 10.5px/16px Sora,sans-serif;color:#6B6B67">{{ silhNote }}</span>
<span onClick="{{ silhOpen }}" style="flex:none;height:27px;border-radius:8px;border:1px solid rgba(14,14,14,.12);background:#fff;display:flex;align-items:center;padding:0 11px;font:600 10px/14px Sora,sans-serif;cursor:pointer;white-space:nowrap" style-hover="background:#FAF9F7">Заменить</span>
</div>
</sc-if>`,
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
<link rel="icon" href="./favicon.svg">
<title>Seamster</title>
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

// Знак — из бренд-кита, а не копией в проекте: один источник на все носители.
const brand = join(repoRoot, 'brand-kit', 'logo');
copyFileSync(join(brand, 'seamster.svg'), join(dist, 'logo.svg'));
copyFileSync(join(brand, 'seamster-s.svg'), join(dist, 'mark-s.svg'));
copyFileSync(join(brand, 'favicon.svg'), join(dist, 'favicon.svg'));

console.log(
  `dist собран: шаблон ${Math.round(tpl.length / 1024)} КБ · подстановок ${replaced} · логика ${Math.round(logic.length / 1024)} КБ`,
);
