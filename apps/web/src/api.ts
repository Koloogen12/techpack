import type { StyleSpec } from '@seamsterly/stylespec';
/**
 * Клиент API. Токен инвайта живёт в URL и в sessionStorage: человек получил
 * ссылку в мессенджере, открыл — и он внутри. Никаких паролей на созвоне.
 */
const KEY = 'seamsterly_invite';

export function inviteToken(): string | null {
  const fromUrl = new URLSearchParams(location.search).get('t');
  if (fromUrl) {
    sessionStorage.setItem(KEY, fromUrl);
    // Токен убирается из адресной строки: он не должен попасть в скриншот
    // созвона и в историю, которой делятся.
    const url = new URL(location.href);
    url.searchParams.delete('t');
    history.replaceState(null, '', url.toString());
    return fromUrl;
  }
  return sessionStorage.getItem(KEY);
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = inviteToken();
  const response = await fetch(`/app/api${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(token ? { 'x-invite': token } : {}) },
  });
  const body = (await response.json().catch(() => null)) as
    (T & { error?: string; detail?: string }) | null;
  if (!response.ok || body === null) {
    throw new Error(body?.error ?? `ошибка ${response.status}`);
  }
  return body;
}

export const api = {
  me: () => call<{ name: string; org: string }>('/me'),
  createJob: (answers: unknown) =>
    call<{ id: string }>('/jobs', { method: 'POST', body: JSON.stringify(answers) }),
  uploadPhoto: async (id: string, file: File, view: string | null) => {
    const token = inviteToken();
    const q = view ? `?view=${view}` : '';
    const response = await fetch(`/app/api/jobs/${id}/photos${q}`, {
      method: 'POST',
      headers: {
        'content-type': file.type || 'image/jpeg',
        ...(token ? { 'x-invite': token } : {}),
      },
      body: file,
    });
    if (!response.ok) throw new Error('фото не загрузилось');
  },
  start: (id: string) => call<{ ok: true }>(`/jobs/${id}/start`, { method: 'POST' }),
  status: (id: string) => call<JobStatus>(`/jobs/${id}/status`),
  spec: (id: string) => call<SpecPayload>(`/jobs/${id}/spec`),
  edit: (id: string, code: string, value_cm: number) =>
    call<SpecPayload & { changed: { code: string; from_cm: number; to_cm: number }[] }>(
      `/jobs/${id}/measurements`,
      { method: 'PATCH', body: JSON.stringify({ code, value_cm }) },
    ),
  pdfUrl: (id: string) => {
    const token = inviteToken();
    return `/app/api/jobs/${id}/pdf?t=${token ?? ''}`;
  },
  event: (type: string, payload?: unknown) =>
    call<{ ok: true }>('/events', {
      method: 'POST',
      body: JSON.stringify({ type, payload }),
    }).catch(() => null),
};

export interface JobStatus {
  id: string;
  stage: 'queued' | 'vision' | 'assembly' | 'render' | 'docgen' | 'done' | 'error';
  history: { stage: string; at: string; detail?: string }[];
  error?: { message: string; action: string };
  notes?: string[];
}

// Спека приходит как есть; типизируем поверхностно — источник правды на сервере.
export interface SpecPayload {
  spec: StyleSpec;
  flat_defaults: { depthCm?: number; minSleeveAngleDeg?: number };
}
