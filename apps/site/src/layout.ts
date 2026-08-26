/**
 * Оболочка и стили ревью-сайта.
 *
 * Токены те же, что у документа: человек открывает сайт и открывает пак,
 * и они обязаны выглядеть одним продуктом. Разъехавшиеся палитры читаются
 * как «сайт сделал один подрядчик, документ другой».
 */

export function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
}

/**
 * `depth` — на сколько уровней страница лежит глубже корня сайта.
 *
 * Ссылки относительные намеренно: сайт должен одинаково работать и в корне
 * домена, и под префиксом вроде `/review/`. Абсолютный путь к стилям
 * привязал бы сборку к одному конкретному размещению, и перенос сломал бы
 * оформление молча — страница осталась бы читаемой, но чужой.
 */
export function layout(title: string, body: string, script = '', depth = 0): string {
  const up = depth === 0 ? '' : '../'.repeat(depth);
  return (
    `<!doctype html><html lang="ru"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex,nofollow">` +
    `<title>${esc(title)}</title>` +
    `<link rel="stylesheet" href="${up}styles.css">` +
    `</head><body><main>${body}</main>${script}</body></html>`
  );
}

export const SITE_CSS = `
:root {
  --ink:#161616; --paper:#FFFFFF; --secondary:#8A8A85; --hairline:#E3E1DC;
  --canvas:#FBFAF8; --data-red:#B3261E; --confirm-green:#0D6E5F;
}
* { box-sizing:border-box }
body { margin:0; background:var(--canvas); color:var(--ink);
  font-family: Sora, "Helvetica Neue", Arial, sans-serif; font-size:15px; line-height:1.55 }
main { max-width:1120px; margin:0 auto; padding:40px 24px 96px }
h1 { font-size:32px; font-weight:700; letter-spacing:-.02em; margin:0 0 8px }
h2 { font-size:18px; font-weight:700; margin:40px 0 10px }
a { color:inherit }
.ml { font-size:11px; letter-spacing:.1em; text-transform:uppercase; font-weight:600; color:var(--secondary) }
.sub { color:var(--secondary); font-size:14px; margin-bottom:24px }
.note { color:var(--secondary); font-size:14px; line-height:1.6; max-width:70ch }
.note.lead { font-size:16px; color:var(--ink); margin:12px 0 28px }
.note b { color:var(--ink) }
.back { display:inline-block; color:var(--secondary); font-size:13px; text-decoration:none; margin-bottom:12px }
.back:hover { color:var(--ink) }

.cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:16px; margin-top:8px }
.card { display:block; background:var(--paper); border:1px solid var(--hairline); padding:18px 20px;
  text-decoration:none; transition:border-color .15s }
.card:hover { border-color:var(--ink) }
.card .name { font-size:18px; font-weight:700; margin:6px 0 4px }
.card .meta { color:var(--secondary); font-size:13px }

.bar { display:flex; align-items:center; gap:8px; margin:8px 0 12px; flex-wrap:wrap }
.tabs { display:flex; gap:8px; flex-wrap:wrap; align-items:center }
.tab { padding:7px 14px; border:1px solid var(--hairline); background:var(--paper);
  text-decoration:none; font-size:14px; cursor:pointer }
.tab.on { background:var(--ink); color:var(--paper); border-color:var(--ink) }
.chip { padding:6px 12px; border:1px solid var(--hairline); background:var(--paper);
  text-decoration:none; font-size:13px; color:var(--secondary) }
.chip:hover { color:var(--ink); border-color:var(--ink) }
.chips { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px }

iframe { width:100%; height:78vh; border:1px solid var(--hairline); background:var(--paper) }

.verdict { background:var(--paper); border:1px solid var(--hairline); padding:24px; margin-top:16px; max-width:70ch }
.verdict .row { display:flex; gap:20px; flex-wrap:wrap; margin-bottom:20px }
.verdict label { font-size:14px }
.verdict .grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:14px }
.verdict .f { display:flex; flex-direction:column; gap:5px }
.verdict .f span { font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--secondary); font-weight:600 }
.verdict input[type=text], .verdict input:not([type]), .verdict textarea {
  font:inherit; font-size:14px; padding:9px 11px; border:1px solid var(--hairline); background:var(--canvas); width:100% }
.verdict textarea { resize:vertical }
.verdict button { margin-top:16px; font:inherit; font-size:15px; font-weight:600; padding:11px 22px;
  background:var(--ink); color:var(--paper); border:0; cursor:pointer }
.verdict button:hover { background:#000 }
.verdict .note { margin-top:12px }
.ok { background:var(--paper); border:1px solid var(--confirm-green); padding:24px; max-width:70ch }

@media (max-width:640px) {
  main { padding:24px 16px 64px }
  h1 { font-size:26px }
  .verdict .grid { grid-template-columns:1fr }
  iframe { height:62vh }
}
`;
