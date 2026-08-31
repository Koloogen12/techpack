#!/usr/bin/env tsx
/**
 * Сборка ревью-сайта: витрина готовых техпаков для фабрик и брендов.
 *
 *   pnpm site --versions versions --out out/site
 *
 * Зачем он такой, какой есть. Приглашённым нужно ПРОЧИТАТЬ документ и сказать,
 * берут ли они его в работу. Для этого не нужно ни приложение, ни загрузка
 * фотографий, ни база: нужен адрес, по которому лежит настоящий пак на трёх
 * языках и форма, куда сказать «да» или «нет».
 *
 * Поэтому сайт СТАТИЧЕСКИЙ и собирается здесь, на машине разработчика.
 * На сервере не остаётся ни движка, ни справочников, ни ключей — нечему
 * упасть и нечего утечь. Единственная живая часть там — сборщик вердиктов
 * на семьдесят строк.
 *
 * И главное: форма вердикта — это не «обратная связь», а измерительный
 * прибор RAT-1. Вопрос в ней задан ровно тот, от которого зависит решение
 * о продукте: «возьмёте в работу для отшива пробника».
 */
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { renderHtml, renderPdf, renderRolePdfs, EXPORT_ROLES, roleProfile } from '@seamster/docgen';
import { VersionStore } from '@seamster/versions';
import { LOCALES, LOCALE_LABEL } from '@seamster/i18n';
import { CATEGORY_LABEL_RU } from '@seamster/kb';
import type { StyleSpec } from '@seamster/stylespec';
import { SITE_CSS, esc, layout } from './layout.js';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};

const versionsDir = flag('versions', 'versions');
const outDir = flag('out', 'out/site');

interface Entry {
  article: string;
  spec: StyleSpec;
  version: number;
  confirmed: number;
  points: number;
}

async function buildPack(browser: Browser, e: Entry): Promise<void> {
  const dir = join(outDir, 'p', e.article);
  mkdirSync(dir, { recursive: true });

  // Документ на каждом языке — отдельным файлом. Переключатель языка это
  // просто ссылка: никакого состояния, ничего не ломается от перезагрузки.
  for (const locale of LOCALES) {
    writeFileSync(join(dir, `${locale}.html`), renderHtml(e.spec, { pro: true, locale }));
    writeFileSync(
      join(dir, `${locale}.pdf`),
      await renderPdf(e.spec, { pro: true, locale, browser }),
    );
  }

  // Ролевые выгрузки: технолог, ОТК, закройщик, печатник. Их и просят
  // оценить в первую очередь — каждый смотрит свой лист, а не весь пак.
  for (const { role, pdf } of await renderRolePdfs(e.spec, EXPORT_ROLES, browser)) {
    writeFileSync(join(dir, `role-${role}.pdf`), pdf);
  }

  writeFileSync(join(dir, 'index.html'), packPage(e));
}

function packPage(e: Entry): string {
  const roles = EXPORT_ROLES.map((r) => {
    const p = roleProfile(r);
    return `<a class="chip" href="role-${r}.pdf" download>${esc(p.label_ru)} · PDF</a>`;
  }).join('');

  const langs = LOCALES.map(
    (l) =>
      `<a class="tab" href="#" data-lang="${l}">${esc(LOCALE_LABEL[l])}</a>` +
      `<a class="chip" href="${l}.pdf" download>PDF ${esc(l.toUpperCase())}</a>`,
  ).join('');

  return layout(
    `${e.spec.style.name} · ${e.article}`,
    `<a class="back" href="../../index.html">← ко всем паковам</a>` +
      `<h1>${esc(e.spec.style.name)}</h1>` +
      `<div class="sub">${esc(e.article)} · ${esc(CATEGORY_LABEL_RU[e.spec.style.category])} · ` +
      `версия ${e.version} · подтверждено по образцу ${e.confirmed} из ${e.points} точек</div>` +
      `<div class="bar"><div class="tabs" id="tabs">${langs}</div></div>` +
      `<iframe id="doc" src="ru.html" title="Технический пакет"></iframe>` +
      `<h2>Выгрузки по ролям</h2>` +
      `<div class="note">Каждый лист уходит своему человеку в цеху: технолог читает узлы, ` +
      `ОТК — табель мер с допусками, закройщик — чертёж и припуски.</div>` +
      `<div class="chips">${roles}</div>` +
      verdictForm(e.article),
    `<script>
      var tabs = document.getElementById('tabs');
      var doc = document.getElementById('doc');
      tabs.addEventListener('click', function (ev) {
        var a = ev.target.closest('a[data-lang]');
        if (!a) return;
        ev.preventDefault();
        doc.src = a.getAttribute('data-lang') + '.html';
        var all = tabs.querySelectorAll('a[data-lang]');
        for (var i = 0; i < all.length; i++) all[i].classList.remove('on');
        a.classList.add('on');
      });
      tabs.querySelector('a[data-lang]').classList.add('on');
    </script>`,
    2,
  );
}

/**
 * Форма вердикта — прибор RAT-1.
 *
 * Вопрос задан ровно тот, от которого зависит решение о продукте, и ответ
 * на него бинарный. «Понравилось» ответом не является: понравиться может
 * и то, по чему никто не станет шить.
 */
function verdictForm(article: string): string {
  return (
    `<h2 id="verdict">Возьмёте этот документ в работу?</h2>` +
    `<div class="note">Вопрос ровно один и ответ на него бинарный: сядет ли ` +
    `по этому документу конструктор и уйдёт ли пробник в отшив без возврата ` +
    `на доработку. «Понравилось» ответом не является — понравиться может и то, ` +
    `по чему никто не станет шить.</div>` +
    `<form class="verdict" method="post" action="/api/verdict">` +
    `<input type="hidden" name="article" value="${esc(article)}">` +
    `<div class="row">` +
    `<label><input type="radio" name="takes" value="yes" required> Берём в работу</label>` +
    `<label><input type="radio" name="takes" value="fixes"> Возьмём после правок</label>` +
    `<label><input type="radio" name="takes" value="no"> Не берём</label>` +
    `</div>` +
    `<div class="grid">` +
    `<label class="f"><span>Кто вы</span><input name="who" placeholder="фабрика или бренд, название" required></label>` +
    `<label class="f"><span>Имя</span><input name="name" placeholder="как к вам обращаться" required></label>` +
    `<label class="f"><span>Город</span><input name="city" placeholder="город"></label>` +
    `<label class="f"><span>Связь</span><input name="contact" placeholder="телефон, почта или телеграм"></label>` +
    `</div>` +
    `<label class="f"><span>Чего не хватает или что мешает</span>` +
    `<textarea name="comment" rows="4" placeholder="конкретно: какого листа нет, какое число вызывает сомнение, что спросили бы у заказчика"></textarea></label>` +
    `<button type="submit">Отправить ответ</button>` +
    `<div class="note">Ответ уходит нам и никому больше. Документ и ваши слова ` +
    `не публикуются.</div>` +
    `</form>`
  );
}

function indexPage(entries: readonly Entry[]): string {
  const rows = entries
    .map(
      (e) =>
        `<a class="card" href="p/${esc(e.article)}/index.html">` +
        `<div class="ml">${esc(e.article)}</div>` +
        `<div class="name">${esc(e.spec.style.name)}</div>` +
        `<div class="meta">${esc(CATEGORY_LABEL_RU[e.spec.style.category])} · ` +
        `версия ${e.version} · подтверждено ${e.confirmed} из ${e.points}</div>` +
        `</a>`,
    )
    .join('');

  return layout(
    'Seamster · техпаки на оценку',
    `<h1>Техпаки на оценку</h1>` +
      `<div class="note lead">Здесь настоящие производственные пакеты, собранные нашим ` +
      `движком: табель мер с допусками, градация, чертёж, спецификация материалов, ` +
      `узлы обработки с кодами швов. На русском, английском и китайском. ` +
      `Откройте любой, прочитайте как свой рабочий документ и скажите, ` +
      `<b>сядет ли по нему конструктор</b>.</div>` +
      `<div class="cards">${rows}</div>` +
      `<div class="note" style="margin-top:32px">Каждое значение в документе несёт ` +
      `статус: подтверждено по образцу, указано брендом, снято с фотографии, ` +
      `взято типовым или предположено. Мы не выдаём догадку за замер — ` +
      `и просим судить документ именно по этому.</div>`,
  );
}

const store = new VersionStore(versionsDir);
const entries: Entry[] = [];

for (const article of store.articles()) {
  const latest = store.latest(article);
  if (!latest) continue;
  const points = latest.spec.measurements.points;
  entries.push({
    article,
    spec: latest.spec,
    version: latest.entry.n,
    confirmed: points.filter((p) => p.base.confidence === 'fit_confirmed').length,
    points: points.length,
  });
}

if (!entries.length) {
  console.error(
    `\nВ ${versionsDir} нет ни одной версии. Сначала соберите пак:\n` +
      `  pnpm generate --answers <анкета> --out out/pack.pdf --versions ${versionsDir}\n`,
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const e of entries) {
    await buildPack(browser, e);
    console.log(`  ✓ ${e.article} — 3 языка, ${EXPORT_ROLES.length} ролей`);
  }
} finally {
  await browser.close();
}

writeFileSync(join(outDir, 'index.html'), indexPage(entries));
writeFileSync(join(outDir, 'styles.css'), SITE_CSS);
writeFileSync(
  join(outDir, 'robots.txt'),
  // Паки принадлежат брендам. Индексировать их нельзя ни при каких условиях.
  'User-agent: *\nDisallow: /\n',
);

const holding = join(outDir, '..', 'holding');
mkdirSync(holding, { recursive: true });
writeFileSync(join(holding, 'index.html'), holdingPage());
writeFileSync(join(holding, 'styles.css'), SITE_CSS);
if (existsSync('README.md')) copyFileSync('README.md', join(holding, 'README.md'));

function holdingPage(): string {
  return layout(
    'Seamster',
    `<h1>Seamster</h1>` +
      `<div class="note lead">Фотография изделия превращается в производственный ` +
      `технический пакет для швейной фабрики: табель мер с допусками, градация ` +
      `по размерному ряду, технический чертёж, спецификация материалов, узлы ` +
      `обработки с кодами швов по ГОСТ и ISO.</div>` +
      `<div class="note">Каждое значение в документе несёт статус своего ` +
      `происхождения. Мы не выдаём догадку за замер.</div>`,
  );
}

console.log(`\n✓ ${outDir}`);
console.log(
  `  паков: ${entries.length} · языков: ${LOCALES.length} · ролей: ${EXPORT_ROLES.length}`,
);
console.log(`  титульная: ${holding}\n`);
