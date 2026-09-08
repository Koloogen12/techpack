# Референс: Draw & Erase у SpecForm OS · разбор 8 сентября 2026

Прокликано на паке «Test Brand – Hoodie QA» (specform.pro, аккаунт с кредитами).
События вводились программно (PointerEvent на холст): клики мышью через
расширение до холста не доходили. Здесь — что и как у них устроено, и наши
решения. Ассеты панели у них процедурные (иконки Lucide, превью пресетов
рисуются на canvas), копировать нечего и незачем: иконки берём из Lucide
(ISC), пресеты рисуем сами.

## Устройство

- Редактор встроен в карточку иллюстрации (`sf-editor-surface draw-edit-inline`,
  866×570, белый, радиус 14). Рисунок и правки — один `<canvas>` 1536×1024
  (CSS 848×565, dpr 2), второй такой же скрытый (буфер). Никакого SVG.
- Плавающая тёмная пилюля инструментов (`sf-toolpill`, `role=toolbar`) с ручкой
  перетаскивания (`grip-vertical`), названием «Edit drawing», группой
  инструментов, галереей пресетов, ползунком веса, кнопками действий.
  Под ней строка-подсказка `sf-tipbar` (`role=status aria-live=polite`, иконка
  `info`) — меняется по инструменту.
- Кнопки 28×29, радиус 15 (пилюли), активная — белая с чёрной иконкой,
  остальные прозрачные с белой иконкой на тёмном. Пресеты 56×32, радиус 8,
  активный залит чёрным. Переходы .14s, `scale(.95)` на нажатии.

## Инструменты и клавиши

| Инструмент | Клавиша | Подсказка (дословно) |
|---|---|---|
| Pen tool | P | Pen: click to add points, click-drag to curve. Enter, Esc, or ✓ finishes the line — the next click starts a new one. Hold Space to pan. |
| Selection – move whole line | V | Selection: click a line and drag to move the whole line. Backspace deletes the selected line. |
| Direct Selection – move a point | A | Direct Selection: drag any single point or handle to reshape a line you already drew. Backspace deletes the point. |
| Anchor Point – drag mid-line to curve | C | Anchor: drag the middle of a segment to bow it into a curve; click an anchor to snap it back to a sharp corner. |
| Eraser – remove a wrong line | E | Eraser: paint over any wrongly generated line to remove it. Undo (Ctrl+Z) brings it back. |
| Hand – pan the view | H / Space | Hand: drag to move around the drawing. Also works anywhere: hold Space and drag, or drag with the middle mouse button. Ctrl/Cmd + scroll zooms at the cursor. |

Действия: Confirm line (Enter) · Undo (Ctrl+Z) · Redo (Shift+Ctrl+Z) · Clear all
edits · Zoom out / 100% / Zoom in (шаг 30 %) · Cancel · Save · ×.

## Пресеты строчек (7)

Straight line · Lockstitch (dashed) · Double-needle lockstitch · Zig-zag stitch ·
Coverstitch · 5-thread safety stitch · Flatlock stitch. Превью — canvas 100×52
(46×24 CSS), рисуются кодом. Вес: ползунок 1–40, показ «4px · 0.4%»
(проценты — доля высоты холста 1024). В режиме ластика галерея пропадает,
ползунок становится размером ластика («Eraser · 12px · 1%»).

## Поведение

- Перо: клик ставит опорную точку (синий квадрат 8 px), между точками прямые;
  Enter завершает линию; следующий клик — новая линия. Первая точка выделена.
- Выделение двигает всю линию; прямое выделение — точку; якорь гнёт сегмент.
- **Ластик стирает исходный растр** (закрашивает белым), не только свои линии.
- **Save запекает всё в растр**: `POST /api/jobs/{id}/asset_candidates/upload_correction`,
  иллюстрация становится `cand_illustration_v2`, под картинкой появляется
  пилюля версий (Version 1 / Version 2, стрелки, корзина «Delete this image»).
  После сохранения линии **больше не редактируются** как векторы: повторное
  открытие видит только пиксели.
- Cancel закрывает без подтверждения и молча теряет правки.
- Страница опрашивает сервер каждые ~5 с (`GET /api/jobs`, `POST …/measurement_annotations`).
- Вкладка Compare рядом с иллюстрацией = наш «референс рядом с рисунком»
  (Reference 1/2 слева, Tech Illustration справа).

## Соседние инструменты панели EDIT

- **Regenerate** (5 кредитов): «Detecting garment parts…» → детали подсвечиваются,
  инструменты Box selection · Lasso selection · Select garment parts · Undo last
  selection · Clear selection; после выбора зоны — поле «Describe the change…»,
  прикрепление файла, цена «5», кнопка Apply.
- **Add Logo** (бесплатно): «Upload a logo — PNG with transparency works best» /
  Choose from gallery; пилюля «Place logo on technical drawing · Upload logo ·
  Gallery · Download · Save to pack»; подсказка: drag to position, corner handles
  scale and rotate, the pill holds opacity and background removal.

## Наши решения

1. **Слой правок — вектор, навсегда редактируемый.** Правки хранятся JSON рядом
   с эскизом (`sketch-edits.json`, координаты в долях листа), рисуются SVG поверх
   растра и в кабинете, и в документе, и в вырезках видов (viewBox по границам
   вида). Ничего не запекается: исходный эскиз не трогается.
2. **Ластик не портит исходник.** Стирание — белые штрихи того же слоя: их можно
   снять, подвинуть, отменить через год.
3. **Сохранение = версия с откатом** (история JSON, до 20 записей), Cancel с
   подтверждением при несохранённых правках.
4. **Пресеты — из нашего справочника стежков**: сплошная (шов), отстрочка 301,
   двухигольная 301, зигзаг 304, распошив 406, оверлок 504, плоский шов 607.
   Подписи по-русски с кодом ГОСТ/ISO.
5. Инструменты и клавиши — как у них (это индустриальная норма из Illustrator):
   перо, выделение, точка, кривая, ластик, рука; Enter/Esc, Ctrl+Z, Space.
6. Панель — на токенах дизайн-системы (стекло, `--sf-shadow-float`), иконки Lucide.
7. Regenerate и Add Logo — не сейчас: у нас узлы правятся данными и эскиз
   перерисовывается по узлам и фото; логотип относится к разделу нанесения.
