# Аудит SpecForm OS (specform.pro) — прямой проход, 8 сентября 2026

Метод: живой аккаунт Данила, Chrome, каждый экран — скриншот + дерево доступности.
Фиксируется всё: кнопки, поля, состояния, тексты, ограничения, что за деньги.

## 0. Главный экран (/)

**Верхняя плашка:** «Get priority access when you subscribe to Beta Plans!» + кнопка Upgrade → /subscription.
**Сайдбар:** Workspace · «Total: 0 Collections, 1 Pack» · Quick Actions (раскрываемый, счётчик 1 — внутри «Repeat Print Maker» с зелёной точкой) · Collections (0) · Recent packs (1: «Trucker Jacket», превью перед/спинка, зелёная точка = готов) · внизу кнопка UPGRADE и e-mail пользователя (кнопка — меню).
**Герой:** «From concept to production, with clarity.» · «Hi, <имя>, welcome back.» · «Choose the fastest route for this garment. Quick actions stay inside the same draft, so you can continue into the full tech-pack workflow later.» — ключевая идея: быстрые действия НЕ отдельные инструменты, а входы в тот же черновик.
**CTA:** CREATE TECH PACK.
**Quick actions (4):** Create Technical Drawing · Create 3D Renders · Repeat Print Maker · Virtual Fitting.
**Правая вертикальная панель (6 иконок):** New Tech Pack · Technical Drawing · 3D render · Repeat print maker · Virtual fitting · Open gallery (отделена чертой).
**Mochi** — «Chat with Mochi, your fashion assistant» — плавающий аватар справа внизу.

Наблюдение: у нас кабинет — порт того же прототипа, экран визуально почти идентичен. Разница будет в глубине.

## 1. Галерея (Open gallery)

Модалка с двумя вкладками: **Gallery** («SpecForm-generated assets, by type») — группы TECH PACKS (1) и PRINT DESIGNS (1), карточки с датой; **My Uploads** («Your own logos, prints and references — reuse them in any pack», кнопка Upload, счётчик 0). Сортировка: Last edited / Newest first / Oldest first.
→ Идея: единое хранилище активов бренда (логотипы, принты, референсы), переиспользуемое между паками. У нас — нет.

## 2. Экран пака (/?pack=<uuid>) — Trucker Jacket

**Вкладки окна:** Home · «Trucker Jacket · Style B3BA…» (закрываемая) · New tech pack. Паки открываются как вкладки браузера внутри приложения.
**Шапка:** CURRENT TECH PACK · имя · бейдж COMPLETED · «Style B3BA2B3E-BEDE… · Version 1.0 · Updated 25 Aug, 05:15» · пейджер разделов «1 / 9» со стрелками · тумблер «Preview mode (read-only)» (замочек) · Translate · Export · «…» Pack actions.
**Левый вертикальный навигатор:** 9 tab'ов-чёрточек = 9 разделов документа.
**Шапка документа (редактируемые поля):** «+ LOGO» (Add brand logo) · BRAND · STYLE NO. · FABRIC · DATE · SEASON · DESCRIPTION · SAMPLE SIZE · заголовок TECHNICAL PACKAGE.
  - Поля от AI подписаны «(AI-suggested — edit to confirm)» и показаны **красным** (Fabric «Corduroy / Ribbed Cot», Date 2026-08-25, Description «Jacket», Sample Size «M»). Пустые — BRAND, STYLE NO., SEASON. → У них два состояния (AI / человек), у нас пять уровней уверенности. Но их «красное = не подтверждено» читается мгновенно.
**Раздел 1 — вкладки:** TECH ILLUSTRATION · 3D RENDERS · SVG · VIRTUAL FITTING · COLOURWAY · COMPARE (оранжевый, выделен).
**Панель над картинкой:** «(?) Watch tutorial: Edit tools» · EDIT ▾ · REPLACE · GALLERY · Download.
**Картинка:** три вида — перед, **бок**, спинка. Вельветовый тракер-жакет: воротник, кокетки, нагрудные карманы с клапанами, пуговицы, манжеты. Качество — уровень CAD-флэта, сопоставимо с нашим новым эскизом.
**Версии картинки:** внизу пейджер «Version 1 / Version 2» со стрелками и «Delete this image». → Перегенерации хранятся версиями, можно листать и удалять. У нас — один эскиз.
**Page settings** — отдельная кнопка.

### 2.1 Меню пака и картинки

**«…» More actions (в шапке пака):** поле «Search coming soon» · Review (SOON) · Copy link (SOON) · Rename pack · Lock edits (тумблер) · Revision history · Move to trash.
  → «Review» и «Copy link» — заявлены, не сделаны. Шаринг по ссылке у них ещё НЕТ (у нас есть). Revision history — есть отдельный экран, надо проверить, что внутри.
**Меню пака в сайдбаре (⋮):** Open · Rename · Add to ▸ (в коллекцию) · Duplicate (серый, недоступен) · Delete.
**Translate:** тултип «Translate the whole workspace for your factory». Список языков (прокручиваемый): Chinese, Japanese, Korean, Hindi, Bengali, Turkish, Vietnamese, Italiano, Français, Português… → Перевод ВСЕГО рабочего пространства, не только документа. Языков ≥10, ориентир на фабрики Азии (хинди, бенгали, вьетнамский, турецкий — производственные страны). У нас: ru/en/zh.
**Export:** тултип «Export the tech pack». Два пункта: **Tech pack PDF** · **Measurement sheet**. → Только PDF и лист замеров. Ролевых выгрузок (ОТК / раскрой / снабжение) нет. RFQ нет.
**EDIT ▾ над картинкой** раскрывает панель инструментов: **Draw & Erase** («Open pen & eraser tool (free)») · **Regenerate** («Open regenerate area tool (5 credits)») · **Add Logo** («Place a logo on this asset (free)»). Подпись: «Pick a tool to edit this asset in place. Every edit saves as a new version you can roll back.»
  → Ключевое: правка картинки НА МЕСТЕ — рисовать/стирать пером, перегенерировать выделенную ОБЛАСТЬ (inpainting за 5 кредитов), ставить логотип. Каждая правка — новая версия с откатом. У нас этого нет вообще.
**REPLACE** — заменить картинку (своей?). **GALLERY** — выбрать из галереи. **Download** — скачать картинку.
**Цены в UI:** прямо в тултипах — «free» / «5 credits». Прозрачность стоимости на каждой кнопке.

### 2.2 Структура документа — 9 разделов (левый навигатор, раскрывается по hover)

01 Cover — Style + visuals · 02 Construction — Make details · 03 BOM — Materials · 04 Measurements — POM + grade · 05 Graphics & Prints — Artwork uploads · 06 Colourway — Colour + fabric variants · 07 Artwork — Generated assets · 08 Review — Confirm details · 09 PDF Tech Pack — Preview.
Шапка документа (бренд/артикул/ткань/дата/сезон/описание/размер) повторяется на каждом разделе. Внизу каждого — «Autosaves as you edit». Сайдбар показывает тариф: FREE PLAN.

### 2.3 Раздел 02 Construction

«+ ADD CALLOUT ROW». Таблица: # · CALLOUT / FEATURE · DETAILS · STITCH · IMAGE · 🗑. 11 строк для тракер-жакета: Center Front Placket, Front & Back Yoke Seams, Chest Flap Pockets, Collar Construction, Sleeve Cuff & Placket, Waistband Finish, Center Front Placket (ДУБЛЬ), Chest Flap Pocket (ДУБЛЬ), Collar Edge, Panel Topstitching, Sleeve Cuff (ДУБЛЬ по смыслу).
Колонка STITCH — код ISO (301, 304, 401) с мини-пиктограммой стежка; у одной строки пусто. Колонка IMAGE — слот под картинку узла (пустой). Details — свободный текст («Double-needle topstitched flat-felled seam», «1/4" topstitch around collar perimeter…»).
→ У них: узлы = свободный текст + ISO-код стежка, генерируются с дублями, без машины, без кода шва (ISO 4916), без техпоследовательности, без нормы времени. У нас: узлы из справочника, коды стежка И шва, машина, схема шва в разрезе, техпоследовательность на трёх языках. Здесь мы глубже — но у них есть слот под картинку узла и добавление строки руками.

### 2.4 Раздел 03 BOM

«+ ADD BOM ROW» · «SUPPLIER» (отдельная кнопка — видимо, поля поставщика). Таблица: # · COMPONENT · MATERIAL / FIBER (две строки: описание + состав) · COLOR · PANTONE (селектор с квадратиком цвета) · EST USAGE · IMAGE · 🗑.
Строки: Fabric — 100% Cotton heavy brushed moleskin, Blue, PANTONE 2587 C, 1.8 m · Contrast Fabric — 12-wale fine corduroy, Brown, PANTONE 126 C, 0.3 m · Pocketing — twill, Brown, 126 C, 0.4 m · Interfacing — woven fusible, [TBC], [TBC], 0.6 m · Buttons — engraved metal tack/shank, [TBC], 12 pcs · Size Label — woven, White, PANTONE 434 C, 1 pcs. Оранжевые точки у строк — метка AI.
Внизу «COST PER GARMENT — Costing coming in early 2027».
→ **EST USAGE появился** (в июле расход не считали). Оценки правдоподобные (1.8 м основной ткани на жакет). [TBC] — их способ пометить неизвестное. Pantone у каждой строки — у нас цвета есть, Pantone нет. Себестоимость — обещают в 2027. Артикулов/поставщиков в строках нет (кнопка SUPPLIER отдельно). Ниток, упаковки, care label — в списке нет.

### 2.5 Раздел 04 Measurements — ГЛАВНАЯ НАХОДКА

MEASUREMENT DRAWING: чертёж (те же 3 вида) на **сетке 10 см** («SCALE 1 square = 10 cm · Auto-Set For Jackets & Coats · Tap To Adjust»), тумблер Grid, зум −/100%/+/Fit. Кнопки: **+ Add POM** · Edit POM · тумблер Show all POM · Measure guide · How to use. Подсказка: «Add POM: click two points — value auto-fills from the grid. Override in the table if needed.»
SAMPLE SIZE CHART (переключатель CM / IN): POINT OF MEASURE · VALUE · UNIT — **«No measurement points yet. Click the drawing to add one.»**
SIZE GRADING: POM · BASE · XS · S · M · L · XL · RULES · TOLERANCE — **«ADD MEASUREMENT POINTS TO CREATE SIZE GRADING ROWS.»**
→ **Табель мер у них НЕ генерируется.** Человек сам ставит точки кликами по чертежу, сантиметры «снимаются» с сетки, масштаб которой назначен категорией («Auto-Set for Jackets & Coats»). Ни одного замера, ни допуска, ни градации в готовом паке нет. Это подтверждает июльский разбор («вы, как конструктор, корректируете всё сами»), но теперь честнее: не подставляют дефолт, а оставляют пусто. Наши 24 точки с якорем масштаба, допусками по ГОСТ и градацией — это ров, и он стал шире.
→ Что забрать: **интерактивная постановка POM на чертеже** как способ добавить СВОЮ точку и как визуализация «где мерить» (у нас выноски на зоны, у них — линия между двумя точками). Переключатель CM/IN. Ряд XS–XL с колонками RULES и TOLERANCE — структура та же, что у нас, но пустая.

### 2.6 Раздел 05 Graphics & Prints
«SELECT FROM GALLERY» · «UPLOAD ARTWORK» · карточки загруженных/выбранных принтов (здесь — принт из Repeat Print Maker, с корзиной). Только хранилище картинок: ни зоны нанесения, ни размера, ни техники печати. У нас — раскладка нанесения в см и паспорт печати.

### 2.7 Раздел 06 Colourway
«1 colourway — each can carry its own fabric + BOM detail for the factory.» · «+ ADD COLOURWAY» (тултип: «Add an empty colourway slot and upload your own image») · «+ NEW COLOURWAY» (генерация). Карточка: цветной рендер 3 вида (View larger) · имя (Colourway 1) · **Suggest with AI** · FABRIC / MATERIAL (placeholder «e.g. 100% Cotton 12oz denim») · SUPPLIER («Mill / supplier») · PANTONE («19-4024 TCX») · NOTES (раскрывается) · Delete colourway.
→ Колорвей — карточка с тремя полями и картинкой; BOM-на-цвет обещан текстом, но структуры под него не видно (одна строка ткани на колорвей). Suggest with AI — заполнение полей моделью. Свой колорвей можно завести пустым и загрузить своё изображение.

### 2.8 Раздел 07 Artwork
Четыре карточки-актива с «OPEN ASSET →»: TECHNICAL ILLUSTRATION · 3D RENDER (цветной, 3 вида) · TECHNICAL LINE SVG (векторная трассировка, линии тоньше и рванее, чем растр) · MEASUREMENT PLATE (чертёж на сетке). Раздел-склад: всё сгенерированное лежит здесь.

### 2.9 Раздел 08 Review & Open Decisions — САМОЕ СИЛЬНОЕ У НИХ

**PACK COMPLETION 4/6** — шкала: Technical flat ✓ · Photoreal render ✓ · Measurement page ✓ · Technical line SVG ✓ · Tech-pack PDF ○ · Validated ○.

**«19 open decisions to confirm or replace before you export.»** «Confirmed details appear on the exported tech pack. Reject a detail to type the correct wording, which replaces it on the pack.» У каждой карточки три кнопки: ✓ подтвердить · ✎ переписать · 🗑 убрать. Пять групп:
- **CONFLICTS TO RESOLVE (2)** — «The AI found something ambiguous — decide and confirm, or remove.» Примеры: «Confirm whether the collar is intended as corduroy, rib knit, or self-fabric with decorative stitching.» · «Confirm if the jacket is unlined or lined.»
- **PROPOSED ASSUMPTIONS (1)** — «Assumed to fill a gap. Confirm to accept, remove to reject.» «Assumed heavy woven cotton denim or twill for main shell fabric.»
- **SUGGESTED PROPOSALS (6)** — «Optional ideas. Confirm the ones you want, remove the rest.» «Specify 8-wale 100% cotton corduroy for the collar» · «Add back waistband adjuster tabs if traditional trucker styling is desired» · «Specify antique brass, copper, or matte silver hardware finish…» · «Two vertical welt hand pockets on lower front panels» · «Single-welt pocket bags…» · «Assumed unlined jacket construction…»
- **NEEDS YOUR INPUT (10)** — «Details the pack still needs before factory release.» Список честный и профессиональный: нет вида спинки на входе · нет вида изнанки (подкладка, мешковины) · не даны качество/вес/состав ткани · фурнитура не подтверждена · **«Target sizing chart and base size are not specified»** · количество карманов · «Specific seam, stitch, reinforcement, and edge-finishing specifications require technical confirmation before factory release» · **Digital Product Passport / QR label для ЕС** · «Label placement, packaging specification, and grading rules remain placeholder-level» · спинка и внутренняя конструкция не подтверждены по одному фронтальному фото.
- **CONFIRMED (5)** — то, что модель видит уверенно: «6 front shank buttons shown on the vertical placket and waistband», «Distinct horizontal forearm seam on the sleeve» и т.д.
**NOTES & AMENDMENTS:** General notes · Design amendments · Make amendments · Trim amendments — четыре свободных поля.

→ Это их ответ на «не помечаем уверенность» из июля: теперь помечают, и лучше, чем мы. Мы помечаем уверенность ЗНАЧЕНИЯ (пять уровней на числе). Они помечают уверенность РЕШЕНИЯ и превращают её в очередь задач с тремя действиями. Человек проходит список, а не таблицу. Наши «предположения» (красные треугольники) разбросаны по документу и не собраны в одно место с кнопкой «подтвердить». **Забрать обязательно.**
→ Сами формулировки — готовый чек-лист того, что фабрика спросит: подкладка, фурнитура, размерная сетка, DPP/QR для ЕС, упаковка, градация.

### 2.10 Раздел 09 PDF Tech Pack — пейволл
При входе: модалка «**Your tech pack is complete**. Preview every page right here for free. Subscribe to download the full PDF and keep building your next pack.» Блок **FACTORY READINESS 7.5 / 10** с полосой и «Next gap: Only 5 measurements — add key POMs for your garment type». Кнопки: Not now · View plans. Под модалкой — превью страниц PDF, кнопки Refresh · Download PDF.
→ **Free-план: превью бесплатно, скачивание PDF — по подписке.** Оценка готовности к фабрике одним числом + «следующий пробел» — сильный мотиватор и апселл одновременно. Противоречие: «Only 5 measurements», а таблица замеров пуста — score считается не по тому, что показано.

### 2.11 PDF-превью (после «Not now») — 8 страниц
Шапка каждой страницы: [TBC] (бренд) · BRAND [TBC] · STYLE NAME Trucker Jacket · STYLE # [TBC] · SEASON [TBC] · BASE SIZE M · заголовок раздела справа. Футер: «SpecForm OS — generator output · [TBC] / [TBC] · Page N of 8». Кнопки: Refresh · Download PDF (заблокирован тарифом). Пока строится — «BUILDING YOUR TECH PACK…».
1. **Overview** — флэт 3 вида + карточка: Category Jacket · Silhouette Straight/Boxy · Fit Regular Fit · Designer <имя> · абзац описания · «KEY VISIBLE CONSTRUCTION FEATURES» (6 пунктов текстом).
2. **Technical flat** — крупно.
3. **Rendered technical overview — colour** — 3D-рендер 3 вида.
4. **BOM** — колонок больше, чем в UI: ITEM · CATEGORY · DESCRIPTION · FIBER/MATERIAL · **WEIGHT/GSM** (380, 210, 150, 80) · COLOR/PANTONE · **SUPPLIER CODE** · CONSUMPTION · NOTES. Фурнитура с размерами (17 mm (27L), 45×25 mm). Полстраницы пустые.
5. **Construction details** — DETAIL TYPE · CONSTRUCTION DETAIL.
6. **Measurement annotation & grading** — чертёж, замеров нет.
7. **Graphics & Prints** — принт маленькой картинкой, полстраницы пусто.
8. **Colourway — colour & fabric variants** — карточка колорвея.
→ Нет: маркировки, символов ухода, техпоследовательности, схем швов, листа деталей кроя, градации, допусков, RFQ. [TBC] везде, где человек не заполнил. Вёрстка чистая, но полупустые страницы. У нас 18–22 листа с тем, чего у них нет.

### 2.12 Вкладки обложки (раздел 01)

**3D RENDERS:** EDIT ▾ · REPLACE · GALLERY · (?) «Watch tutorial: Sync the 3D render to your technical drawing» · **SYNC TO TECH ▾** (тултип: «Sync the 3D render to a technical drawing version (5 credits)») · Download. Рендер фотореалистичный, 3 вида, синий вельвет с коричневым воротником, есть версии.
→ Связь «рендер ↔ чертёж» есть, но ручная и платная: после правки чертежа рендер надо синхронизировать за 5 кредитов. У нас визуализация строится из спеки автоматически.

**SVG:** режимы **SMART · CLEAN · DETAILED · CUSTOM** · Download. Вектор — трассировка растра: линии заметно грубее и рванее, чем на растровом флэте (воротник, кокетка). Подтверждает июльский вывод: «SVG Control» = крутилки векторизации.

**VIRTUAL FITTING:** кнопка **FIT ▾** → панель «Configure the fit and model to continue. Choose model, body and fit in the pill below, then Confirm.» MODEL: Women · Men · Neutral · Modest · AGE: Adult · Teen · Baby · BODY: Slim · Straight · Curve · Plus · FIT: Regular · Loose · Tight · Oversized. → Генерация фото изделия на модели с выбором типажа. У нас — нет. Маркетинговая, не производственная функция, но «ВАУ» для бренда.

**COLOURWAY (вкладка обложки):** SWATCHES ▾ · ADD COLOURWAY · Download · переключатель «3D render / Technical drawing». Панель: YOUR SWATCHES (пусто, +) · FABRIC LIBRARY (8 образцов: чёрный, белый, деним, олива, горчица, синий, серый меланж, бордо) · поле «e.g. washed indigo denim, sage wool melton» · **Apply · 5 credits**. Версии картинки. → Перекраска рендера по текстовому описанию ткани, 5 кредитов за вариант. У нас колорвеи — из спеки, до трёх рендеров бесплатно для пользователя.

**COMPARE:** «Compare two assets side by side» — REFERENCE (исходное фото: синий вельветовый жакет) ↔ TECH ILLUSTRATION, у обеих панелей выпадающий выбор актива. → Сравнение входа и выхода глазами — простой и сильный приём против «на входе худи, на выходе свитер». У нас фото лежит в паке, но рядом с эскизом не показывается.

**GENERAL INFORMATION** (ниже на обложке): CATEGORY Jacket · SILHOUETTE «Classic Trucker / Denim Style Jacket» · FIT TYPE · BASE SIZE · SIZE RANGE · DESIGNER · SUPPLIER · REVISION.

### 2.13 Журнал ревизий (Revision history) и режимы
Отдельный экран: «ADD REVISION» · «Regenerated and corrected drawings are logged as versions: roll back to any of them.» Таблица REV · DATE · BY · CHANGE, все ячейки редактируемые, «Remove row». Записи: «v2.1-initial · 2026-08-25 · — · Initial editable draft created by» и «v2 · 26/08/2026 · you · Created colourway: sage green». → Журнал полуручной: система пишет часть событий (создание колорвея), человек дописывает. Кнопки «откатить» в таблице нет, хотя текст её обещает. У нас — версии спеки с диффом по точкам, но без имени автора и без свободной строки «что изменилось».
**Preview mode (read-only)** — тумблер-замок в шапке; **Lock edits** — тот же смысл в меню «…».

## 3. Создание техпака (CREATE TECH PACK) — правая панель

**FULL WORKFLOW · Upload reference images.** «Upload references and build the complete editable pack: visuals, BOM, measurements, construction, callout, and PDF.»
- REFERENCES 0/4 · «Photo example» → модалка «What a good upload looks like»: «One garment, plain background, even lighting. Best results from a full front and back, plus a few close-ups of key details. More photos isn't better — mixing garments or busy backgrounds confuses the model.» Четыре примера: Front — full garment · Back — full garment · Detail — cuff & buttons · Detail — label & trim.
- Дропзона «Drop garment images · UP TO 4 · PNG JPG WEBP · MAX 10MB EACH» (+ отдельные инпуты «Take a photo», «Choose from photo library» — мобильные).
- «No photo? Try a sample garment» — демо без своего фото.
- Tip: «for the most accurate result, upload the front, back and a close-up detail shot».
- Дисклеймер: «AI-generated outputs are drafts for reference only. Always review and verify before use in production.»
- **IMAGE MODEL:** Most accurate ~6–10 min «Best garment fidelity» · Good quality ~3–5 min «Much quicker» · Quick draft ~2–4 min «Lower fidelity». **Цена одна — 50 кредитов** при любой модели.
- **CREATE TECH PACK · 50 credits** · «Create manually →» («Create an empty tech pack workspace to fill in by hand — no AI, no credits»).
- **Никаких вопросов на входе** (категория/ткань/цвет/размер/посадка) — только фото. В июле спрашивали тип/ткань/цвет; убрали. Отсюда «Target sizing chart and base size are not specified» в Review — они просто не спрашивают. У нас анкета из 5 вопросов + быстрый взгляд, который её заполняет.
- Загрузил 2 фото худи → превью в панели, кнопка активна. Нажал → **«Not enough credits. This run needs 50 credits and you have 30. Top up to keep generating.» Cancel / Buy credits.** Полный путь на free-плане с 30 кредитами недоступен; покупать не стал.
- «Create manually» создал пак «85899E09» (пустой), но панель осталась в состоянии «QUEUING… 50 / Creating…» ещё несколько секунд — баг состояния кнопки.

## 4. Quick actions — панели

Все четыре — та же панель загрузки (0/4 фото, Photo example, sample garment, tip, дисклеймер, выбор модели), отличаются текстом и ценой:
- **Technical Drawing** — «generate a clean technical flat with SVG. You can continue into a full tech pack from the result.» · ~10–20 sec · **10+ credits**.
- **3D Renders** — «generate 3-view visual renders» · ~10–20 sec · **10 credits**.
- **Repeat Print Maker** — при первом открытии обучающее видео 0:20. «Upload a print reference (a drawing, artwork, or garment with a print) and get a seamless, 1:1 repeat-tileable print you can drop straight into your artwork.» Дропзона «ARTWORK, A DRAWING, OR A GARMENT WITH A CLEAR PRINT · FLAT & EVENLY LIT WORKS BEST». «Repeat size and Pantone colours are now set on the finished tile, after it generates.» · **MAKE REPEAT PRINT · 10 credits**.
- **Virtual Fitting** — панель (см. ниже).
→ Экономика: free-план 80 кредитов = 1 полный пак + 3 быстрых действия. Правки картинки 5 кредитов. Всё оцифровано на кнопках.

## 5. Mochi — ассистент
Плавающий чат «Mochi · Fashion assistant · design support». Вкладки **Design / Support**. Поле «Ask about your garment, pack, or construction…», кнопки: прикрепить изображение, камера, Send. → Тот самый AI-консультант из июльского разбора, теперь с двумя ролями (дизайн / поддержка).

## 6. Меню профиля
e-mail · FREE PLAN · **CREDITS 30 / 80** (полоса) · «Low balance — top up or subscribe to keep generating.» · **Refer & earn — Get 50 credits per friend** · Buy credits · Manage subscription · **Production Knowledge** · Account · Language (English) · Sign out.
→ Реферальная механика — та же, что у нас (мы даём паки, они — кредиты). «Production Knowledge» — отдельный раздел, проверить.

### 4.1 Virtual Fitting — панель
«Upload a garment reference and see it worn by a model in front, side and back views. Choose the model and fit below.» MODEL: Women · Men · Neutral · Modest · AGE: Adult · Teen · Baby · BODY: Slim · Straight · Curve · Plus · FIT: Regular · Loose · Tight · Oversized · «Or fit an existing project →» · CREATE VIRTUAL FITTING · **10+ credits**.

## 7. Живой прогон: Technical Drawing на нашем голден-фото худи (hoodie-front.png + hoodie-back.png)

- Нажал CREATE TECHNICAL DRAWING (10 кредитов). Кнопка → «QUEUING… 10 / Creating…». В сайдбаре появился пак 66980A87 с таймером «4s elapsed» и оранжевой точкой.
- Экран прогресса: шкала **ANALYSING → DRAWING → VECTORISING**, проценты (5% на 4 с, 40% на 14 с), подпись «TECHNICAL DRAWING QUICK ACTION», карусель референсов (REFERENCE 1 / 2) с зумом −/100%/+/Fit, строка статуса «Reading silhouette, seams, closures, and visible garment details», «This quick action can continue into the full tech-pack workflow later», таймер «0:14 elapsed», кнопка CANCEL. В DOM заготовлен экран отмены: «Cancelled — This drawing run was stopped. Your reference images are still available.»
- **Результат через ~30 с: ОТКАЗ.** «This run hit a snag. Couldn't generate a technical flat from this reference. Try uploading a clearer, front-facing garment image with the full garment visible.» · «✓ Your credit was refunded» · Regenerate. Пак остался в списке с красной точкой.
→ На том же фото наш пайплайн собирает документ целиком (это наш QA-набор). У них — отказ без объяснения, что именно не так (фото фронтальное, изделие целиком, ровный фон). Честный возврат кредита — да; диагностики — нет.
- **Regenerate** → создал ещё один пак (A1603761), тоже с красной точкой — второй отказ подряд на тех же фото. Экран первого пака завис на кнопке «Restarting…» (>40 с), в новый не перешёл. Итого: **устойчивый отказ на нашем голден-фото худи** + два мёртвых пака в списке.

## 8. Тарифы (/subscription)

Заголовок: «During Beta, Early Access is the plan to pick — choose your monthly credits below. Student Access and the Customisable public plan arrive with Public Access. Prefer a one-off top-up instead? → Buy a one-off credit pack».
**Early Access (BETA):** Monthly / Annual (1 month free) · валюты £ GBP / $ USD / € EUR / AED · **$40/мес = 1 000 кредитов** (варианты: 500 — $20, 1 000 — $40, 3 000 — $105). «Charged in USD at checkout. GBP list price £30.» Включает: «Up to 20 first-pass tech packs / month · ≈100 technical drawings or 3D renders · Full access — flats, 3-view renders, BOM, POM & callouts · Edit measurements, materials & technical fields · PDF tech-pack + editable SVG export · **Observed vs inferred labelling on every output** · Buy credit top-ups anytime · Priority Beta support for failed runs & exports · Early access to new features + feature voting · Cancel or change monthly».
**Student Access (COMING SOON):** $16/мес, 300 кредитов, до 6 паков, академическая верификация.
**Customisable Plan (COMING SOON):** от $25/мес, 500/1 000/2 000/3 000 кредитов.
**Таблица сравнения:** Free — только Manual tech-pack template + Pay as you go. Beta/Starter/Pro/Studio — AI flats, 3-view renders, Measurement annotation & POM, **Editable graded size charts**, BOM & construction-detail drafts, Quick Actions, PDF, SVG, Observed vs inferred labelling, monthly credits. Pro/Studio: Priority queue. Beta/Studio: **Custom export templates (branded layouts)**. Studio: **Team seats**, **Custom dataset training (your blocks & make standards)**.
**Бенефиты:** Production Knowledge library (exclusive, платные) · IP ownership · Commercial rights · Free-entry offer: up to 2 first-pass packs · Referral: 50 кредитов за платного реферала (Beta) / 30 · Beta community, feature voting, changelog credit, 20% off first Public Access year.
Сноска: «A tech pack run spends 50 credits; the Free plan and one-off top-up packs are pay-as-you-go on top of any monthly allowance.»
→ **Единица экономики: 50 кредитов = $2 за полный пак на Early Access** ($40/1 000 × 50). Quick action — $0.40. Правка картинки — $0.20. Мы: 3 пака бесплатно в месяц, цены не объявлены.
→ Дорожная карта в тарифе: branded export templates, team seats, **обучение на блоках и стандартах бренда** (Studio). «Observed vs inferred labelling» вынесено в продающий пункт — они продают то, что мы называем уверенностью.

### 8.1 Кредиты (/credits)
«A tech pack run spends 50 credits; an AI suggestion (BOM, costing) 5; a regeneration 10. Buy a one-off pack below, or subscribe for a monthly allowance that works out cheaper per pack.» CURRENT BALANCE 30 · «≈ 0 TECH PACKS».
**Разовые пакеты:** 100 кредитов (≈2 пака) — **$20** · 250 (≈5) — $40 · 500 (≈10) — $75 · 1 000 (≈20) — $130. Валюты GBP/USD/EUR/AED, «GBP list price £15».
**CREDIT HISTORY** (журнал с датой, операцией, ±кредитов): 22.08 «public grant +100» (стартовый бонус) · 25.08 «Tech pack run −50» · 26.08 два «Quick action −10» · сегодня «Quick action −10 / Refund — failed run +10», «Quick action −5 / Refund — failed run +5».
→ Стартовый бонус 100 кредитов = 2 пака. Регенерация в журнале списала 5, а не заявленные 10. Возвраты за провалы честные, баланс Данила не изменился (30). У нас журнала списаний для пользователя нет — есть только квота «осталось N».
→ Розница: **$10 за полный пак** на разовых кредитах, $2 — по подписке. Это ценовой якорь для нашего прайса.

## 9. Языки интерфейса
Combobox: English · 中文 · Italiano · Français. (Перевод документа — отдельная функция, ≥10 языков.)

## 10. Production Knowledge (/knowledge) — публичная база знаний

«Factory-grade apparel knowledge, in SpecForm's voice. 109 original reference articles across textiles, merchandising, the cutting room, production, IE & Lean, trims and trade finance. Previews are open to everyone; full articles and the data visuals unlock for SpecForm members.»
Разделы: Textile 6 · Merchandising 13 · **Cutting Room 30** · Production 9 · Dyeing & Finishing 8 · Quality & Testing 6 · Sustainability 1 · IE & Lean 11 · Trims 6 · Commercial 12 · Reference 7. Поиск «Ask anything about production…» с подсказками («What is marker efficiency?», «How does AQL inspection work?», «Which dye suits polyester?»). У статей метка «Visual» (есть инфографика).
Темы, прямо пересекающиеся с нашим документом: «Building a Garment Measurement Spec: POM, Tolerances and Grading», «Garment Size Grading Rules», «Stitch Classes and Types», «Types of Seams: The Six ASTM Seam Classes», «Thread Consumption Equations by Stitch Type», «Care Label Symbols», «Garment Labels», «AQL Inspection», «Colour Fastness», «From Lab Dip to Bulk», «Garment Sample Types: From Proto to TOP», «Cost Sheet» ×3, «CM Calculation».
Страница публичная (шапка «Create free account»), футер «© 2026 SpecForm OS · morchen@specform.uk» — компания в UK.
→ Это контент-маркетинг + SEO + обучение пользователя + повод для подписки. Судя по оглавлению, источник — классический учебник по швейному производству (Bangladesh Bank в статье про L/C, формулы в дюймах и «per dozen»). Наша база знаний (kb/data + knowledge-base/*.md) глубже по нормам РФ/ГОСТ, но заперта в репозитории. **Забрать идею публичной библиотеки**: у нас есть материал на десятки статей (допуски по ГОСТ, маркировка ТР ТС 017, схемы швов, техпоследовательности).

## 11. Аккаунт (/account) и About
**PROFILE:** email · Sign-in method (google) · Credits · User ID.
**EVENTS:** «Live Demo & AMA · Wednesday 9 September · 14:00 to 15:30» — Details / Join. → Живые демо для бета-пользователей, прямо в аккаунте.
**APPEARANCE:** Font — Sora / Serif / System · Interface size — Compact / Regular / Large («Scales the whole interface»).
**REFER & EARN:** «When a friend signs up and buys a plan or credit pack, you get 50 credits.» Ссылка + COPY LINK + шаринг в X / WhatsApp / LinkedIn / email · дашборд: Signed up / Paid / Credits earned · «Referral dashboard →».
**Production Knowledge:** «93 factory-grade apparel articles. Full access with any plan.» (на самой странице библиотеки — 109; расходится).
**PRIVACY & DATA** (сильный блок): «Your designs — Never used for AI training · Human access — Automated systems only · File deletion — Active: immediate · Backups: 30 days · IP ownership — 100% yours upon generation · AI model improvement — Opt out via email» · Privacy Policy · Terms of Service · DPA.
→ Прямые ответы на страхи бренда (утечка дизайна, обучение на моих вещах, кто видит файлы). У нас этого блока нет ни в кабинете, ни на лендинге. **Забрать дословно как структуру.**
**About:** «Beta · $20/mo · Billed monthly · GBP £15 · 500 credits — up to 10 first-pass packs or ~5–6 revised styles · Beta pricing locked in for founding subscribers · JOIN BETA PROGRAM». → Их же формула: 500 кредитов ≈ 10 паков ИЛИ 5–6 доработанных стилей — то есть один стиль с правками съедает ~90 кредитов.

## 12. Ручной пак («Create manually») — не открывается
Пак 85899E09 создан, в списке с зелёной точкой, но при открытии — «LOADING DRAFT…» бесконечно (>10 с, два захода). Бесплатный ручной путь, который рекламирует таблица тарифов («Manual tech-pack template ✓ на Free»), на деле не работает.

## 13. Баги и шероховатости, замеченные по пути
1. «Create manually» → панель зависает в «QUEUING… 50 / Creating…».
2. Ручной пак не загружается («LOADING DRAFT…»).
3. Regenerate после провала → создаёт новый пак, но экран старого зависает на «Restarting…».
4. Отказ генерации без диагностики («hit a snag») на фото, которое у нас проходит.
5. Construction: дубли строк (Center Front Placket ×2, Chest Flap Pocket ×2).
6. «Only 5 measurements» в оценке готовности при пустой таблице замеров.
7. Кнопка «Measure guide» в Measurements выбрасывает на главную.
8. «93 статьи» в аккаунте vs «109» в библиотеке.
9. Регенерация: на странице кредитов «10», в журнале списано 5.
10. Review / Copy link / Costing — заявлены как SOON; Costing «в начале 2027».

## 14. Второй проход, 8 сентября вечером — аккаунт с 80 кредитами (ivanovnakoska0@gmail.com, FREE PLAN)

### 14.1 Полный пак: старт и экран генерации
- Загрузил те же два фото худи, модель «Most accurate ~6–10 min», CREATE TECH PACK · 50. Пак 035EDEAA появился в сайдбаре с таймером «1s elapsed» и оранжевой точкой; превью в сайдбаре обновляется вживую: пусто → одно фото → два.
- Экран прогресса: шкала **ANALYSING → GENERATING → COMPOSING**, проценты (0% на 2 с, 6% на 22 с, 42% на 52 с, 49% на 1:22), «TECH PACK WORKFLOW», кнопка «+ ADD DETAILS WHILE YOU WAIT», карусель референсов с зумом, таймер, CANCEL. Строки статуса меняются: «Separating garment evidence from styling noise», «Keeping reference images alive while views are generated», «You can add garment details while this run continues».
- **Вопросы задаются ВО ВРЕМЯ генерации, а не до.** Правая панель «ADD DETAILS — Fill in while your pack generates. These details attach to this run and carry into the editable pack»: BRAND (placeholder Supreme) · STYLE NAME (Satin Anorak) · SEASON (FW 2026) · BASE SIZE (UK 12) · CATEGORY (Outerwear) · MATERIALS (optional — leave blank and SpecForm OS suggests suitable materials): MAIN FABRIC (e.g. 100% silk) · LINING (e.g. viscose) · TRIMS (e.g. YKK zip, horn) · CONFIRM DETAILS → · STOP.
  → Умный ход против ожидания: 6–10 минут человек не смотрит на шкалу, а заполняет анкету. У нас анкета до старта, и быстрый взгляд заполняет её за 6 секунд — но ожидание 1–2 минуты у нас пустое. Забрать: пока идёт сборка — показывать, что уже известно, и просить недостающее (страна, знак, юрлицо для маркировки).
- **Ховер-анимация во время генерации:** за курсором по всему экрану прогресса плавает маркер — логотип «S» с подписью «RUNNING PIPELINE…»; карточка референса слегка едет за мышью (параллакс). Это «курсор-компаньон» процесса: ощущение, что система жива, пока ждёшь. Дёшево, заметно, забирается.
- **На тех же фото худи полный пайплайн ПРОШЁЛ**: к 2:30 (58%) на экране прогресса веером легли четыре карточки — REFERENCE 1, REFERENCE 2, **TECHNICAL DRAWING** (три вида: перед, бок, спинка, с кенгуру и шнуром) и **3-VIEW RENDER** (фотореалистичный, синий худи). Утренние два отказа — это быстрое действие «Technical Drawing», а не полный пак: разные пайплайны, разная устойчивость. 71% на 3:00, статус «Checking silhouette, trims, closures, and measurement cues».
- Заполнил детали во время генерации: Brand «Test Brand», Style «Hoodie QA», Season FW 2026, Base size M, Category Hoodie, Main fabric «100% cotton brushed fleece 320 gsm» → CONFIRM DETAILS.

### 14.2 Готовый пак «Hoodie QA» (035EDEAA) — ~5 минут, COMPLETED
- После завершения — тост Mochi «How did that turn out? Your tech pack is ready. How happy are you with the result? It helps me get better. Tap a star» (пять звёзд). → Оценка результата сразу после генерации, встроенная в ассистента.
- **Обложка:** шапка взяла мои детали (Brand «Test Brand», Season FW 2026, Description «Hoodie», Sample size M — чёрным), от AI — Fabric «Fleece» и дата (красным). Флэт — три вида: перед с кенгуру и шнуром, профиль с краем кармана и шнуром, спинка. Качество — ровня нашему эскизу v3; линии чуть тоньше, рибана штриховкой, дроп-плечо читается.
- **Construction:** всего **3 строки** — Hood Seam Finish · Coverstitch; Hood Drawcord Channel Finish · Single needle topstitch; Kangaroo Pocket Attachment · Double needle topstitch. Колонки STITCH и IMAGE пустые (у тракер-жакета были ISO-коды — здесь нет). У нас на худи 14 узлов с кодами стежка и шва, машиной и схемой.
- **BOM:** 7 строк — Main fabric «Cotton Brushed Fleece», Dusty Blue, PANTONE 2587 C, 2.2 m · Rib knit for cuffs and hem 0.25 m · Hood drawcord «Flat braided cotton cord» 1.8 m · Eyelets «Metal Eyelet» Silver-toned 2 pcs · Main label woven 1 pc · Care/Content label printed satin 1 pc · Size label 1 pc. Pantone один и тот же на всё синее; [TBC] на фурнитуре и ярлыках. Costing — «early 2027».
- **Measurements — снова пусто:** «No measurement points yet». Сетка «1 square = 9 cm · Auto-Set For Tops» (у жакета было 10 см).
- **Поставил точку сам** (Add POM → «Click two points to add a new measurement line» → два клика по груди): появилась красная пунктирная линия «A», в таблице строка «A · Point of measure ▾ · 57.3 · cm», в градации — **BASE 57.5 · XS 53.5 · S 55.5 · M 57.5 · L 59.5 · XL 61.5 · RULES +2 · TOLERANCE ±0.5**.
  → Значит градация и допуск у них ЕСТЬ, но только для точек, которые человек поставил руками, и с одним правилом «+2 на размер» и одним допуском «±0.5» на всё. Значение 57.3 — это ширина рисунка в клетках сетки, масштаб которой назначен категорией, а не измерен по фото. Наш якорь по А4 — измерение; их «Auto-set for Tops» — назначение.
- **Библиотека имён точек** (выпадашка «Point of measure»): группы RECOMMENDED · LINGERIE / SWIM / STRAPPY TOPS (12) · OUTERWEAR / JACKETS / COATS (16: Across chest/bust «1cm below armhole», Across shoulder «shoulder point to shoulder point», Body length «HPS or CB to hem», Center back length, Sleeve length, Bicep, Armhole depth, Cuff opening, Hem width, Sweep, Collar dimensions, Placket width, Pocket placement, Pocket opening) · TOPS / SHIRTS / KNITWEAR (14) · TROUSERS / BOTTOMS (13: Waist, High hip, Hip, Front rise, Back rise, Inseam, Outseam, Thigh, Knee, Leg opening, Waistband height…) · DRESSES / SKIRTS (14) · DETAILS / PLACEMENT (12: Pocket placement, Button spacing, Zip length, Label/Logo/Artwork/Embroidery placement). Только имена — без кодов, без «как мерить», без допусков по точке. **Баг:** для худи «RECOMMENDED» показал группу «Lingerie / swim / strappy tops».
  → У них полный словарь имён на все классы изделий (низ, платья, верхняя одежда) — это список, а не данные. У нас — данные на 8 категорий. Словарь имён забрать как чек-лист для наших POM-шаблонов низа и платьев.
- **Review для худи:** 15 открытых решений — Proposed assumptions 1 («standard pullover hoodie, medium-weight fleece knit…»), Suggested proposals 6, Needs your input 8, Confirmed 10 (пять «Detail close-up: …» — шнур, люверс, манжета, пояс, строчка кармана). Pack completion 5/6 (Validated ✓, PDF ○).
  → **Две ошибки разбора:** «Request a back view of the garment» и «Back view of the garment is not provided» — при том, что спинка загружена вторым фото и лежит на экране как REFERENCE 2; «Brand name, style number, season, base size… are TBC» — при том, что я ввёл их в форме деталей, и они стоят в шапке. Review не видит ни второго фото, ни введённых деталей.
- **PDF / Factory readiness: 4.5 / 10**, «Next gap: BOM is empty — add at least fabric, lining, and key trims» — при семи строках в BOM. У жакета было «Only 5 measurements» при пустом табеле. Оценка готовности считается не по тому, что в паке.
- **PDF худи — 7 страниц** (футер «Page 2 of 7», «Test Brand / FW 2026»): обложка с флэтом, флэт крупно, цветной рендер, BOM, конструкция, чертёж замеров (с моей единственной точкой A), колорвей/принты.

### 14.3 Быстрое действие «Technical Drawing» на аккаунте с кредитами
- Панель открылась ПОВЕРХ готового пака и сама подхватила его референсы (2/4 — те же два фото). Модель «Most accurate ~1–2 min», кнопка «CREATE TECHNICAL DRAWING · 10+».
- Нажал → «QUEUING… 10» → через ~20 с красная плашка: **«We're experiencing high demand right now: free generations are queued. Your next slot opens in about 35 min. Upgrade for priority generation and skip the queue. Buy credits →»**. Кнопка вернулась в исходное состояние, пак в Quick Actions не появился, кредиты не списаны.
  → На free-плане быстрые действия **ограничены очередью со слотами ~35 минут** после полного прогона; «Priority generation queue» из таблицы тарифов — это оно. Утренние «hit a snag» на другом аккаунте — отдельная поломка, не очередь. Ждать 35 минут не стал.

### 14.4 Кредиты и аккаунт после прогона
- Журнал: «08.09 20:12 public grant +80» → «20:18 Tech pack run −50» → баланс **30**. Очередь быстрого действия не списала ничего. Стартовый бонус на новом аккаунте — 80 (у августовского было 100).
- **FOUNDING MEMBER** (это и есть «members»): блок «FOUNDING 100 · CHARTER · Founding Member», «Beta pricing locked · 100 credits per referral · priority support · feature voting · private Discord», кнопка **Join Private Discord**. «Your badge is yours for good, but priority support and voting need an active subscription. Reactivate your plan to use them again.» → Когорта первых ста: значок навсегда, привилегии — пока платишь. Реферал для основателей — 100 кредитов вместо 50.
- **What's new** — лента изменений прямо в аккаунте: 30 Aug «Founding 100 hub» · 30 Aug «Multi-currency checkout» (USD/EUR/AED) · 31 Aug «Sharper repeat prints» (точнее тайлы и Pantone) · 6 Sept «Cleaner PDF exports» (страницы замеров разбиваются правильно, **отдельный press/influencer export layout**) · 6 Sept «Your brand logo on exported tech packs» · 7 Sept «Faster image loading» (CDN). → Релизы раз в 1–3 дня, публично. У нас коммиты чаще, но снаружи их не видно.
- **Feature voting + ROADMAP:** «Propose features and vote on what the cohort wants next. Top-voted ideas move onto the roadmap». Planned — пусто; Shipped — «Custom Tech Pack Pages + Image Uploads» (+3), «right and left moving toggle bar!» (+0); «No open suggestions yet — be the first».
