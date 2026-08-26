/**
 * Админский канал в Телеграме: что происходит в кабинете прямо сейчас.
 *
 * Раньше единственными глазами была страница созвонов — её надо было
 * открыть, чтобы узнать, что кто-то застрял. Телеграм переворачивает это:
 * событие само находит человека.
 *
 * Ключевое решение — ДВА КЛАССА СОБЫТИЙ. Если слать сообщение на каждое
 * действие, канал за один созвон превратится в ленту, которую никто не
 * читает, и настоящая авария утонет между двумя переходами по разделам.
 * Поэтому:
 *
 *  - важное (пришёл человек, запустил генерацию, пак готов, сбой, скачал
 *    PDF, отправил на просчёт, привёл друга) — сразу и со звуком;
 *  - остальное (навигация, правки замеров, открытия разделов) — копится
 *    и уходит дайджестом раз в DIGEST_MS, сгруппированное по людям,
 *    беззвучно. Ничего не теряется, но и не мешает.
 *
 * Телеграм недоступен — это не повод отвечать пользователю ошибкой:
 * все отправки «выстрелил и забыл», сбой уходит в консоль сервера.
 */
import { readFileSync } from 'node:fs';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHAT = process.env.TELEGRAM_ADMIN_ID ?? '';

/** Как часто выпускать дайджест мелких событий. */
const DIGEST_MS = 10 * 60 * 1000;

/** Сколько строк дайджеста максимум — телеграм режет сообщение на 4096 символах. */
const DIGEST_MAX_LINES = 60;

export const telegramReady = Boolean(TOKEN && CHAT);

/** Экранирование под parse_mode=HTML. Тексты приходят от людей. */
function esc(x: unknown): string {
  return String(x ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function call(method: string, body: unknown): Promise<void> {
  if (!telegramReady) return;
  try {
    const response = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, ...(body as object) }),
    });
    if (!response.ok) {
      // Тело ответа Телеграма — метаданные сбоя, содержимого пользователя в нём нет.
      console.error(
        `telegram ${method}: ${response.status} ${(await response.text()).slice(0, 200)}`,
      );
    }
  } catch (error) {
    console.error(`telegram ${method}:`, String(error).slice(0, 200));
  }
}

/** Немедленное сообщение. Для событий, ради которых стоит поднять телефон. */
export function tgNotify(title: string, lines: string[] = [], silent = false): void {
  const text = [`<b>${esc(title)}</b>`, ...lines.map(esc)].join('\n');
  void call('sendMessage', { text, parse_mode: 'HTML', disable_notification: silent });
}

/** Отправка готового файла — техпак уходит на просчёт как документ. */
export async function tgDocument(path: string, filename: string, caption: string): Promise<void> {
  if (!telegramReady) return;
  try {
    const form = new FormData();
    form.set('chat_id', CHAT);
    form.set('caption', caption.slice(0, 1024));
    form.set('parse_mode', 'HTML');
    form.set('document', new Blob([readFileSync(path)], { type: 'application/pdf' }), filename);
    const response = await fetch(`https://api.telegram.org/bot${TOKEN}/sendDocument`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) {
      console.error(
        `telegram sendDocument: ${response.status} ${(await response.text()).slice(0, 200)}`,
      );
    }
  } catch (error) {
    console.error('telegram sendDocument:', String(error).slice(0, 200));
  }
}

// ------------------------------------------------------------------ дайджест

const pending = new Map<string, string[]>();
let timer: NodeJS.Timeout | null = null;

/** Мелкое событие: копится и уходит в общем дайджесте. */
export function tgTrace(who: string, line: string): void {
  if (!telegramReady) return;
  const at = new Date().toTimeString().slice(0, 5);
  const list = pending.get(who) ?? [];
  list.push(`${at} · ${line}`);
  pending.set(who, list);
  if (!timer) {
    timer = setTimeout(flush, DIGEST_MS);
    // Дайджест не должен держать процесс живым при остановке сервиса.
    timer.unref?.();
  }
}

function flush(): void {
  timer = null;
  if (pending.size === 0) return;
  const blocks: string[] = [];
  let lines = 0;
  for (const [who, list] of pending) {
    const shown = list.slice(0, Math.max(0, DIGEST_MAX_LINES - lines));
    lines += shown.length;
    const tail = list.length > shown.length ? `\n… и ещё ${list.length - shown.length}` : '';
    blocks.push(`<b>${esc(who)}</b>\n${shown.map(esc).join('\n')}${tail}`);
    if (lines >= DIGEST_MAX_LINES) break;
  }
  pending.clear();
  void call('sendMessage', {
    text: `<b>Что делали за последние 10 минут</b>\n\n${blocks.join('\n\n')}`,
    parse_mode: 'HTML',
    disable_notification: true,
  });
}
