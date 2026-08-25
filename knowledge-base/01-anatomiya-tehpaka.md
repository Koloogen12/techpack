# Блок 1. Анатомия техпака + Блок 8a. Форматы данных

> Места с тонкой фактурой помечены **[GAP]**.

## 1. Каноническая структура профессионального техпака (страница за страницей)

Tech pack = «чертёж» готового изделия, набор документов, по которому фабрика без устных пояснений шьёт образец и тираж; включает flat-эскизы, материалы/тримы/лейблы, measurement specs, градацию, colorways ([Techpacker — Ultimate Guide](https://techpacker.com/blog/design/what-is-a-tech-pack/)). Постраничная разбивка сведена из [Techpacker](https://techpacker.com/blog/design/what-is-a-tech-pack/), [Onbrand PLM — Tech Pack Template](https://www.onbrandplm.com/blog/tech-pack-template), [Techpacker — BOM Guide](https://techpacker.com/blog/design/bill-of-materials-how-to-create/).

### Стр. 1 — Cover / Style Summary

| Поле                                  | Пример / конвенция                               |
| ------------------------------------- | ------------------------------------------------ |
| Brand name + logo                     | —                                                |
| Style name                            | "Classic Crew Tee"                               |
| Style number / SKU                    | `CT-001` — уникальный, сквозной для всех страниц |
| Season / drop                         | `SS26`                                           |
| Product category                      | tee / hoodie / dress…                            |
| Fabrication (главная ткань, кратко)   | `100% cotton jersey, 200 GSM`                    |
| Size range + base size                | `XS–XL, base M`                                  |
| Designer / created by                 | —                                                |
| Version + date created / last updated | чтобы фабрика не работала по старому файлу       |
| Главный эскиз/фото                    | front view                                       |

### Стр. 2 — Technical Flats

- Front + back обязательно; side/inside — по необходимости; ч/б вектор без заливок и теней.
- Конвенция линий: **сплошная = шов (seam line), пунктирная = отстрочка (stitching)**.
- Callouts: стрелки-выноски с подписями зон, close-up фрагменты; при сложной детали — референс-фото.
- Правило: «не упоминай в техпаке деталь, которой нет на эскизе».

### Стр. 3 — BOM (Bill of Materials)

Колонки ([Techpacker BOM Guide](https://techpacker.com/blog/design/bill-of-materials-how-to-create/) — 14 элементов):

| Колонка               | Содержание                                           |
| --------------------- | ---------------------------------------------------- |
| Item #                | уникальный номер позиции                             |
| BOM level             | single-level vs multi-level (parent/child)           |
| Item name             | Main fabric / Lining / Zipper / Thread / Care label… |
| Placement             | body, cuff, CB neck…                                 |
| Description           | доп. заметки                                         |
| Content               | `100% cotton`                                        |
| Construction / weight | `jersey, 200 GSM`                                    |
| Size / width          | размер молнии, ширина резинки                        |
| Color                 | **Pantone-код обязателен**                           |
| Supplier              | имя + контакты                                       |
| Qty / usage           | расход на изделие                                    |
| UOM                   | pcs / cm / m                                         |
| Unit cost (+ scrap %) | опционально                                          |
| Approved by + date    | согласование                                         |

Группы позиций: main fabric, secondary fabric, interfacing, thread, trims/closures, labels (brand/size/care), hangtag, packaging. **BOM ведётся отдельно на каждый colorway.**

### Стр. 4 — POM / Measurement Spec (табель мер)

- Колонки: `POM code | POM name | как мерить | tolerance ± | base size | значения по размерам`.
- POM-диаграмма: flat со стрелками начало→конец каждого замера, коды рядом, линии контрастным цветом.
- Типовые допуски: chest ±0.5 см, body length ±0.5 см, sleeve ±0.3 см ([Kobo 101](https://www.kobolabs.io/tools/kobo-101)); детально — файл 03.

### Стр. 5 — Graded Spec

Как каждая POM меняется между размерами (grade increment); отдельные правила knit vs woven. На этапе fit sample достаточно base size; полный ряд — к size set.

### Стр. 6 — Construction Details

Тип строчки по зонам (overlock бок, single-needle подгибка, coverstitch манжеты), seam allowance, отступ отстрочки, bartack-точки, thread type, **SPI** (stitch density), обработка среза, wash treatment.

### Стр. 7 — Colorways

CAD/flat в каждом цвете, Pantone, colorway → своя BOM.

### Стр. 8 — Artwork / Print Placement

Точный размер и позиция («center chest print 3" below neckline»), техника (print/embroidery), файл арта.

### Стр. 9 — Labels & Packaging

Care/brand/size label + hangtag с **точным размещением**; способ складывания, polybag, barcode, кол-во в коробе.

### Стр. 10 — Cost Sheet (опционально)

### Стр. 11 — Sample Evaluation / Fit Comments

Fit Sheet: фактические замеры образца рядом с номиналом, проверка «в допуске / вне», корректировки.

### Стр. 12 — Revision History

Version, date, что изменено, автор.

### Ядро vs расширение

- **Обязательное ядро:** cover, flats front+back, BOM, POM + base size + tolerances, construction notes, labels.
- **Расширение:** full graded spec, colorways, artwork, packaging detail, costing, fit history, revision log.

**Живые эталоны (реальные PDF Techpacker):** [wrap dress](https://techpacker.com/pdf/wrap-dress/), [menswear jacket](https://techpacker.com/pdf/menswear-jacket/), [fitted denim](https://techpacker.com/pdf/fitted-denim/), [lingerie bodysuit](https://techpacker.com/pdf/lingerie-bodysuit/).

## 2. Минимально достаточный комплект: малый бренд → фабрика РФ

Список от РФ-производственника ([vc.ru — Перечень документов для швейного производства](https://vc.ru/u/1408245-brandman/584685-perechen-dokumentov-dlya-shveynogo-proizvodstva-ili-byurokratiya-dlya-brenda-odezhdy)) — в обиходе «ТЗ»:

1. **Технический эскиз** — все конструктивные и декоративные линии; допускается фото с расшифровкой.
2. **Описание внешнего вида модели** — вытачки, рельефы, кокетки, складки, карманы (форма, местоположение).
3. **Лекала** с градацией, **с заложенными припусками**; на лекалах: артикул, модель, контакты конструктора.
4. **Раскладка (схема кроя)**.
5. **Спецификация** — список деталей лекал и кроя.
6. **Конфекционная карта** — материалы и фурнитура.
7. **Таблица мер (табель мер)** — по размерам; используется ОТК.
8. **Технология**: припуски, ширины строчек; **схема дублирования и ВТО**.
9. **Расчётник расхода ткани и фурнитуры**.

Конвенция: **каждый пункт — на отдельном листе** (каждый отдел цеха берёт своё).

**Отличие РФ-комплекта от западного tech pack:** РФ-фабрика сверх техпака ждёт лекала с градацией, раскладку и расчёт расхода. Формализованный аналог всего техпака — **Техническое описание (ТО)** на модель ([реальная форма — infopedia](https://infopedia.su/15x14335.html)): описание внешнего вида; технические требования; спецификация материалов (`Наименование | Артикул | ГОСТ/ОСТ/ТУ | Назначение`); спецификация деталей (`деталь | кол-во лекал | кол-во деталей кроя`); таблица измерений в готовом виде (`Измерение | Рост | Величина по Ог | Допуск, см`); приёмка/маркировка (ГОСТ 10581); площади лекал; нормировочная карта расхода (ширина ткани, длина раскладки, % межлекальных выпадов); схема раскладки. **Конфекционная карта** традиционно — с физически приклеенными образцами тканей и фурнитуры.

**Вывод для SpecForm:** генерировать западное ядро + поля-заглушки под лекала/раскладку/расход («предоставляется конструктором»), терминология двуязычная.

## 3. Реляционная модель данных для алгоритма

Прототипы: карточная модель Techpacker (sketch/material/measurement cards, библиотеки, переиспользование) и PLM-модель ([Kobo 101](https://www.kobolabs.io/tools/kobo-101)): `Style → Variants (colorway) → SKUs`; **Version = стадия образца** (Proto · SMS · PP) — не путать с Variant; Components — переиспользуемая библиотека. **[GAP]** Схемы Centric/Backbone не публичны; Kobo — верифицированный прокси.

```
Brand(id, name, logo)
Season(id, code, name)

Style(id, brand_id, season_id, style_code UNIQUE, style_name, category,
      description, size_range, base_size, designer, lifecycle_status)

StyleRevision(id, style_id, version_no, date, author, change_summary, pdf_url)

Colorway(id, style_id, name, color_id, cad_image)      -- = Variant
Color(id, name, pantone_code, hex)

Material(id, ref_code, name, category(fabric|trim|label|packaging),
         composition, construction, weight_gsm, width, color_id,
         supplier_id, unit_cost, uom, gost_tu_article)  -- RU: артикул+ГОСТ/ТУ

BOMLine(id, colorway_id, material_id, bom_level, placement, description,
        qty_usage, uom, unit_cost, scrap_pct, confidence_flag)

Size(id, style_id, code, sort_order, is_base)
POMDef(id, style_id, pom_code, name, how_to_measure, tolerance_plus,
       tolerance_minus, diagram_ref)
POMValue(pom_def_id, size_id, value, confidence_flag)
GradeRule(pom_def_id, from_size_id, to_size_id, increment)

ConstructionOp(id, style_id, seq_no, placement, operation_name,
               stitch_code, seam_code, spi, seam_allowance, thread,
               machine, specialty(М|С|А|Р|У|П), notes, callout_image,
               assumption bool)
ArtworkPlacement(id, style_id, artwork_file, technique, width, height,
                 placement_text, offset_from_ref)
Label(id, style_id, type(brand|size|care|hangtag), material_id,
      placement, artwork_file, care_symbols)
PackagingSpec(id, style_id, fold_type, polybag_size, barcode, units_per_carton)

SampleRound(id, style_revision_id, round_type, sample_size_id,
            date_sent, date_received, status)
FitComment(id, sample_round_id, pom_def_id, spec_value, actual_value,
           delta, in_tolerance bool, comment, action, photo, status)

Supplier(id, name, contacts, lead_time)
SKU(id, colorway_id, size_id, sku_code, gtin_placeholder, barcode)
CostLine(id, style_id, type, amount, currency)
```

Ключевые связи: Style 1—N Colorway; Colorway 1—N BOMLine; Style 1—N POMDef; POMDef × Size → POMValue; Material N—M Style через BOMLine; StyleRevision 1—N SampleRound 1—N FitComment. Для РФ: `полнотная группа, роста` на Style.

## 4. Версионирование и sample rounds

Пайплайн образцов (обычно **5–7 раундов** до тиража) — [Techpacker — 12 Types of Samples](https://techpacker.com/blog/manufacturing/12-types-of-garment-samples-you-should-know-about-for-apparel-production/):

| #   | Sample       | Назначение                                            | Что требуется                  |
| --- | ------------ | ----------------------------------------------------- | ------------------------------ |
| 1   | **Proto**    | стиль/эстетика; ткань-заменитель допустима            | полный техпак, спека base size |
| 2   | **Fit**      | посадка; замеры точные                                | спека base size                |
| 3   | Size set     | градация, все размеры                                 | спека всего ряда               |
| 4   | SMS          | продажи                                               | —                              |
| 5   | GPT          | тесты (швы, окраска)                                  | требования тестов              |
| 6   | **PP**       | первый с производственной линии; апрув = старт тиража | финальная ревизия              |
| 7   | Sealed / TOP | эталон тиража / контроль тиража                       | —                              |

- Ревизия техпака инкрементируется на каждый sample round; анти-паттерн — «фабрика шьёт по V3, бренд правит V5».
- **Fit comments — поля строки:** POM code → spec → actual → delta → в допуске? → комментарий/действие → статус. **[GAP]** единого стандарта полей нет — синтез.

## 5. Форматы файлов

### DXF-AAMA / ASTM (лекала)

- ANSI/AAMA-292 → **ASTM D6673-10** «Sewn Products Pattern Data Interchange» ([iTeh](https://standards.iteh.ai/catalog/standards/astm/3ea6d7eb-457d-4601-8b2a-568fe262a910/astm-d6673-10), [текст PDF](https://www.normsplash.com/Samples/ASTM/191361149/ASTM-D6673-10-en.pdf)); отозван в 2019, но остаётся де-факто форматом обмена; поддержан всеми CAD ([Style3D](https://help.style3d.com/studio/en/c2c8/6cc0/60d0/a589), [ezdxf #789](https://github.com/mozman/ezdxf/discussions/789)).
- Структура ([Patro — DXF ASTM](https://fabricesalvaire.github.io/Patro/resources/file-format/dxf-astm.html)): база AutoCAD DXF R13; один стиль на файл; деталь = DXF block; grade rule table — отдельный ASCII-файл; **23 предопределённых номерных слоя**:

| Layer | Содержимое                        |
| ----- | --------------------------------- |
| 1     | Piece boundary (контур кроя)      |
| 2 / 3 | Turn / curve points               |
| 4     | Notches (надсечки)                |
| 5     | Grade reference lines             |
| 6     | Mirror line                       |
| 7     | **Grain line (долевая)**          |
| 8     | Internal lines                    |
| 11    | Internal cutouts                  |
| 13    | Drill holes                       |
| 14    | Sew lines                         |
| 15    | Annotation text                   |
| 80–87 | Спец. notches + validation curves |

- Для SpecForm: уметь ссылаться на DXF-файл в техпаке + знать словарь слоёв для валидации/превью. Нативные форматы CAD (Gerber `.zip/.plt`, Lectra `.mdl/.iba`, Optitex `.pds`) — passthrough. **[GAP]** — расширения не верифицированы fetch'ем.

### PDF-экспорт

Стандарт передачи фабрике. **[GAP]** размер страницы — конвенция, не стандарт: де-факто **landscape A4/US Letter, одна секция = одна страница** (по примерам Techpacker). Зафиксировать как продуктовое требование.

### SVG / вектор для flats

Ч/б, без заливок; раздельные стили линий (сплошная = шов, штрих = отстрочка); закрытые контуры; слои front/back/callouts. Технически: [Patro — SVG](https://fabricesalvaire.github.io/Patro/resources/file-format/svg.html).

## 6. Словарь RU ↔ EN

| EN                        | RU                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| Tech pack                 | комплект технической документации / «ТЗ на пошив»; формализованно — Техническое описание (ТО) |
| Technical flat            | технический эскиз (рисунок)                                                                   |
| Design description        | описание внешнего вида модели                                                                 |
| BOM                       | конфекционная карта / спецификация материалов и фурнитуры                                     |
| POM sheet                 | табель мер / таблица измерений в готовом виде                                                 |
| Tolerance                 | допустимое отклонение (допуск)                                                                |
| Grading                   | размерная градация (размеры, роста, полнотные группы)                                         |
| Pattern                   | лекала                                                                                        |
| Marker                    | раскладка (схема кроя)                                                                        |
| Piece list                | спецификация деталей и лекал                                                                  |
| Construction notes        | последовательность технологической обработки                                                  |
| Fusing diagram            | схема дублирования и ВТО                                                                      |
| Consumption               | норма расхода; % межлекальных выпадов                                                         |
| Trims                     | фурнитура                                                                                     |
| Interfacing               | прокладочные (дублерин, флизелин)                                                             |
| QC                        | ОТК                                                                                           |
| Seam allowance            | припуск на шов                                                                                |
| Grain line                | долевая                                                                                       |
| Size / height / fit group | размер / рост / полнотная группа                                                              |

## 7. Источники

[Techpacker — Ultimate Guide](https://techpacker.com/blog/design/what-is-a-tech-pack/) · [Onbrand — Tech Pack Template](https://www.onbrandplm.com/blog/tech-pack-template) · [Techpacker — BOM](https://techpacker.com/blog/design/bill-of-materials-how-to-create/) · [Techpacker — 12 Samples](https://techpacker.com/blog/manufacturing/12-types-of-garment-samples-you-should-know-about-for-apparel-production/) · [Kobo 101](https://www.kobolabs.io/tools/kobo-101) · [Patro — DXF ASTM](https://fabricesalvaire.github.io/Patro/resources/file-format/dxf-astm.html) · [ASTM D6673-10](https://standards.iteh.ai/catalog/standards/astm/3ea6d7eb-457d-4601-8b2a-568fe262a910/astm-d6673-10) · [vc.ru — Перечень документов](https://vc.ru/u/1408245-brandman/584685-perechen-dokumentov-dlya-shveynogo-proizvodstva-ili-byurokratiya-dlya-brenda-odezhdy) · [infopedia — формы ТО и конфекционной карты](https://infopedia.su/15x14335.html) · [bstudy — Конфекционные карты](https://bstudy.net/879534/tehnika/konfektsionnye_karty)
