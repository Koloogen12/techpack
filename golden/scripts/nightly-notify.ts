/**
 * Итог ночного прогона золотого набора — одной строкой в лог и в админский
 * Телеграм. Аргумент — код выхода vitest: 0 — планка взята, сообщение тихое;
 * иначе — громкое, ради него стоит поднять телефон. Без токена только лог.
 *
 * Свежесть: строка истории старше половины суток — не сегодняшняя. Прогон,
 * упавший до записи отчёта (ключ, сеть), не должен показывать вчерашние
 * проценты как свои.
 */
import { readFileSync } from 'node:fs';

interface Summary {
  at: string;
  entries: number;
  skipped: string[];
  observation_accuracy: number | null;
  node_recall: number | null;
  node_precision_absent: number | null;
  prompt_version: string;
  schema_version: string;
}

const OUT = (process.env.SEAMSTER_GOLDEN_OUT ?? 'golden/reports').replace(/\/?$/, '/');
const code = Number(process.argv[2] ?? '1');
const FRESH_MS = 12 * 3600 * 1000;

function latest(): Summary | null {
  try {
    const lines = readFileSync(`${OUT}vocabulary-history.jsonl`, 'utf8').trim().split('\n');
    const s = JSON.parse(lines[lines.length - 1]!) as Summary;
    return Date.now() - Date.parse(s.at) < FRESH_MS ? s : null;
  } catch {
    return null;
  }
}

const pct = (x: number | null): string => (x === null ? '—' : `${Math.round(x * 100)}%`);
const s = latest();
const text = s
  ? `словари ${pct(s.observation_accuracy)}, узлы: полнота ${pct(s.node_recall)}, ` +
    `лишних нет ${pct(s.node_precision_absent)} · снимков ${s.entries}` +
    (s.skipped.length ? `, пропущено ${s.skipped.length}` : '') +
    ` · промпт ${s.prompt_version}, схема ${s.schema_version}`
  : 'отчёта за сегодня нет — прогон не дошёл до конца, смотрите лог';
const title = code === 0 && s ? 'Золотой набор: планка взята' : 'Золотой набор: ниже планки';
console.log(`${title} — ${text}`);

const token = process.env.TELEGRAM_BOT_TOKEN;
const chat = process.env.TELEGRAM_ADMIN_ID;
if (token && chat) {
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chat,
      parse_mode: 'HTML',
      disable_notification: code === 0 && Boolean(s),
      text: `<b>${esc(title)}</b>\n${esc(text)}`,
    }),
  });
  if (!response.ok)
    console.error(`telegram: ${response.status} ${(await response.text()).slice(0, 200)}`);
}
