#!/bin/bash
# Сквозной прогон кабинета: инвайт → пак → генерация → документ → правка
# замера → PDF → просчёт. Не «сервер отвечает 200», а «человек прошёл путь».
set -u
BASE=http://127.0.0.1:8132/app/api
H="x-invite: localdemo1234567890"
fail=0
step() { printf '%-46s' "$1"; }
ok()   { echo "ok${1:+ $1}"; }
bad()  { echo "ПРОБЛЕМА: $1"; fail=$((fail+1)); }

step "1. кабинет отвечает"
[ "$(curl -s -o /dev/null -w '%{http_code}' $BASE/health)" = "200" ] && ok || bad "health не 200"

step "2. без инвайта доступа нет"
code=$(curl -s -o /dev/null -w '%{http_code}' $BASE/jobs)
[ "$code" = "401" ] || [ "$code" = "403" ] && ok || bad "открыто без инвайта ($code)"

step "2b. профиль бренда заполнен до сборки"
curl -s -o /dev/null -X PUT -H "$H" -H 'content-type: application/json' -d '{
  "legal":{"company":"ИП Кочнев Д. А.","inn":"662345678901","address":"Екатеринбург, ул. Мира 32"},
  "country":"Россия","trademark":"SEAMSTER"
}' $BASE/profile
saved=$(curl -s -H "$H" $BASE/profile | python3 -c "import json,sys; p=json.load(sys.stdin).get('profile') or {}; print(p.get('trademark',''))" 2>/dev/null)
[ "$saved" = "SEAMSTER" ] && ok || bad "профиль не сохранился"

step "3. создание пака"
ID=$(curl -s -X POST -H "$H" -H 'content-type: application/json' -d '{
  "id":"qa","name":"QA прогон","article":"QA-E2E-001","category":"hoodie",
  "gender":"women","base_size_ru":46,"base_height_cm":170,
  "fit_intent":"oversize","fabric_kind":"knit","size_range":[44,46,48],
  "machine_park":"base_shop","batch_qty":100,
  "colorways":[{"id":"black","name_ru":"Чёрный","hex_approx":"#1A1A1A"},{"id":"ecru","name_ru":"Экрю","hex_approx":"#EFE6D3"}]
}' $BASE/jobs | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
[ -n "$ID" ] && ok || { bad "пак не создан"; exit 1; }

step "3b. старт без фото отклоняется"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$H" $BASE/jobs/$ID/start)
[ "$code" = "400" ] && ok || bad "старт без фото прошёл ($code) — документ соберётся вслепую"

step "3d. быстрый взгляд узнаёт худи на снимке"
ql=$(curl -s -X POST -H "$H" -H 'content-type: image/png' --data-binary @golden/photos/hoodie-front.png "$BASE/quicklook" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('category',{}).get('value',''), d.get('source',{}).get('value',''), d.get('ms',''))" 2>/dev/null)
case "$ql" in hoodie*) ok "($ql)";; *) bad "быстрый взгляд: ${ql:-нет ответа}";; esac

step "3c. фото принимается с ракурсом"
cnt=$(curl -s -X POST -H "$H" -H 'content-type: image/png' --data-binary @golden/photos/hoodie-front.png "$BASE/jobs/$ID/photos?view=front_flat" | python3 -c "import json,sys; print(json.load(sys.stdin).get('count',0))" 2>/dev/null)
[ "${cnt:-0}" -ge 1 ] && ok || bad "фото не принято"

# Разбор фото идёт по-настоящему (первый прогон — вызов модели, дальше кэш),
# поэтому ждём до шести минут, а не три.
step "4. генерация запускается"
curl -s -o /dev/null -X POST -H "$H" $BASE/jobs/$ID/start
for i in $(seq 1 120); do
  stage=$(curl -s -H "$H" $BASE/jobs/$ID/status | python3 -c "import json,sys; print(json.load(sys.stdin).get('stage',''))" 2>/dev/null)
  [ "$stage" = "done" ] && break
  [ "$stage" = "error" ] && break
  sleep 3
done
[ "$stage" = "done" ] && ok || bad "стадия $stage"

step "4b. документ собран с глазами, а не вслепую"
seen=$(curl -s -H "$H" $BASE/jobs/$ID/spec | python3 -c "
import json,sys
d=json.load(sys.stdin)['spec']
n=0
def walk(o):
    global n
    if isinstance(o,dict):
        if str(o.get('source','')).startswith('vision'): n+=1
        for v in o.values(): walk(v)
    elif isinstance(o,list):
        for v in o: walk(v)
walk(d); print(n)" 2>/dev/null)
[ "${seen:-0}" -ge 5 ] && ok || bad "оценок по фото ${seen:-0} — разбор снимка не участвовал"

step "5. спека читается"
pts=$(curl -s -H "$H" $BASE/jobs/$ID/spec | python3 -c "import json,sys; print(len(json.load(sys.stdin)['spec']['measurements']['points']))" 2>/dev/null)
[ "${pts:-0}" -gt 10 ] && ok || bad "замеров ${pts:-0}"

step "6. правка замера принимается"
changed=$(curl -s -X PATCH -H "$H" -H 'content-type: application/json' -d '{"code":"T03","value_cm":70}' $BASE/jobs/$ID/measurements | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('changed',[])))" 2>/dev/null)
[ "${changed:-0}" -ge 1 ] && ok || bad "правка ничего не изменила"

step "7. невозможная правка отклоняется"
err=$(curl -s -X PATCH -H "$H" -H 'content-type: application/json' -d '{"code":"T03","value_cm":9999}' $BASE/jobs/$ID/measurements | python3 -c "import json,sys; print(json.load(sys.stdin).get('error',''))" 2>/dev/null)
[ -n "$err" ] && ok || bad "9999 см принято"

step "8. PDF собирается"
size=$(curl -s -o /dev/null -w '%{size_download}' -H "$H" "$BASE/jobs/$ID/pdf")
[ "$size" -gt 50000 ] && ok || bad "PDF $size байт"

step "9. китайский комплект собирается"
size=$(curl -s -o /dev/null -w '%{size_download}' -H "$H" "$BASE/jobs/$ID/pdf?locale=zh")
[ "$size" -gt 50000 ] && ok || bad "PDF zh $size байт"

step "10. выгрузка для ОТК легче полной"
qc=$(curl -s -o /dev/null -w '%{size_download}' -H "$H" "$BASE/jobs/$ID/pdf?role=qc")
full=$(curl -s -o /dev/null -w '%{size_download}' -H "$H" "$BASE/jobs/$ID/pdf")
[ "$qc" -lt "$full" ] && ok || bad "ОТК $qc не легче полного $full"

step "11. силуэт подобран или честно отсутствует"
tpl=$(curl -s -H "$H" $BASE/jobs/$ID/template | python3 -c "import json,sys; d=json.load(sys.stdin); print(('есть' if d.get('id') else 'нет')+' · кандидатов '+str(len(d.get('candidates',[]))))" 2>/dev/null)
[ -n "$tpl" ] && echo "ok ($tpl)" || bad "силуэт не читается"

step "12. замена силуэта работает"
cand=$(curl -s -H "$H" $BASE/jobs/$ID/template | python3 -c "import json,sys; c=json.load(sys.stdin).get('candidates',[]); print(c[0]['id'] if c else '')" 2>/dev/null)
if [ -n "$cand" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$H" -H 'content-type: application/json' -d "{\"template_id\":\"$cand\"}" $BASE/jobs/$ID/template)
  [ "$code" = "200" ] && ok || bad "замена вернула $code"
else
  echo "пропуск (кандидатов нет)"
fi

step "13. чертёж из библиотеки отдаётся"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" "$BASE/jobs/$ID/flat?view=front")
[ "$code" = "200" ] || [ "$code" = "404" ] && ok || bad "чертёж вернул $code"

step "13b. все виды одним силуэтом из библиотеки"
body=$(curl -s -H "$H" "$BASE/jobs/$ID/flat?view=all")
echo "$body" | grep -q "<svg" && ok || bad "вид all не отдан: ${body:0:80}"

step "13c. библиотека бок не выдумывает"
# Покупных боковых силуэтов в библиотеке нет, и построить его геометрией
# значило бы показать выдумку. Профиль даёт только эскиз — он рисует его
# тем же изделием, что перед и спинку. Шаг сторожит именно библиотеку.
code=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" "$BASE/jobs/$ID/flat?view=side")
[ "$code" = "404" ] && ok || bad "бок отдан из библиотеки ($code)"

step "13d. визуализация лежит файлом и отдаётся"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" "$BASE/jobs/$ID/render")
case "$code" in 200) ok "(есть)";; 404) ok "(нет визуализации — документ собран без неё)";; *) bad "render отдал $code";; esac

step "13e. пересборка PDF не теряет картинку"
before=$(curl -s -o /dev/null -w '%{size_download}' -H "$H" "$BASE/jobs/$ID/pdf")
curl -s -o /dev/null -X PATCH -H "$H" -H 'content-type: application/json' -d '{"code":"T05","value_cm":57}' "$BASE/jobs/$ID/measurements"
after=$(curl -s -o /dev/null -w '%{size_download}' -H "$H" "$BASE/jobs/$ID/pdf")
if [ "${before:-0}" -gt 0 ] && [ "${after:-0}" -gt $(( before * 70 / 100 )) ]; then ok "($before → $after байт)"; else bad "PDF похудел после правки: $before → $after"; fi

step "13f. превью в кабинете — этот документ, а не макет"
body=$(curl -s -H "$H" "$BASE/jobs/$ID/preview?frame=1")
art=$(curl -s -H "$H" $BASE/jobs/$ID/spec | python3 -c "import json,sys; print(json.load(sys.stdin)['spec']['style']['article'])" 2>/dev/null)
if echo "$body" | grep -q "$art" && ! echo "$body" | grep -q "Молния по асимметрии"; then ok "($art)"; else bad "превью не про этот пак"; fi

step "13g. список выгруженного — реальные файлы работы"
files=$(curl -s -H "$H" "$BASE/jobs/$ID/files" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['files']), ','.join(f['name'] for f in d['files'][:3]))" 2>/dev/null)
case "$files" in 0*|"") bad "файлов не видно: ${files:-нет ответа}";; *) ok "($files)";; esac

step "13h. в кабинете не осталось данных макета"
page=$(curl -s "http://127.0.0.1:8132/app/index.html")
# Маркеры, которые once показывались НА ЖИВЫХ данных. Демо-ветки за флагом
# DEMO сюда не входят: там макет показывается намеренно.
bad_markers=""
for m in "1 240 ₽" "≈ 38 мин" "15 июл, 18:40" "16 июл, 07:10 · по фото" "Превью PDF · страница 1 из 9"; do
  echo "$page" | grep -q "$m" && bad_markers="$bad_markers $m"
done
[ -z "$bad_markers" ] && ok || bad "макет в сборке:$bad_markers"

step "13i. лист деталей кроя перечисляет детали"
parts=$(curl -s -H "$H" "$BASE/jobs/$ID/preview" | grep -o "Деталей на изделие: [0-9]*" | head -1)
[ -n "$parts" ] && ok "($parts)" || bad "листа деталей кроя нет"

step "13j. гейт отправки согласован с готовностью документа"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$H" $BASE/jobs/$ID/share)
gaps=$(curl -s -H "$H" "$BASE/jobs/$ID/readiness" | python3 -c "import json,sys; d=json.load(sys.stdin); print(('готов' if d['ready'] else 'пробелов ' + str(len(d['gaps']))))" 2>/dev/null)
case "$code:$gaps" in
  200:готов)     ok "(профиль заполнен — ссылка выдана)";;
  409:пробелов*) ok "(документ не готов — ссылка заблокирована, $gaps)";;
  *)             bad "гейт не сошёлся: код $code, готовность $gaps";;
esac

step "13m. эскиз: если он есть, лист чертёжа собран на нём и он прошёл сторожа"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" "$BASE/jobs/$ID/sketch")
body=$(curl -s -H "$H" "$BASE/jobs/$ID/preview")
case "$code" in
  200)
    # Есть эскиз — лист обязан быть собран на нём: иначе кабинет и документ
    # показывают разные рисунки, а это ровно та поломка, из-за которой
    # на входе было худи, а на выходе свитер с молнией.
    echo "$body" | grep -q "Эскиз построен по узлам этой спецификации" \
      && ok "(эскиз принят и стоит на листе)" \
      || bad "эскиз отдаётся, но лист чертежа собран не на нём" ;;
  404)
    # Эскиза нет — либо сторож его не принял, либо сервис молчал. И то
    # и другое штатно, но лист обязан честно спуститься на силуэт.
    echo "$body" | grep -q "Силуэт взят из библиотеки" \
      && ok "(эскиза нет — лист на библиотечном силуэте)" \
      || bad "эскиза нет и силуэта на листе тоже нет" ;;
  *) bad "sketch отдал $code" ;;
esac

step "13p. референс рядом с эскизом: кабинет знает ракурсы, лист несёт снимки"
views=$(curl -s -H "$H" "$BASE/jobs/$ID/files" | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(str(p.get('view')) for p in d.get('photos',[])))" 2>/dev/null)
case "$views" in
  *front_flat*)
    if [ "$code" = "200" ]; then
      # Эскиз есть — снимок обязан стоять рядом с ним в том же холсте: порознь
      # расхождение в узле (карман, шнур, манжета) не замечает никто.
      echo "$body" | grep -q 'class="reference"' && echo "$body" | grep -q "Референс · снимки заказчика" \
        && ok "(ракурсы: $views · колонка референса на листе)" \
        || bad "снимки есть, а на листе чертежа колонки референса нет"
    else
      ok "(ракурсы: $views · эскиза нет — сверять нечего)"
    fi ;;
  *) bad "кабинет не знает ракурсов снимков (${views:-пусто})" ;;
esac

step "13q. виды чертежа — вырезки одного эскиза, а не другой рисунок"
sv=$(curl -s -H "$H" "$BASE/jobs/$ID/files" | python3 -c "import json,sys; print(' '.join(json.load(sys.stdin).get('sketch_views',[])))" 2>/dev/null)
if [ "$code" = "200" ]; then
  case "$sv" in
    *front*back*)
      # Перед и спинка вырезаны из того же листа — обложка обязана стоять
      # на них, а не на библиотечном силуэте: иначе на одном листе одно
      # худи, на другом другое, и фабрика спрашивает «а это точно та вещь?»
      c=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" "$BASE/jobs/$ID/sketch?view=front")
      [ "$c" = "200" ] && echo "$body" | grep -q 'class="sketch-view"' \
        && ok "(виды: $sv · обложка на эскизе)" \
        || bad "виды эскиза объявлены ($sv), но вид не отдаётся ($c) или обложка собрана не на них" ;;
    *) bad "эскиз есть, а виды из него не вырезаны (${sv:-пусто}) — обложка и лист на просчёт покажут другую вещь" ;;
  esac
else
  ok "(эскиза нет — виды с силуэта)"
fi

step "13r. слой правок: вектор поверх эскиза, печатается везде, мусор отклоняется"
if [ "$code" = "200" ]; then
  put=$(curl -s -X PUT -H "$H" -H 'content-type: application/json' -d '{"version":1,"sheet":{"w":1792,"h":592},"strokes":[{"id":"qa1","kind":"line","preset":"lockstitch","width":4,"points":[{"x":0.1,"y":0.4},{"x":0.3,"y":0.45,"cx":0.2,"cy":0.3}]}]}' "$BASE/jobs/$ID/sketch-edits" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('edits',{}).get('strokes',[])))" 2>/dev/null)
  doc=$(curl -s -H "$H" "$BASE/jobs/$ID/preview")
  n=$(echo "$doc" | grep -o 'class="edits"' | wc -l | tr -d ' ')
  bad_put=$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "$H" -H 'content-type: application/json' -d '{"version":1,"sheet":{"w":10,"h":10},"strokes":[{"id":"x","kind":"line","preset":"satin","width":4,"points":[{"x":0,"y":0}]}]}' "$BASE/jobs/$ID/sketch-edits")
  # Лист чертежа плюс вырезки переда и спинки на обложке: правка человека
  # печатается везде, где стоит рисунок, — иначе на одном листе она есть,
  # а на другом та же вещь без неё.
  if [ "${put:-0}" = "1" ] && [ "${n:-0}" -ge 3 ] && [ "$bad_put" = "400" ]; then
    ok "(слой сохранён, в документе $n раз, мусор отклонён)"
  else
    bad "слой правок: сохранено=${put:-?}, в документе=${n:-0} (нужно ≥3), мусор=$bad_put"
  fi
else
  ok "(эскиза нет — править нечего)"
fi

step "13s. перерисовка эскиза: новый лист, прошлый в истории, откат возвращает"
if [ "$code" = "200" ]; then
  rd=$(curl -s -X POST -H "$H" "$BASE/jobs/$ID/sketch/redraw")
  rok=$(echo "$rd" | python3 -c "import json,sys; d=json.load(sys.stdin); print('yes' if d.get('ok') else 'no:'+str(d.get('error','')))" 2>/dev/null)
  case "$rok" in
    yes)
      hist=$(curl -s -H "$H" "$BASE/jobs/$ID/sketch/history" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('history',[])))" 2>/dev/null)
      at=$(curl -s -H "$H" "$BASE/jobs/$ID/sketch/history" | python3 -c "import json,sys; h=json.load(sys.stdin).get('history',[]); print(h[0]['at'] if h else '')" 2>/dev/null)
      rb=$(curl -s -X POST -H "$H" -H 'content-type: application/json' -d "{\"at\":\"$at\"}" "$BASE/jobs/$ID/sketch/rollback" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ok'))" 2>/dev/null)
      # Откат возвращает прошлый лист, а новый уходит в историю: версий не убывает.
      [ "${hist:-0}" -ge 1 ] && [ "$rb" = "True" ] \
        && ok "(перерисован, версий в истории: $hist, откат прошёл)" \
        || bad "перерисовка: история=${hist:-0}, откат=$rb" ;;
    no:*) ok "(сторож не принял новый лист: ${rok#no:} — прошлый оставлен)" ;;
    *) bad "перерисовка не ответила: $rd" ;;
  esac
else
  ok "(эскиза нет — перерисовывать нечего)"
fi

step "13t. колорвеи в цвете — на эскизе этой вещи, не на параметрической схеме"
if [ "$code" = "200" ]; then
  cw=$(curl -s -H "$H" "$BASE/jobs/$ID/preview" | grep -o 'cw-raster' | wc -l | tr -d ' ')
  # Два колорвея заданы анкетой — два эскиза в цвете. Схема осталась бы
  # третьим рисунком одной вещи.
  [ "${cw:-0}" -ge 2 ] && ok "(эскизов в цвете: $cw)" || bad "колорвеи не легли на эскиз (cw-raster: ${cw:-0})"
else
  ok "(эскиза нет — колорвеи на схеме)"
fi

step "13n. очередь открытых решений: подтверждение убирает решение и меняет спеку"
q=$(curl -s -H "$H" "$BASE/jobs/$ID/decisions")
open0=$(echo "$q" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['summary']['open'])" 2>/dev/null)
first=$(echo "$q" | python3 -c "import json,sys; d=json.load(sys.stdin); a=[x for x in d['decisions'] if x['kind']=='assumption' and 'confirm' in x['actions']]; print(a[0]['id'] if a else '')" 2>/dev/null)
if [ -z "$first" ]; then
  bad "в очереди нет ни одного предположения с подтверждением (открытых: ${open0:-?})"
else
  r=$(curl -s -X POST -H "$H" -H 'content-type: application/json' -d "{\"id\":\"$first\",\"action\":\"confirm\"}" "$BASE/jobs/$ID/decisions")
  open1=$(echo "$r" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['summary']['open'])" 2>/dev/null)
  score=$(echo "$r" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['summary']['score'])" 2>/dev/null)
  if [ "${open1:-0}" -eq $(( open0 - 1 )) ]; then ok "($first: $open0 → $open1 · готовность $score/10)"; else bad "подтверждение не убрало решение: $open0 → ${open1:-?}"; fi
fi

step "13o. очередь и документ говорят одно: подтверждённое стало «указано вами»"
code=$(echo "$first" | sed 's/^[a-z]*://')
conf=$(curl -s -H "$H" $BASE/jobs/$ID/spec | python3 -c "
import json,sys; s=json.load(sys.stdin)['spec']; c='$code'
for p in s['measurements']['points']:
    if p['code']==c: print(p['base']['confidence']); break
else:
    for n in (s.get('construction') or {}).get('nodes',[]):
        if n['node_id']==c: print(n['presence']['confidence']); break
    else:
        for l in (s.get('bom') or {}).get('lines',[]):
            if l['code']==c: print(l['composition']['confidence']); break
" 2>/dev/null)
[ "$conf" = "user_input" ] && ok "($code)" || bad "после подтверждения уверенность «$conf», а не user_input"

step "13l. документ говорит, как задан масштаб"
body=$(curl -s -H "$H" "$BASE/jobs/$ID/preview")
if echo "$body" | grep -q "Масштаб задан размером" || echo "$body" | grep -q "Масштаб измерен"; then ok; else bad "о масштабе не сказано ничего"; fi

step "14. публичная ссылка на пак"
tok=$(curl -s -X POST -H "$H" $BASE/jobs/$ID/share | python3 -c "import json,sys; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
if [ -z "$tok" ]; then
  # Гейт держит документ: это штатный отказ, а не поломка — проверяем его,
  # а не выдачу ссылки.
  gaps=$(curl -s -H "$H" "$BASE/jobs/$ID/readiness" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['gaps']))" 2>/dev/null)
  [ "${gaps:-0}" -gt 0 ] && ok "(гейт держит: пробелов $gaps)" || bad "ссылки нет и гейт не объясняет почему"
else
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8132/p/$tok")
  [ "$code" = "200" ] && ok || bad "публичный документ $code"
fi

step "14б. ссылка для фабрики говорит на трёх языках"
langs=0
for pair in ":Табель мер" "?locale=en:Points of Measure" "?locale=zh:尺寸表"; do
  q="${pair%%:*}"; want="${pair#*:}"
  curl -s "http://127.0.0.1:8132/p/$tok$q" | grep -q "$want" && langs=$((langs+1))
done
[ "$langs" = "3" ] && ok || bad "языков работает $langs из 3"

step "15. просчёт собирает лист"
gaps=$(curl -s -X POST -H "$H" -H 'content-type: application/json' -d '{"comment":"QA"}' $BASE/jobs/$ID/quote | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if d.get('ok') else 'нет')" 2>/dev/null)
[ "$gaps" = "ok" ] && ok || bad "просчёт не прошёл"

step "16. лист на просчёт скачивается"
size=$(curl -s -o /dev/null -w '%{size_download}' -H "$H" "$BASE/jobs/$ID/rfq")
[ "$size" -gt 20000 ] && ok || bad "лист $size байт"

step "17. лист на китайском скачивается"
size=$(curl -s -o /dev/null -w '%{size_download}' -H "$H" "$BASE/jobs/$ID/rfq?locale=zh")
[ "$size" -gt 20000 ] && ok || bad "китайский лист $size байт"

step "18. чужой пак не виден"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "x-invite: 17059d0df20e14e19831" $BASE/jobs/$ID/spec)
[ "$code" = "404" ] && ok || bad "чужой пак отдан ($code)"

step "19. второе фото добавляется к первому"
cnt=$(curl -s -X POST -H "$H" -H 'content-type: image/png' --data-binary @golden/photos/hoodie-back.png "$BASE/jobs/$ID/photos?view=back_flat" | python3 -c "import json,sys; print(json.load(sys.stdin).get('count',0))" 2>/dev/null)
[ "${cnt:-0}" -ge 2 ] && ok || bad "второе фото не принято (count=${cnt:-0})"

step "20. пустой файл отклоняется"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$H" -H 'content-type: image/png' --data-binary "" "$BASE/jobs/$ID/photos")
[ "$code" = "413" ] && ok || bad "пустой файл принят ($code)"

step "21. уведомления читаются"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" $BASE/notifications)
[ "$code" = "200" ] && ok || bad "уведомления $code"

step "22. реферальная ссылка выдаётся"
ref=$(curl -s -H "$H" $BASE/referral | python3 -c "import json,sys; print(json.load(sys.stdin).get('code',''))" 2>/dev/null)
[ -n "$ref" ] && ok || bad "реферальный код пуст"

step "23. профиль бренда читается"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" $BASE/profile)
[ "$code" = "200" ] && ok || bad "профиль $code"

step "24. квота видна человеку"
left=$(curl -s -H "$H" $BASE/me | python3 -c "import json,sys; print(json.load(sys.stdin)['limits']['left'])" 2>/dev/null)
[ -n "$left" ] && echo "ok (осталось $left)" || bad "квота не читается"

step "25. исчерпанная квота отказывает с объяснением"
if [ "${left:-1}" = "0" ]; then
  body=$(curl -s -X POST -H "$H" -H 'content-type: application/json' -d '{
    "id":"qa2","name":"QA лимит","article":"QA-LIM","category":"tshirt",
    "gender":"women","base_size_ru":46,"base_height_cm":170,
    "fit_intent":"semi_fitted","fabric_kind":"knit","size_range":[46],
    "machine_park":"base_shop"}' $BASE/jobs)
  has=$(echo "$body" | python3 -c "import json,sys; d=json.load(sys.stdin); print('да' if d.get('error') and d.get('action') else 'нет')" 2>/dev/null)
  [ "$has" = "да" ] && ok || bad "отказ без объяснения: $body"
else
  echo "пропуск (квота не исчерпана)"
fi

step "26. табель мер таблицей скачивается"
csv=$(curl -s -H "$H" "$BASE/jobs/$ID/pom.csv")
rows=$(echo "$csv" | wc -l | tr -d ' ')
[ "$rows" -gt 10 ] && ok || bad "в таблице $rows строк"

step "27. таблица открывается в Excel без кракозябр"
first=$(curl -s -H "$H" "$BASE/jobs/$ID/pom.csv" | head -c 3 | xxd -p)
[ "$first" = "efbbbf" ] && ok || bad "нет метки порядка байтов ($first)"

step "28. китайская таблица помечает полуобхваты"
curl -s -H "$H" "$BASE/jobs/$ID/pom.csv?locale=zh" | grep -q "1/2" && ok || bad "нет 1/2 в китайской таблице"

echo
echo "проблем: $fail · пак $ID"
exit $fail
