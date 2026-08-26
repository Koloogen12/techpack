# Блок 2. Технический рисунок (Technical Flat) — конвенции для SVG-генератора

## 1. Fashion sketch vs Technical flat

| Параметр    | Fashion sketch             | Technical flat                        |
| ----------- | -------------------------- | ------------------------------------- |
| Назначение  | Продать идею               | Однозначная инструкция фабрике        |
| Фигура      | На фигуре 8–10 голов, поза | Без фигуры, изделие «лежит плоско»    |
| Пропорции   | Искажённые                 | Реальные пропорции изделия, симметрия |
| Цвет        | Цвет, текстуры             | Ч/б, вектор, line-art                 |
| Детализация | Условная                   | Каждый шов, строчка, фурнитура        |

Источники: [FittDesign](https://www.fittdesign.com/blog/flat-design-sketches-vs-technical-sketches-key-differences-in-apparel-design), [Techpacker — Technical Flat Sketches](https://techpacker.com/blog/design/fashion-technical-flat-sketches/), [Techpack Wizard](https://techpackwizard.com/what-are-flats-in-fashion-design-and-why-they-re-important/).

## 2. Обязательные виды (views)

| Вид                  | Когда обязателен                                                              |
| -------------------- | ----------------------------------------------------------------------------- |
| Front                | Всегда                                                                        |
| Back                 | Всегда (даже если спинка гладкая)                                             |
| Side                 | Объём/боковая конструкция: пальто, бомберы, брюки с отделкой, сложные силуэты |
| Inside               | Подкладка, внутренние карманы, обтачки — верхняя одежда, костюмные            |
| Detail / close-up    | Воротник, манжета, карман, застёжка, необычный узел, placement принта         |
| 3/4 / поднятый рукав | Ластовицы, подмышечные вставки (опционально)                                  |

Источники: [Fashion Index](https://www.fashionindex.com/blog/apparel-tech-pack-technical-design-sketches), [Arcus AG](https://www.arcusag.com/fashion-design-sketches-that-manufacturers-understand/).

## 3. Толщины и типы линий (стандарт для SVG)

| Элемент                         | Линия                                   | Толщина (Illustrator)          |
| ------------------------------- | --------------------------------------- | ------------------------------ |
| Внешний силуэт (outline)        | Сплошная, самая толстая                 | 1.5–2 pt                       |
| Конструктивные швы (seam lines) | Сплошная, средняя                       | 0.75–1 pt                      |
| Отстрочка (topstitch)           | **Пунктир** (dashed), скруглённые концы | 0.5 pt, dash 2–3 pt            |
| Скрытые швы/элементы (hidden)   | Точечная (dotted)                       | 0.25–0.5 pt                    |
| Сгибы, фалды, драпировка        | Тонкая сплошная                         | 0.25–0.5 pt                    |
| Двойная отстрочка               | Две параллельные пунктирные             | 0.5 pt, зазор ~1 мм в масштабе |

«Outer silhouette heavier than interior details, stitches as dashed lines, hidden seams as dotted» — [Fashion Index](https://www.fashionindex.com/blog/apparel-tech-pack-technical-design-sketches), [Techpacker](https://techpacker.com/blog/design/fashion-technical-flat-sketches/), [Wearview glossary](https://www.wearview.co/glossary/flat-sketch).

## 4. Символьная библиотека элементов

| Элемент                 | Как рисуется                                                       |
| ----------------------- | ------------------------------------------------------------------ |
| Молния                  | Двойная линия с поперечными зубцами; бегунок явно; тип — в callout |
| Потайная молния         | Одинарная линия + callout «invisible zipper»                       |
| Пуговица                | Круг с 2/4 точками; диаметр в масштабе                             |
| Петля                   | I-образный отрезок с засечками; keyhole — с каплей                 |
| Кнопка                  | Круг с крестом / двойной круг + callout «snap»                     |
| Люверс                  | Двойной круг                                                       |
| Вытачка                 | Треугольник тонкими сплошными, вершина к выпуклости                |
| Сборка                  | Мелкие волнистые штрихи поперёк линии притачивания                 |
| Складки                 | Прямые линии + стрелка направления закладывания                    |
| Резинка/эластичная зона | «Гармошка» из волнистых линий                                      |
| Рибана/рубчик           | Частые параллельные тонкие линии вдоль детали                      |
| Кулиска со шнуром       | Туннель двумя линиями + шнур с наконечниками                       |
| Карман накладной        | Контур сплошной + пунктир отстрочки                                |
| Карман в шве/прорезной  | Линия входа + мешковина пунктиром (hidden)                         |
| Bartack (закрепка)      | Короткий жирный зигзаг в точке нагрузки                            |

⚠️ Формального стандарта обозначений (аналога ЕСКД для одежды) нет — зафиксировать **внутренний стандарт условных обозначений Seamsterly** на основе этой таблицы.

## 5. Callout-аннотации

- Выноски с **номерами** в кружках; лидерные линии тонкие, не пересекаются.
- Номер выноски = строка в таблице конструкции/BOM («1 — YKK #5 metal zip»).
- Текст не поверх рисунка — на полях.
- Placement принта/вышивки — стрелками с размерами от HPS/CF.

## 6. Чек-лист правил генерируемого флэта (спецификация генератора)

1. Front + Back всегда; side/inside/detail — по триггерам категории (§2).
2. Симметрия: рисовать половину, зеркалить (кроме асимметрии).
3. Пропорции — реальные, из POM-таблицы (соотношение ширины груди / длины изделия).
4. Минимум 3 уровня линий: outline > seams > stitches(dash)/hidden(dot).
5. Каждая видимая отстрочка = пунктир (кол-во строчек = кол-во пунктиров).
6. Вся фурнитура в масштабе и на месте; тип — в callout.
7. Нумерованные callouts, синхронизированные с BOM/конструкцией.
8. Ч/б, вектор, без заливок (серый — допустим для контрастной детали/рибаны).
9. Внутренние элементы — пунктиром или на inside view.
10. Подпись вида: FRONT / BACK / DETAIL A.

## Источники

[Techpacker — Flat Sketches](https://techpacker.com/blog/design/fashion-technical-flat-sketches/) · [FittDesign](https://www.fittdesign.com/blog/flat-design-sketches-vs-technical-sketches-key-differences-in-apparel-design) · [Fashion Index](https://www.fashionindex.com/blog/apparel-tech-pack-technical-design-sketches) · [Arcus AG](https://www.arcusag.com/fashion-design-sketches-that-manufacturers-understand/) · [Techpack Wizard](https://techpackwizard.com/what-are-flats-in-fashion-design-and-why-they-re-important/) · [Wearview](https://www.wearview.co/glossary/flat-sketch)
