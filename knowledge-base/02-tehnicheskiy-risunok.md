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

⚠️ Формального стандарта обозначений (аналога ЕСКД для одежды) нет — зафиксировать **внутренний стандарт условных обозначений Seamster** на основе этой таблицы.

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

## 7. Пропорции: эталонные диапазоны и как они замерены

Правило §6.3 «пропорции — реальные, из POM-таблицы» до августа 2026 не было
ничем измерено: генератор проверялся на связность (боковой шов на половине
ширины, правка замера двигает разметку), но никто не сравнивал ГОТОВЫЙ чертёж
с профессиональным флэтом. Из-за этого длинный рукав полгода рисовался
отведённым в сторону под 32° и давал лист вдвое шире своей высоты.

**Отведение длинного рукава.** Контуры двух профессиональных флэтов сняты
попиксельно по порогу яркости, угол посчитан по хорде от плечевой точки
до крайней точки рукава: худи — 65.6°, свитшот — 69.9° к горизонтали
(посегментно 59–88°: рукав сужается к манжете и к низу идёт почти отвесно).
Вывод, который важнее самого числа: **на техническом флэте длинный рукав висит
ВДОЛЬ корпуса, а не отведён в сторону.** Отсюда же следует, что ширина рукава
под проймой НА ЧЕРТЕЖЕ заметно меньше замера T12 — при 68° она составляет
около трети его, и это нормально для флэта: ткань у проймы подобрана. Замер
берётся из табеля мер, о чём на листе сказано отдельной оговоркой.

**Где лежат диапазоны.** `packages/kb/data/flat_conventions.json`, массив
`proportions`: у каждой величины источник, границы и метка достоверности.
Проверяются тестом `packages/flats/test/proportions.test.ts` на всех категориях
и всех посадках. Величины с источником: длина изделия к ширине по груди,
ширина плеч к ширине по груди, длина рукава к длине изделия, низ рукава
к ширине по груди, отношение каждого нарисованного размера к табличному.

**Чего в открытых данных нет.** Ширину рукава под проймой (T12), пройму,
ширину горловины, размеры капюшона, кармана и высоты рибан не публикует
ни один блэнк-бренд — проверены Gildan, Comfort Colors, Champion, Sport-Tek,
Independent Trading, Bella+Canvas, LAT, AS Colour, Stanley/Stella, Iron Heart,
DIFUZED. LAT Apparel — единственный, кто эти точки хотя бы ОПРЕДЕЛЯЕТ
(«Hood Height: measure from top to bottom of hood opening»), но значений
не даёт. Это отраслевое молчание, а не недосмотр поиска: такие числа живут
только внутри фабричных техпаков.

⚠️ Ловушка при сборе эталонов: «Sleeve Length» у разных брендов означает три
разные величины — от центра спинки (Gildan, Comfort Colors, Sport-Tek),
от плечевой точки (Stanley/Stella), от шва проймы (LAT). Разница около 25 см.
Наш T10 — от плечевой точки, и сравнивать его можно только с последними двумя.

Источники замеров: [флэт худи](https://www.fashiondesign411.com/wp-content/uploads/004-mens-pullover-hoodie-sweatshirt-kangaroo-pocket-flat-sketch.webp) · [флэт свитшота](https://www.fashiondesign411.com/wp-content/uploads/1008-Knits-Menswear-Fashion-Sketches-Template.webp) · [Points of Measure — масштаб чертежа](https://www.pointsofmeasure.com/tutorials-education/how-to-draw-technical-flats-by-hand) · [Stanley/Stella STTU755](https://api.stanleystella.com/ProductSheet/en_US/STTU755.pdf) · [Iron Heart IHSW-49](https://ironheart.co.uk/products/ihsw-49-olv) · [LAT Measuring Guide](https://www.latapparel.com/live/documents/MeasuringGuideforWeb.pdf) · [DIFUZED](https://blog.difuzed.com/wp-content/uploads/2021/03/DIFUZED-Measurement-sheets-Apparel-Men.pdf)

## Источники

[Techpacker — Flat Sketches](https://techpacker.com/blog/design/fashion-technical-flat-sketches/) · [FittDesign](https://www.fittdesign.com/blog/flat-design-sketches-vs-technical-sketches-key-differences-in-apparel-design) · [Fashion Index](https://www.fashionindex.com/blog/apparel-tech-pack-technical-design-sketches) · [Arcus AG](https://www.arcusag.com/fashion-design-sketches-that-manufacturers-understand/) · [Techpack Wizard](https://techpackwizard.com/what-are-flats-in-fashion-design-and-why-they-re-important/) · [Wearview](https://www.wearview.co/glossary/flat-sketch)
