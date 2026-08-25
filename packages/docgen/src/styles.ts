/**
 * Стили документа.
 *
 * Токены — из `design_handoff_specform/README.md` (решение CEO D1). Здесь они
 * живут в одном месте, а не разбросаны по разметке: то же требование, что и
 * к веб-интерфейсу (CTO-SPEC.md §4.a п.2).
 *
 * Документ печатается на A4 в альбомной ориентации, секция — страница
 * (knowledge-base/01 §1). Модульность под цех: табель мер уходит в ОТК,
 * спецификация закройщику, расчётник снабжению.
 */
export const DOC_CSS = `
:root {
  --ink: #0E0E0E;
  --paper: #FFFFFF;
  --data-red: #C0392B;
  --confirm-green: #2F7C5A;
  --lib-grey: #B0ADA6;
  --secondary: #6B6B67;
  --tertiary: #5A5A56;
  --hairline: #E4E1DC;
  --hairline-row: #EFEDE9;
}

@page { size: A4 landscape; margin: 0; }

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: Sora, "Helvetica Neue", Arial, sans-serif;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.page {
  width: 297mm;
  height: 210mm;
  padding: 12mm 14mm;
  page-break-after: always;
  break-after: page;
  position: relative;
  display: flex;
  flex-direction: column;
}
.page:last-child { page-break-after: auto; break-after: auto; }

.kicker {
  font-size: 8.3pt;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--secondary);
}

h1 { font-size: 20pt; font-weight: 700; margin: 2mm 0 1mm; letter-spacing: -0.4px; }
h2 { font-size: 12pt; font-weight: 700; margin: 0 0 3mm; }
h3 { font-size: 9.5pt; font-weight: 700; margin: 4mm 0 2mm; }

.page-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom: 1px solid var(--hairline);
  padding-bottom: 2.5mm;
  margin-bottom: 4mm;
}
.page-head .meta { font-family: "JetBrains Mono", monospace; font-size: 8pt; color: var(--tertiary); }

.page-foot {
  position: absolute;
  left: 14mm; right: 14mm; bottom: 6mm;
  display: flex;
  justify-content: space-between;
  font-family: "JetBrains Mono", monospace;
  font-size: 7pt;
  color: var(--lib-grey);
  border-top: 1px solid var(--hairline-row);
  padding-top: 2mm;
}

/* Данные изделия печатаются красным — сквозная семантика продукта. */
.v { font-family: Inter, Arial, sans-serif; font-weight: 300; color: var(--data-red); }
.mono { font-family: "JetBrains Mono", monospace; font-variant-numeric: tabular-nums; }

table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
th {
  text-align: left;
  font-size: 7.4pt;
  letter-spacing: 0.9px;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--secondary);
  padding: 1.6mm 2mm;
  border-bottom: 1px solid var(--hairline);
  white-space: nowrap;
}
td { padding: 1.4mm 2mm; border-bottom: 1px solid var(--hairline-row); vertical-align: top; }
td.num { text-align: right; font-family: "JetBrains Mono", monospace; font-variant-numeric: tabular-nums; }
tr.pro { background: rgba(14,14,14,.02); }

/* Статусы уверенности: точка перед значением, одинаково на всех страницах. */
.dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
.dot-fit_confirmed { background: var(--confirm-green); }
.dot-user_input { background: var(--confirm-green); }
.dot-estimated_from_photo { background: var(--ink); }
.dot-default_from_base { background: var(--lib-grey); }
.dot-assumption { background: var(--data-red); box-shadow: 0 0 0 2px rgba(192,57,43,.16); }

.legend { display: flex; gap: 7mm; flex-wrap: wrap; font-size: 8pt; color: var(--tertiary); }
.legend b { font-weight: 600; color: var(--ink); }

.card {
  border: 1px solid var(--hairline);
  border-radius: 3mm;
  padding: 4mm 5mm;
}
.card.warn { border-color: var(--data-red); }
.card.warn .kicker { color: var(--data-red); }

.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; }

.passport { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm 6mm; }
.passport .label { font-size: 7.4pt; letter-spacing: 0.9px; text-transform: uppercase; color: var(--secondary); }
.passport .value { font-family: Inter, Arial, sans-serif; font-weight: 300; font-size: 10pt; color: var(--data-red); }

.flat { display: flex; gap: 10mm; align-items: center; justify-content: center; flex: 1; }
.flat figure { margin: 0; text-align: center; flex: 1; }
.flat svg { width: 100%; height: auto; max-height: 130mm; }
.flat figcaption { margin-top: 3mm; font-size: 7.4pt; letter-spacing: 1.4px; text-transform: uppercase; color: var(--secondary); }

.note { font-size: 8pt; color: var(--tertiary); line-height: 1.45; }
.note.warn { color: var(--data-red); }

ul.plain { margin: 0; padding-left: 4mm; font-size: 8.5pt; line-height: 1.5; }
ul.plain li { margin-bottom: 1mm; }

.placeholder {
  flex: 1;
  border: 1px dashed var(--lib-grey);
  border-radius: 3mm;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 3mm;
  padding: 10mm;
}

.swatch { display: inline-block; width: 9px; height: 9px; border-radius: 2px; border: 1px solid var(--hairline); vertical-align: middle; margin-right: 4px; }

.flag {
  display: inline-block;
  font-size: 7.4pt;
  font-weight: 700;
  letter-spacing: 0.6px;
  color: var(--data-red);
  border: 1px solid var(--data-red);
  border-radius: 2mm;
  padding: 0.4mm 1.6mm;
  white-space: nowrap;
}
`;
