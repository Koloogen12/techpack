# Блок 3. POM, размерные сетки, градация, допуски, оценка замеров с фото

> ⚠️ Полные тексты ГОСТ закрыты для автоматической выгрузки — цифры ГОСТ даны по вторичным источникам; спорные места помечены ⚠️.

## 1. Общие правила измерения и допусков

- Замеры — по изделию flat, застёгнутому; half-measures (ширина в плоском виде), если не указано circumference. [Apparel Wiki — How to Measure](https://apparel.wiki/blog/measure-garment-standard-pom/)
- Крупные обхватные точки ±1/2" (±1.3 см), мелкие ±1/8…1/4" (±0.3–0.6 см). [Techpacker — Fit Quality](https://techpacker.com/blog/design/how-to-use-tech-packs-to-improve-garment-fit-quality-3/), [Apparel Wiki — Tolerance](https://apparel.wiki/blog/understanding-tolerance-in-garment-measurements/)
- Трикотаж — допуски шире; стрейч мерится relaxed и extended.
- Референсные стандарты методик: ASTM D5219, ISO 8559.

**Дефолтная шкала допусков для генератора (см):**

| Класс точки                                            | Ткань    | Трикотаж |
| ------------------------------------------------------ | -------- | -------- |
| Большие ширины (chest, waist, hip, sweep)              | ±1.0     | ±1.0–1.5 |
| Длины изделия (HPS length, CB length, in/outseam)      | ±1.0     | ±1.0–1.5 |
| Средние (shoulder, armhole, bicep, thigh, rise)        | ±0.5–0.6 | ±0.6–1.0 |
| Мелкие (neck, cuff, sleeve opening, waistband, pocket) | ±0.3     | ±0.3–0.5 |

## 2. Библиотека POM по категориям

### 2.1. Футболка / трикотажный топ

| #   | POM                         | RU                          | Как мерить                                          | Допуск   |
| --- | --------------------------- | --------------------------- | --------------------------------------------------- | -------- |
| T01 | HPS Length                  | Длина от высшей точки плеча | От HPS вертикально до низа                          | ±1.0     |
| T02 | CB Length                   | Длина по центру спинки      | От шва горловины по CB до низа                      | ±1.0     |
| T03 | Chest 1" below armhole      | Ширина по груди             | На 2.5 см ниже проймы, шов-до-шва (half)            | ±1.0     |
| T04 | Waist                       | Ширина по талии             | Самая узкая точка / фикс. от HPS                    | ±1.0     |
| T05 | Bottom Sweep                | Ширина по низу              | По краю низа                                        | ±1.0     |
| T06 | Across Shoulder             | Ширина плеч                 | Плечевая точка — плечевая точка по спинке           | ±0.6     |
| T07 | Across Front                | Ширина переда               | На фикс. высоте (12–15 см от HPS), пройма-до-проймы | ±0.6     |
| T08 | Across Back                 | Ширина спинки               | Аналогично                                          | ±0.6     |
| T09 | Armhole (curved/straight)   | Пройма                      | По кривой шва / хордой                              | ±0.6     |
| T10 | Sleeve Length from Shoulder | Длина рукава от плеча       | От плечевой точки до края                           | ±0.6     |
| T11 | Sleeve Length from CB       | Длина рукава от CB          | Через плечо (регланы/dropped)                       | ±1.0     |
| T12 | Bicep                       | Ширина рукава под проймой   | На 2.5 см ниже проймы                               | ±0.6     |
| T13 | Sleeve Opening              | Низ рукава                  | По краю flat                                        | ±0.3–0.5 |
| T14 | Neck Width                  | Ширина горловины            | Между плечевыми швами                               | ±0.3     |
| T15 | Front Neck Drop             | Глубина горловины переда    | От линии HPS-HPS до шва по CF                       | ±0.3     |
| T16 | Back Neck Drop              | Глубина горловины спинки    | По CB                                               | ±0.3     |
| T17 | Neck Rib Height             | Высота бейки                | —                                                   | ±0.2     |
| T18 | Shoulder Slope              | Наклон плеча                | Вертикаль от HPS-линии до плечевой точки            | ±0.3     |

### 2.2. Худи / свитшот — 2.1 плюс:

| #   | POM                                | Как мерить                              | Допуск |
| --- | ---------------------------------- | --------------------------------------- | ------ |
| H01 | Hood Height                        | От шва втачивания до верхней точки flat | ±1.0   |
| H02 | Hood Width                         | Поперёк в широком месте                 | ±0.6   |
| H03 | Hood Opening                       | По переднему краю                       | ±1.0   |
| H04 | Kangaroo Pocket Width (top/bottom) | По верхнему/нижнему краям               | ±0.5   |
| H05 | Kangaroo Pocket Height             | По центру                               | ±0.5   |
| H06 | Pocket Opening                     | По диагональному краю                   | ±0.5   |
| H07 | Bottom Rib Height                  | Высота пояса-рибаны                     | ±0.3   |
| H08 | Cuff Rib Height                    | Высота манжеты                          | ±0.3   |
| H09 | Cuff Opening (relaxed)             | Flat без растяжения                     | ±0.3   |
| H10 | Drawcord Length                    | Видимая часть с каждой стороны          | ±1.0   |
| H11 | Eyelet Position from CF            | До центра люверса                       | ±0.3   |

### 2.3. Рубашка

2.1 (T01–T16) + Collar Length (±0.3), Collar Point (±0.2), Collar Stand Height (±0.2), Yoke Depth (±0.5), Cuff W×H (±0.3), Placket Width (±0.2), Pocket W×H + placement (±0.3), Tail Drop (±0.5), Button Spacing (±0.3).

### 2.4. Платье

2.1 + Waist Position from HPS (±1.0) | Hip 18–23 см ниже талии (±1.0) | Skirt Length от шва талии (±1.0) | Total Length from HPS (±1.0–1.5) | Slit Length (±0.5) | Zipper Length (±0.5) | Strap L/W (±0.3) | Sweep (±1.5 расклешённые).

### 2.5. Брюки / джинсы

| #   | POM                         | RU                | Как мерить                                     | Допуск                 |
| --- | --------------------------- | ----------------- | ---------------------------------------------- | ---------------------- |
| B01 | Waist Relaxed               | Талия в покое     | По верхнему краю пояса flat (half)             | ±0.6–1.0 (джинсы ±1.3) |
| B02 | Waist Extended              | Талия растянутая  | Эластичный пояс при растяжении                 | ±1.0                   |
| B03 | Waistband Height            | Высота пояса      | —                                              | ±0.3                   |
| B04 | High Hip                    | 10 см от пояса    | Поперёк                                        | ±0.6                   |
| B05 | Low Hip / Seat              | 18–20 см от пояса | Поперёк                                        | ±1.0                   |
| B06 | Front Rise                  | Посадка перед     | От crotch point по среднему шву до верха пояса | ±0.6                   |
| B07 | Back Rise                   | Посадка зад       | Аналогично                                     | ±0.6                   |
| B08 | Thigh                       | Бедро             | 2.5 см ниже шагового шва                       | ±0.6                   |
| B09 | Knee                        | Колено            | На фикс. уровне (30–35 см от crotch)           | ±0.6                   |
| B10 | Leg Opening                 | Низ брючины       | По краю flat                                   | ±0.5                   |
| B11 | Inseam                      | Шаговый шов       | Crotch → низ по внутреннему шву                | ±1.0                   |
| B12 | Outseam                     | Боковой шов       | Верх пояса → низ                               | ±1.0                   |
| B13 | Fly Length                  | Гульфик           | Верх пояса → нижняя закрепка                   | ±0.5                   |
| B14 | Belt Loop L×W + spacing     | Шлёвки            | —                                              | ±0.3                   |
| B15 | Pockets opening + placement | Карманы           | От бокового шва/пояса                          | ±0.3–0.5               |
| B16 | Hem Height                  | Подгибка низа     | —                                              | ±0.2                   |

### 2.6. Юбка

B01–B05 + Skirt Length CB и side (±1.0) | Sweep (±1.0–1.5) | Dart L/Position (±0.3) | Slit/Vent (±0.5) | Zip (±0.5) | Lining Length (короче верха на 2–3 см).

### 2.7. Верхняя одежда

2.1 (допуски шире на объёмных зонах) + CF Zip Length (±1.0) | Collar Height CB + Point (±0.3) | Lapel Width (±0.3) | Elbow Width (±0.6) | Cuff Opening + Tab (±0.3–0.5) | Pocket placement от CF и низа (±0.5) | Hood H01–H03 | Lining POM отдельно | Quilting spacing — шаг стёжки (±0.3) | Storm Flap W×L (±0.5). Рукав часто from CB (трёхточечно), ±0.7–1.0.

### 2.8. Леггинсы

Waist relaxed/extended (±1.0/±1.5) | Front/Back Rise (±0.6) | Thigh, Knee (±0.6) | Leg Opening relaxed (±0.4) | Inseam (±1.0) | Gusset L×W (±0.3) | Waistband Height (±0.3). Все обхватные — relaxed + extended.

Обучающие сводники: [Successful Fashion Designer — Graded Specs](https://successfulfashiondesigner.com/how-to-create-graded-specs-in-a-garment-tech-pack/), [Techpacker — Sizing e-book (PDF)](https://techpacker.com/blog/content/files/2023/03/Ebook-How-to-master-apparel-sizing-and-measuring--1-.pdf), [Delogue — POM](https://www.delogue.com/en/blog/how-to-spec-a-garment-with-points-of-measure).

## 3. Размерные сетки

### 3.1. Российская типология

- **Женщины — ГОСТ 31396-2009**: ведущие признаки рост / Ог3 / Об; обозначение **164-92-98**. Рост с шагом **6 см** (152–176), размер по Ог с шагом **4 см**; «российский размер» = Ог/2. Полнотные группы по разнице Об−Ог с шагом 4 см. ⚠️ Точные разницы по группам сверить с [PDF ГОСТ](https://meganorm.ru/Data/505/50536.pdf) / [Гарант](https://base.garant.ru/57968844/). Карточка: [allgosts](https://allgosts.ru/61/020/gost_31396-2009).
- **Мужчины — ГОСТ 31399-2009**: рост / Ог / От; **176-100-88**; рост 158–200, Ог 84–132, От 66–126; 301 типовая фигура, 5 полнотных групп. [allgosts](https://allgosts.ru/61/020/gost_31399-2009), [Гарант](https://base.garant.ru/57968850/).

### 3.2. Женская сетка малого бренда (42–52, база 164–170), см

| RU  | Ог  | От    | Об (легаси) | INT | EU  | US  |
| --- | --- | ----- | ----------- | --- | --- | --- |
| 42  | 84  | 64–66 | 92          | XS  | 36  | 4   |
| 44  | 88  | 68–70 | 96          | S   | 38  | 6   |
| 46  | 92  | 72–74 | 100         | M   | 40  | 8   |
| 48  | 96  | 76–78 | 104         | L   | 42  | 10  |
| 50  | 100 | 80–82 | 108         | XL  | 44  | 12  |
| 52  | 104 | 84–86 | 112         | XXL | 46  | 14  |

Правила: RU = Ог/2; **EU (нем.) = RU − 6**; буквенные шкалы варьируются на ±1 ступень — в техпаке фиксировать сантиметрами, буквы как ярлык. Мужская: RU = EU; 48=M; US numeric = грудь в дюймах. Источники: [star-tex](https://star-tex.ru/article/notes/tablicy-razmerov-odezhdy/), [sheitesnami](https://sheitesnami.ru/razmernye-tablicy-odezhdy), [furtek](https://furtek.ru/tablitsy-sootnoshenija-razmerov-i-abbreviatury-na-jarlykax).

**Правило для алгоритма:** внутренняя модель = сантиметровые обхваты тела (Ог/От/Об/рост); все ярлыки (46 / M / EU40) — маппинг поверх.

### 3.3. Прибавки на свободу облегания (ease)

Русская школа: прибавка Пг к полуобхвату груди; минимум: платье 2, жакет 3, пальто 4 см. По силуэтам (к полуобхвату): прилегающий 1–3, полуприлегающий 3–5, свободный 6–10+. Источники: [Season.ru](https://season.ru/patterns/techniques-for-constructing-patterns/pribavki-na-svobodnoe-obleganie.html), [BlogPortnoy](https://blogportnoy.ru/merki-pribavki/tablicy-pribavok-na-svobodnoe-obleganie.html), [Vikisews](https://vikisews.com/blog/pribavki-na-svobodu-obleganija/).

**Дефолты генератора — полный обхват изделия минус Ог тела, см (⚠️ экспертная эвристика, калибровать по реальным size charts):**

| Силуэт          | Футболка            | Рубашка | Худи   | Платье | Куртка | Пальто |
| --------------- | ------------------- | ------- | ------ | ------ | ------ | ------ |
| Прилегающий     | 0…+6 (стрейч до −4) | +6…10   | —      | +2…6   | +8…12  | +10…14 |
| Полуприлегающий | +8…12               | +10…14  | +12…16 | +6…10  | +12…18 | +14…20 |
| Свободный       | +14…20              | +16…22  | +18…26 | +12…18 | +20…28 | +22…30 |
| Oversize        | +24…40              | +26…40  | +28…45 | +20…35 | +30…50 | +30…50 |

## 4. Градация

### 4.1. Постулаты (ЦНИИШП / ЕМКО СЭВ)

- Отдельно по размерам и по ростам; только внутри одной полнотной группы; от базового размеророста. Неизменны: прибавки, долевые, посадка оката, припуски. [Mirlekal](http://mirlekal.ru/page15)
- Промышленный стандарт — пропорционально-расчётный способ. [WellConstruction](https://wellconstruction.clothing/konstr3/gradatsiya-lekal-proportsionalno-raschetnyim-sposobom), учебник: [ИВГПУ PDF](https://ivgpu.ru/images/docs/ob-universitete/instituty-fakultety-kafedry/ti/fakultety-kafedry/fttiim/kshi/publikatsii/111.pdf)
- Межразмерный шаг по Ог = 4 см.

### 4.2. Типовые межразмерные приращения (RU, ⚠️ практические дефолты)

| POM                                           | Приращение / размер                       |
| --------------------------------------------- | ----------------------------------------- |
| Обхваты изделия (грудь/талия/бёдра)           | +4.0 (half +2.0)                          |
| Распределение half: спинка / пройма / полочка | +0.5 / +0.5 / +1.0                        |
| Across shoulder                               | +1.0…1.2                                  |
| Плечевой шов                                  | +0.3                                      |
| Ширина горловины                              | +0.4…0.5 (half +0.2)                      |
| Глубина горловины                             | +0.1…0.2                                  |
| Глубина проймы                                | +0.4…0.5                                  |
| Bicep                                         | +1.2…2.0                                  |
| Длина рукава                                  | +0.3…0.5 (по размеру); +1.5…2 на ростовку |
| Длина изделия                                 | +0.5…1.0 (размер); +2…3 на ростовку       |
| Inseam                                        | 0…+0.5 (размер); +3…4 на ростовку         |
| Rise                                          | +0.5…0.7                                  |
| Thigh / knee / leg opening                    | +1.2…1.6 / +1.0 / +0.6…1.0                |

**Западная alpha-градация («2-inch grade»):** chest/waist/hip +5 см на размер XS–L, +6.5–7.5 для XL+; across shoulder +1–1.25; длины +0.6–1.25; sleeve +0.6–1; neck +0.3–0.6. [SFD — Graded Specs](https://successfulfashiondesigner.com/how-to-create-graded-specs-in-a-garment-tech-pack/), [Apparel Wiki — Grading Rules](https://apparel.wiki/blog/grading-rules-how-sizes-expand-base-pattern/).

### 4.3. Трикотаж vs ткань

Трикотаж «съедает» часть прибавки растяжимостью → grade меньше; допуски шире; relaxed/extended. Рибаны градируются меньше основного полотна. Усадка закладывается ДО градации (спека = после стирки). [Apparel Wiki — Knits vs Wovens](https://apparel.wiki/blog/knit-pattern-vs-woven-pattern/)

### 4.4. Когда градация ломается

1. **>2–3 размеров от базы** — накопление ошибки; база в середине ряда, грейд ±2–3 размера. [Mirlekal](http://mirlekal.ru/page15)
2. **Plus-size** — линейное масштабирование не работает; отдельная база и свои правила. [Apparel Wiki — Plus Size](https://apparel.wiki/blog/plus-size-grading-why-you-cant-just-scale-up/)
3. Смена полнотной группы/ростовки = новый комплект лекал.
4. Неградируемые элементы: карманы, воротники (по концам), манжеты, планки, фурнитура — константа или ступенчато.
5. Ошибка базового размера умножается на весь ряд.

## 5. Оценка замеров с фото — стратегия алгоритма

### 5.1. Фундаментальные ограничения

- **Абсолютные см по одному фото — нельзя** (монокулярная неоднозначность масштаба). Точный обмер = keypoints + датчик глубины: HRNet + LiDAR point cloud, средняя ошибка 1.59–2.08% ([MDPI Applied Sciences 2022](https://www.mdpi.com/2076-3417/12/10/5286), [код](https://github.com/ZinoStudio931/Automatic-Garments-Size-Measurement-using-HRNet-and-Point-Cloud)).
- **Можно с фото**: категория; силуэт/fit-класс; относительные пропорции (длина/ширина, рукав/длина, taper); конструктивные элементы.
- Смежные работы: [SPnet — sewing patterns from single image](https://arxiv.org/pdf/2312.16264), [Deep Fashion3D](https://ar5iv.labs.arxiv.org/html/2003.12753), [US 11080918](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11080918).

### 5.2. Пайплайн генерации POM-значений

1. **Классификация** категории → шаблон POM из §2 (точки, how-to-measure, допуски — автоматом).
2. **Keypoint-детекция** (HPS, плечи, подмышки, низ, края рукавов, талия, crotch) → **безразмерные отношения** (T01/T03, T06/T03, B10/B08…).
3. **Опорный масштаб — из базы, не из фото**: пользователь называет базовый размер («M / RU 46») + fit-intent → сетка тела (§3.2) + ease (§3.3) → якорь chest; остальные POM = якорь × пропорции с фото, с клэмпом в диапазоны категории.
4. **Усилители точности** (опционально): предмет-референс в кадре (А4/карта); один ручной замер (линейно калибрует всё); LiDAR (~2%).
5. **Градация** от базы по §4.2; допуски из §1.
6. **Confidence-флаги**: `measured / estimated-from-photo / default-from-base`; блок «TO CONFIRM AT PROTO».
7. **Всегда спрашиваем**: базовый размер + рост; fit-intent; трикотаж/ткань; единицы.
8. **Никогда не оцениваем с фото**: усадку, растяжимость, GSM, внутренние размеры.

## Gaps

1. Таблицы ГОСТ 31396/31399 не выкачаны — сверить по [PDF](https://meganorm.ru/Data/505/50536.pdf).
2. Схемы приращений ЦНИИШП по точкам — распарсить [ИВГПУ PDF](https://ivgpu.ru/images/docs/ob-universitete/instituty-fakultety-kafedry/ti/fakultety-kafedry/fttiim/kshi/publikatsii/111.pdf).
3. Ease-таблица §3.3 — эвристика, калибровать по size charts брендов.
4. Допуски — бренд-специфичны; шкала §1 — синтез, для люкса ужимать.
