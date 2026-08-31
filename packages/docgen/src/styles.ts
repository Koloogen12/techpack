/**
 * Печатные стили документа.
 *
 * Полиграфическая система взята с эталона отраслевой вёрстки: мастхед,
 * мета-полоса, «один смысловой блок — одна страница», холсты-карточки
 * для чертежей, микро-лейблы капсом в разрядку, чёрные шапки таблиц,
 * трёхчастный футер. Содержание при этом целиком наше: статусы значений,
 * допуски, коды швов, примечания.
 *
 * Чего у эталона НЕ берём — его болезни: страницы без данных ради полноты
 * (заголовок «Grading» над пустым чертежом), дубли строк, тавтологичные
 * заглушки вроде «Care Label: Care label». У нас заглушка всегда говорит,
 * что сюда придёт и откуда.
 *
 * Токены — из `design_handoff_specform/README.md` (решение CEO D1).
 * Документ печатается на A4 в альбомной ориентации.
 */
export const DOC_CSS = `
:root {
  --ink: #161616;
  --paper: #FFFFFF;
  --secondary: #8A8A85;
  --hairline: #E3E1DC;
  --bar: #111111;
  --canvas: #FBFAF8;
  --data-red: #B3261E;
  --confirm-green: #0D6E5F;
  --photo-blue: #4A6CF7;
  --lib-grey: #8A8A85;
}

@page { size: A4 landscape; margin: 0; }

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: Sora, "Helvetica Neue", Arial, sans-serif;
  font-size: 9pt;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.page {
  width: 297mm;
  height: 210mm;
  padding: 14mm;
  page-break-after: always;
  break-after: page;
  position: relative;
  display: flex;
  flex-direction: column;
}
.page:last-child { page-break-after: auto; break-after: auto; }

/* --- Микро-лейбл: главный приём системы. Им подписано всё. --- */
.ml {
  font-size: 7pt;
  line-height: 1.2;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--secondary);
}

/* --- Мастхед: бренд КЛИЕНТА слева, раздел справа. --- */
.masthead {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding-bottom: 2.5mm;
  border-bottom: 2pt solid var(--ink);
}
.masthead .brand { font-size: 12pt; font-weight: 700; letter-spacing: -0.01em; }
.masthead .role {
  display: inline-block;
  border: 0.5pt solid var(--secondary);
  border-radius: 1mm;
  padding: 0.4mm 1.4mm;
  margin-left: 3mm;
}

/* --- Мета-полоса: документ самоидентифицируется на каждой странице. --- */
.meta {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 4mm;
  padding: 2.5mm 0;
  border-bottom: 0.5pt solid var(--hairline);
  margin-bottom: 5mm;
}
.meta .value { font-size: 9pt; margin-top: 0.8mm; }

/* Нижний отступ равен высоте футера: футер позиционирован абсолютно
   и в поток не входит, поэтому без запаса содержимое ложится на него. */
.body { flex: 1; min-height: 0; display: flex; flex-direction: column; padding-bottom: 9mm; }

/* --- Футер: три части. Seamster живёт здесь, а не в шапке. --- */
.foot {
  position: absolute;
  left: 14mm; right: 14mm; bottom: 7mm;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6mm;
  padding-top: 2mm;
  border-top: 0.5pt solid var(--hairline);
  font-size: 6.6pt;
  letter-spacing: 0.06em;
  color: var(--secondary);
}
.foot .legend { display: flex; gap: 4mm; flex-wrap: wrap; justify-content: center; }

h1 { font-size: 19pt; font-weight: 700; margin: 0 0 2mm; letter-spacing: -0.02em; }
h2 { font-size: 11pt; font-weight: 700; margin: 0 0 3mm; }
h3 { font-size: 8.5pt; font-weight: 700; margin: 4mm 0 2mm; }

/*
 * --- Статус значения: ФОРМА плюс цвет. ---
 *
 * Пак печатают на чёрно-белом лазернике в цеху, и статус, отличающийся
 * только цветом, там исчезает. Поэтому у каждого статуса своя фигура,
 * и цвет только усиливает её.
 */
.dot {
  display: inline-block;
  width: 2.2mm;
  height: 2.2mm;
  margin-right: 1.4mm;
  vertical-align: -0.2mm;
  border: 0.5pt solid var(--ink);
  border-radius: 50%;
}
.dot-fit_confirmed { background: var(--confirm-green); border-color: var(--confirm-green); }
.dot-user_input {
  background: radial-gradient(var(--confirm-green) 0 35%, transparent 36%);
  border-color: var(--confirm-green);
}
.dot-measured_by_scale {
  background: linear-gradient(90deg, var(--photo-blue) 0 50%, transparent 50%);
  border-color: var(--photo-blue);
}
.dot-estimated_from_photo { background: transparent; border-color: var(--ink); }
.dot-default_from_base { border-radius: 0; border-color: var(--secondary); background: transparent; }
/* Треугольник: единственная фигура без круга — её видно и краем глаза. */
.dot-assumption {
  border: none;
  border-radius: 0;
  width: 0; height: 0;
  border-left: 1.2mm solid transparent;
  border-right: 1.2mm solid transparent;
  border-bottom: 2.2mm solid var(--data-red);
}

.legend-item { white-space: nowrap; }

/* --- Данные изделия. Красим ЗНАЧЕНИЕ, а не всю строку. --- */
.v { font-variant-numeric: tabular-nums; }
.mono { font-family: "JetBrains Mono", monospace; font-variant-numeric: tabular-nums; font-size: 8pt; }

/* --- Таблицы: чёрная шапка, hairline-строки, щедрый паддинг. --- */
table { width: 100%; border-collapse: collapse; font-size: 8.2pt; }
thead th {
  background: var(--bar);
  color: #fff;
  text-align: left;
  font-size: 6.8pt;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-weight: 600;
  padding: 2mm 2.2mm;
  white-space: nowrap;
}
tbody td {
  padding: 2.2mm 2.2mm;
  border-bottom: 0.5pt solid var(--hairline);
  vertical-align: top;
  line-height: 1.35;
}
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
/* Значение и его сноска не переносятся: перенос ставит номер сноски
   на отдельную строку, и он читается как отдельное число. */
td.nowrap { white-space: nowrap; }
td.mark { width: 6mm; text-align: center; }
tr { break-inside: avoid; }

/* Плоская таблица без шапки — для паспортов и параметров. */
table.plain thead th { background: transparent; color: var(--secondary); }
table.plain td.k { width: 34mm; color: var(--secondary); font-size: 7.6pt; padding-top: 2.4mm; }

/* --- Холст-карточка: чертёж «лежит на столе студии». --- */
.canvas {
  flex: 1;
  min-height: 0;
  border: 0.5pt solid var(--hairline);
  background: var(--canvas);
  padding: 6mm;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8mm;
  position: relative;
}
/* Только ПРЯМОЙ потомок: иначе селектор ловит и подписи видов внутри
   figure, и все они складываются в один угол. */
.canvas > .ml { position: absolute; top: 4mm; left: 5mm; }
.canvas figure { margin: 0; flex: 1; text-align: center; min-width: 0; }
.canvas svg { width: 100%; height: auto; max-height: 118mm; }
.canvas img { max-width: 100%; max-height: 118mm; object-fit: contain; display: block; margin: 0 auto; }
.canvas figcaption { margin-top: 3mm; }

.note { font-size: 7.6pt; color: var(--secondary); line-height: 1.45; }
.note.warn { color: var(--data-red); }
.note b { color: var(--ink); font-weight: 600; }

/*
 * Заглушка всегда называет, ЧТО сюда придёт и ОТКУДА.
 * «Care label: care label» — это не заглушка, а тавтология.
 */
.tbc { color: var(--secondary); font-style: italic; }

/* --- Сноски под таблицей вместо примечаний в ячейках. --- */
.fn { margin-top: 3mm; font-size: 7pt; color: var(--secondary); line-height: 1.4; }
.fn li { margin-bottom: 0.6mm; }
.fn ol { margin: 0; padding-left: 4mm; }
sup.fn-ref { font-size: 6pt; font-weight: 700; color: var(--ink); margin-left: 0.6mm; }

.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; flex: 1; min-height: 0; }
.cover { display: grid; grid-template-columns: 1.5fr 1fr; gap: 8mm; flex: 1; min-height: 0; }
/* Список узлов на обложке — анонс раздела конструкции, где он есть целиком.
   Поэтому при нехватке места сжимается он, а не описание изделия:
   описание живёт только здесь. */
.cover ul.dash { overflow: hidden; min-height: 0; }

.card { border: 0.5pt solid var(--hairline); padding: 5mm; }
.card.warn { border-color: var(--data-red); }

ul.plain { margin: 0; padding-left: 3.6mm; font-size: 8pt; line-height: 1.5; }
ul.plain li { margin-bottom: 1.2mm; }

/* Ключевые элементы конструкции — списком с тире, как в эталоне. */
ul.dash { margin: 0; padding: 0; list-style: none; font-size: 8pt; line-height: 1.45; }
ul.dash li { margin-bottom: 1.4mm; padding-left: 3.4mm; text-indent: -3.4mm; }
ul.dash li::before { content: '— '; color: var(--secondary); }

.placeholder {
  flex: 1;
  border: 0.5pt dashed var(--secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 3mm;
  padding: 10mm;
}

.swatch {
  display: inline-block;
  width: 3mm; height: 3mm;
  border: 0.5pt solid var(--hairline);
  vertical-align: -0.3mm;
  margin-right: 1.4mm;
}

.flag {
  display: inline-block;
  font-size: 6.8pt;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--data-red);
  border: 0.5pt solid var(--data-red);
  padding: 0.4mm 1.4mm;
  white-space: nowrap;
}

/* --- Внешний вид: визуализация и снимки заказчика рядом. --- */
.preview { display: grid; grid-template-columns: 1.35fr 1fr; gap: 8mm; flex: 1; min-height: 0; }
.preview figure { margin: 0; display: flex; flex-direction: column; min-height: 0; }
.preview .frame {
  flex: 1;
  min-height: 0;
  border: 0.5pt solid var(--hairline);
  background: var(--canvas);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.preview .frame img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
.preview figcaption { margin-top: 2.5mm; }
.preview .shots { display: grid; gap: 4mm; min-height: 0; }
.preview.single { display: flex; justify-content: center; }
.preview.single figure { align-items: center; max-width: 100%; }
.preview.single .frame { width: auto; align-self: center; }
.preview.single .frame img { height: 100%; width: auto; max-width: 100%; }

/*
 * --- Колорвеи: карточка на цвет. ---
 *
 * Образец полотна показан КАК ЕСТЬ, без обработки: это снимок того, что
 * бренд держал в руках, и подкрашивать его значило бы подменить
 * единственный вещественный вход по цвету.
 */
.cw-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; flex: 1; min-height: 0; }
.cw { border: 0.5pt solid var(--hairline); padding: 4mm; display: flex; flex-direction: column; min-height: 0; }
.cw-top { display: flex; gap: 3mm; align-items: center; margin-bottom: 3mm; }
.cw-swatch {
  width: 14mm; height: 14mm;
  border: 0.5pt solid var(--hairline);
  overflow: hidden;
  flex: none;
}
.cw-swatch img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* Цвет не задан — клетка, а не серый квадрат: серый читался бы как цвет. */
.cw-empty {
  background-image: linear-gradient(45deg, var(--hairline) 25%, transparent 25%),
    linear-gradient(-45deg, var(--hairline) 25%, transparent 25%);
  background-size: 3mm 3mm;
}
.cw .frame, .cw-flat {
  flex: 1;
  min-height: 0;
  border: 0.5pt solid var(--hairline);
  background: var(--canvas);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
  padding: 2mm;
}
.cw .frame img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
.cw-flat svg { width: 100%; height: auto; max-height: 100%; }
.cw table.plain { margin-top: 2.5mm; font-size: 7.6pt; }
.cw table.plain td { padding: 1mm 0; border-bottom: none; }
.cw table.plain td.k { width: 26mm; padding-top: 1mm; }

/*
 * --- Раскладка раппорта на чертеже. ---
 *
 * Те же правила, что у холста чертежа: колонки задаются пропорцией flex,
 * и все виды выходят в одном масштабе. Без этих правил браузер верстал
 * рисунки умолчаниями — во всю ширину листа один под другим.
 */
.flat { display: flex; gap: 8mm; align-items: center; justify-content: center; flex: 1; min-height: 0; }
.flat figure { margin: 0; text-align: center; min-width: 0; }
.flat svg { width: 100%; height: auto; max-height: 100mm; }
.flat figcaption { margin-top: 2.5mm; }

/* --- Конструкция: две колонки по зонам, а не простыня. --- */
.zones { display: grid; grid-template-columns: 26mm 1fr; gap: 3mm 5mm; align-items: start; }
.node { margin-bottom: 3.5mm; }
.node .name { font-weight: 600; font-size: 8.4pt; }
.node .desc { font-size: 7.8pt; color: var(--secondary); line-height: 1.4; margin-top: 0.6mm; }
.node .params { font-size: 7.8pt; margin-top: 1mm; font-variant-numeric: tabular-nums; }
.node .params .sep { color: var(--hairline); margin: 0 1.2mm; }
`;
