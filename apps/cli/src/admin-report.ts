/**
 * Отчёт консьерж-панели.
 *
 * Отделён от команды намеренно: правила «что требует внимания» — это
 * бизнес-логика, а не оформление. Обязательный реквизит без значения
 * закрывает продажу в ЕАЭС, проваленная проверка печати — это отказ
 * печатника через день после отправки. Такие правила обязаны иметь тест,
 * а тест не может запускать команду.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { ArtworkLibrary } from '@seamsterly/library';
import type { VersionStore } from '@seamsterly/versions';
import { type VersionEntry } from '@seamsterly/versions';
import type { StyleSpec } from '@seamsterly/stylespec';
import { CATEGORY_LABEL_RU } from '@seamsterly/kb';
import { parseRfqLog, summariseRfq } from './rfq-log.js';

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Строка «требует внимания»: что не так, кого касается и что набрать. */
export interface Attention {
  article: string;
  what: string;
  /** Команда буквально — её копируют, а не пересказывают. */
  command: string;
  /** Насколько это срочно: срочное закрывает выпуск, остальное копится. */
  blocking: boolean;
}

export interface Row {
  article: string;
  name: string;
  category: string;
  versions: number;
  last: VersionEntry | null;
  points: number;
  confirmed: number;
  assumptions: number;
}

export function collect(store: VersionStore): { rows: Row[]; attention: Attention[] } {
  const rows: Row[] = [];
  const attention: Attention[] = [];

  for (const article of store.articles()) {
    const list = store.list(article);
    const latest = store.latest(article);
    if (!latest) continue;
    const spec: StyleSpec = latest.spec;

    const points = spec.measurements.points;
    const confirmed = points.filter((p) => p.base.confidence === 'fit_confirmed').length;

    rows.push({
      article,
      name: spec.style.name,
      category: CATEGORY_LABEL_RU[spec.style.category],
      versions: list.length,
      last: latest.entry,
      points: points.length,
      confirmed,
      assumptions: spec.meta.assumptions_count,
    });

    // --- Что требует внимания -----------------------------------------------
    if (confirmed === 0) {
      attention.push({
        article,
        what: 'Ни одна точка не подтверждена по образцу — изделие ни разу не отшивали.',
        command: `pnpm fit:apply <бланк-замеров.json>`,
        blocking: false,
      });
    }

    // Обязательный реквизит без значения — это не «недооформлено»,
    // а невозможность продажи в ЕАЭС. Такое закрывает выпуск.
    const missing = (spec.labels?.requisites ?? []).filter((r) => r.required && r.value === null);
    if (missing.length) {
      attention.push({
        article,
        what:
          `Маркировка: не заполнено обязательных реквизитов ${missing.length} ` +
          `(${missing.map((r) => r.label_ru).join(', ')}). Продажа в ЕАЭС невозможна.`,
        command: 'заполните brand_profile в анкете и пересоберите пак',
        blocking: true,
      });
    }

    // Провалившаяся проверка печати — это отказ печатника, а не замечание.
    // Он придёт письмом через день после отправки, и лучше узнать сейчас.
    for (const placement of spec.artwork?.placements ?? []) {
      for (const check of placement.checks) {
        if (check.status !== 'fail') continue;
        attention.push({
          article,
          what: `Нанесение ${placement.id} · ${check.label_ru}: ${check.detail_ru}`,
          command: 'запросите у бренда файл крупнее или уменьшите физический размер',
          blocking: true,
        });
      }
    }

    for (const colorway of spec.bom?.colorways ?? []) {
      if (colorway.swatch && !colorway.swatch.uniform) {
        attention.push({
          article,
          what: `Образец «${colorway.name_ru}» снят неровно — цвет взят по медианной области.`,
          command: 'переснимите образец ровно, во весь кадр, при рассеянном свете',
          blocking: false,
        });
      }
    }
  }

  return { rows, attention };
}

export function unusedArtwork(library: ArtworkLibrary): Attention[] {
  try {
    return library
      .list()
      .filter((a) => a.used_in.length === 0)
      .map((a) => ({
        article: '—',
        what: `Рисунок «${a.id}» лежит в библиотеке и не использован ни в одном паке.`,
        command: `pnpm library ${a.id}`,
        blocking: false,
      }));
  } catch {
    return [];
  }
}

const STYLE = `
:root {
  --ink:#161616; --paper:#FFFFFF; --secondary:#8A8A85; --hairline:#E3E1DC;
  --bar:#111111; --canvas:#FBFAF8; --data-red:#B3261E; --confirm-green:#0D6E5F;
}
* { box-sizing:border-box }
body { margin:0; padding:32px 40px 64px; background:var(--canvas); color:var(--ink);
  font-family: Sora, "Helvetica Neue", Arial, sans-serif; font-size:14px; line-height:1.5 }
h1 { font-size:24px; font-weight:700; letter-spacing:-.02em; margin:0 0 4px }
h2 { font-size:15px; font-weight:700; margin:32px 0 10px }
.ml { font-size:11px; letter-spacing:.1em; text-transform:uppercase; font-weight:600; color:var(--secondary) }
.top { display:flex; gap:32px; align-items:baseline; border-bottom:2px solid var(--ink); padding-bottom:10px }
.tiles { display:flex; gap:32px; margin:20px 0 0 }
.tile .n { font-size:28px; font-weight:700; font-variant-numeric:tabular-nums }
table { width:100%; border-collapse:collapse; background:var(--paper); font-size:13px }
thead th { background:var(--bar); color:#fff; text-align:left; font-size:10px; letter-spacing:.1em;
  text-transform:uppercase; padding:8px 10px; white-space:nowrap }
tbody td { padding:9px 10px; border-bottom:1px solid var(--hairline); vertical-align:top }
td.num, th.num { text-align:right; font-variant-numeric:tabular-nums }
.mono { font-family:"JetBrains Mono", monospace; font-size:12px }
.cmd { font-family:"JetBrains Mono", monospace; font-size:12px; background:var(--canvas);
  border:1px solid var(--hairline); padding:2px 6px; display:inline-block; white-space:nowrap }
.blocking td { background:#FDF6F5 }
.dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px }
.dot.stop { background:var(--data-red) }
.dot.warn { background:transparent; border:1px solid var(--ink) }
.note { color:var(--secondary); font-size:12px; line-height:1.5 }
.empty { background:var(--paper); border:1px dashed var(--hairline); padding:24px; text-align:center; color:var(--secondary) }
`;

export function render(rows: Row[], attention: Attention[], rfq: string | null): string {
  const totalConfirmed = rows.reduce((a, r) => a + r.confirmed, 0);
  const totalPoints = rows.reduce((a, r) => a + r.points, 0);
  const sorted = [...attention].sort((a, b) => Number(b.blocking) - Number(a.blocking));

  const tile = (n: string, label: string): string =>
    `<div class="tile"><div class="n">${n}</div><div class="ml">${label}</div></div>`;

  const attentionBlock = sorted.length
    ? `<table><thead><tr><th></th><th>Артикул</th><th>Что не так</th><th>Что делать</th></tr></thead>` +
      `<tbody>${sorted
        .map(
          (a) =>
            `<tr class="${a.blocking ? 'blocking' : ''}">` +
            `<td><span class="dot ${a.blocking ? 'stop' : 'warn'}"></span></td>` +
            `<td class="mono">${esc(a.article)}</td><td>${esc(a.what)}</td>` +
            `<td><span class="cmd">${esc(a.command)}</span></td></tr>`,
        )
        .join('')}</tbody></table>` +
      `<div class="note" style="margin-top:8px">Красным — то, что закрывает выпуск: ` +
      `с этим пак нельзя отдавать. Остальное копится и разбирается по мере сил.</div>`
    : `<div class="empty">Ничего не требует внимания.</div>`;

  const table = rows.length
    ? `<table><thead><tr><th>Артикул</th><th>Модель</th><th>Категория</th>` +
      `<th class="num">Версий</th><th class="num">Подтверждено</th>` +
      `<th class="num">Предположений</th><th>Последнее изменение</th></tr></thead><tbody>` +
      rows
        .map(
          (r) =>
            `<tr><td class="mono">${esc(r.article)}</td><td>${esc(r.name)}</td>` +
            `<td>${esc(r.category)}</td><td class="num">${r.versions}</td>` +
            `<td class="num">${r.confirmed} из ${r.points}</td>` +
            `<td class="num">${r.assumptions}</td>` +
            `<td class="note">${r.last ? `${esc(r.last.created_at.slice(0, 10))} · ${esc(r.last.reason_ru)}` : '—'}</td></tr>`,
        )
        .join('') +
      `</tbody></table>`
    : `<div class="empty">Версий пока нет. Первая появится после ` +
      `<span class="cmd">pnpm generate --answers &lt;анкета&gt; --versions versions</span></div>`;

  return (
    `<!doctype html><html lang="ru"><head><meta charset="utf-8">` +
    `<title>Seamsterly — консьерж</title><style>${STYLE}</style></head><body>` +
    `<div class="top"><h1>Консьерж</h1>` +
    `<div class="ml">состояние на ${new Date().toISOString().slice(0, 16).replace('T', ' ')}</div></div>` +
    `<div class="tiles">` +
    tile(String(rows.length), 'изделий') +
    tile(String(rows.reduce((a, r) => a + r.versions, 0)), 'версий') +
    tile(
      totalPoints ? `${Math.round((totalConfirmed / totalPoints) * 100)}%` : '—',
      'точек подтверждено по образцу',
    ) +
    tile(String(sorted.filter((a) => a.blocking).length), 'закрывают выпуск') +
    `</div>` +
    `<h2>Требует внимания</h2>${attentionBlock}` +
    `<h2>Изделия</h2>${table}` +
    (rfq ? `<h2>Рассылка на просчёт (H1)</h2>${rfq}` : '') +
    `<div class="note" style="margin-top:40px">Панель ничего не запускает. Она собрана ` +
    `из тех же файлов, что пишут генератор и примерка, и называет следующую команду ` +
    `буквально — чтобы её можно было прочитать до запуска. Кнопка «перегенерировать всё» ` +
    `в режиме, где каждая генерация уходит фабрике, это не удобство, а способ однажды ` +
    `отправить не то.</div>` +
    `</body></html>`
  );
}

export function rfqBlock(path: string): string | null {
  if (!existsSync(path)) return null;
  const parsed = parseRfqLog(readFileSync(path, 'utf8'));
  if (!parsed.responses.length) return null;
  const s = summariseRfq(parsed.responses);
  const pct = (x: number): string => `${Math.round(x * 100)}%`;
  return (
    `<table><thead><tr><th class="num">Отправлено</th><th class="num">Ответили</th>` +
    `<th class="num">Берутся</th><th class="num">Цена, ₽</th><th class="num">MOQ</th>` +
    `<th class="num">Срок, дней</th></tr></thead><tbody><tr>` +
    `<td class="num">${s.sent}</td>` +
    `<td class="num">${s.replied} · ${pct(s.reply_rate)}</td>` +
    `<td class="num">${s.takes} · ${pct(s.take_rate)}</td>` +
    `<td class="num">${s.median_price ?? '—'}</td>` +
    `<td class="num">${s.median_moq ?? '—'}</td>` +
    `<td class="num">${s.median_lead_days ?? '—'}</td>` +
    `</tr></tbody></table>` +
    (parsed.problems.length
      ? `<div class="note" style="margin-top:8px">Не разобрано строк: ` +
        `${parsed.problems.length}. Молча терять их нельзя — проверьте журнал.</div>`
      : '')
  );
}

/** Полный отчёт: строки, внимание и готовая страница. */
export function buildAdminReport(
  store: VersionStore,
  library: ArtworkLibrary,
  rfqPath: string,
): { rows: Row[]; attention: Attention[]; html: string } {
  const { rows, attention } = collect(store);
  const all = [...attention, ...unusedArtwork(library)];
  const sorted = rows.sort((a, b) => a.article.localeCompare(b.article));
  return { rows: sorted, attention: all, html: render(sorted, all, rfqBlock(rfqPath)) };
}
