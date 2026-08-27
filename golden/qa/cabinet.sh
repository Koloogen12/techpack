#!/bin/bash
# Сквозной прогон кабинета: инвайт → пак → генерация → документ → правка
# замера → PDF → просчёт. Не «сервер отвечает 200», а «человек прошёл путь».
set -u
BASE=http://127.0.0.1:8132/app/api
H="x-invite: localdemo1234567890"
fail=0
step() { printf '%-46s' "$1"; }
ok()   { echo "ok"; }
bad()  { echo "ПРОБЛЕМА: $1"; fail=$((fail+1)); }

step "1. кабинет отвечает"
[ "$(curl -s -o /dev/null -w '%{http_code}' $BASE/health)" = "200" ] && ok || bad "health не 200"

step "2. без инвайта доступа нет"
code=$(curl -s -o /dev/null -w '%{http_code}' $BASE/jobs)
[ "$code" = "401" ] || [ "$code" = "403" ] && ok || bad "открыто без инвайта ($code)"

step "3. создание пака"
ID=$(curl -s -X POST -H "$H" -H 'content-type: application/json' -d '{
  "id":"qa","name":"QA прогон","article":"QA-E2E-001","category":"hoodie",
  "gender":"women","base_size_ru":46,"base_height_cm":170,
  "fit_intent":"oversize","fabric_kind":"knit","size_range":[44,46,48],
  "machine_park":"base_shop","batch_qty":100
}' $BASE/jobs | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
[ -n "$ID" ] && ok || { bad "пак не создан"; exit 1; }

step "4. генерация запускается"
curl -s -o /dev/null -X POST -H "$H" $BASE/jobs/$ID/start
for i in $(seq 1 60); do
  stage=$(curl -s -H "$H" $BASE/jobs/$ID/status | python3 -c "import json,sys; print(json.load(sys.stdin).get('stage',''))" 2>/dev/null)
  [ "$stage" = "done" ] && break
  [ "$stage" = "error" ] && break
  sleep 3
done
[ "$stage" = "done" ] && ok || bad "стадия $stage"

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

step "14. публичная ссылка на пак"
tok=$(curl -s -X POST -H "$H" $BASE/jobs/$ID/share | python3 -c "import json,sys; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8132/p/$tok")
[ "$code" = "200" ] && ok || bad "публичный документ $code"

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

step "19. фото принимается с ракурсом"
cnt=$(curl -s -X POST -H "$H" -H 'content-type: image/png' --data-binary @golden/photos/hoodie-front.png "$BASE/jobs/$ID/photos?view=front_flat" | python3 -c "import json,sys; print(json.load(sys.stdin).get('count',0))" 2>/dev/null)
[ "${cnt:-0}" -ge 1 ] && ok || bad "фото не принято"

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
