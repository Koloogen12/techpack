import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css';
import { api, inviteToken } from './api';
import { Wizard } from './wizard';
import { Generating } from './generating';
import { Workspace } from './workspace';

/**
 * Демо-срез: один путь без ветвлений.
 * Инвайт → мастер (фото + 5 вопросов) → генерация → рабочий документ.
 *
 * Роутер не нужен: состояние — это положение на пути, и назад по нему
 * ходят кнопками, а не адресной строкой. Приёмка требует пройти путь
 * без подсказок голосом — значит каждый экран обязан сам говорить,
 * что делать дальше.
 */
type Step =
  | { at: 'gate' }
  | { at: 'denied' }
  | { at: 'wizard'; name: string }
  | { at: 'generating'; name: string; jobId: string }
  | { at: 'workspace'; name: string; jobId: string };

function App() {
  const [step, setStep] = useState<Step>({ at: 'gate' });

  useEffect(() => {
    if (!inviteToken()) {
      setStep({ at: 'denied' });
      return;
    }
    api
      .me()
      .then(async (me) => {
        // Перезагрузка страницы посреди созвона не должна терять пак:
        // если последняя генерация дошла до конца, открываем её документ.
        const saved = sessionStorage.getItem('seamsterly_job');
        if (saved) {
          try {
            const s = await api.status(saved);
            if (s.stage === 'done') {
              setStep({ at: 'workspace', name: me.name, jobId: saved });
              return;
            }
          } catch {
            sessionStorage.removeItem('seamsterly_job');
          }
        }
        setStep({ at: 'wizard', name: me.name });
      })
      .catch(() => setStep({ at: 'denied' }));
  }, []);

  if (step.at === 'gate') return null;

  if (step.at === 'denied') {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <div className="card sfup" style={{ width: 400, padding: '36px 34px' }}>
          <Logo />
          <h1 style={{ fontSize: 21, margin: '18px 0 10px' }}>Вход по приглашению</h1>
          <div style={{ color: 'var(--secondary)', fontSize: 14, lineHeight: 1.55 }}>
            Это закрытая демонстрация. Откройте ссылку, которую вам прислали, — целиком, вместе с её
            хвостом. Если ссылка не срабатывает, напишите тому, кто вас пригласил.
          </div>
        </div>
      </div>
    );
  }

  if (step.at === 'wizard') {
    return (
      <Wizard
        name={step.name}
        onLaunched={(jobId) => {
          sessionStorage.setItem('seamsterly_job', jobId);
          setStep({ at: 'generating', name: step.name, jobId });
        }}
      />
    );
  }

  if (step.at === 'generating') {
    return (
      <Generating
        jobId={step.jobId}
        onDone={() => setStep({ at: 'workspace', name: step.name, jobId: step.jobId })}
        onRetry={() => setStep({ at: 'wizard', name: step.name })}
      />
    );
  }

  return (
    <Workspace
      jobId={step.jobId}
      onNew={() => {
        sessionStorage.removeItem('seamsterly_job');
        setStep({ at: 'wizard', name: step.name });
      }}
    />
  );
}

export function Logo() {
  return (
    <div
      style={{
        width: 44,
        height: 44,
        borderRadius: 14,
        background: 'var(--ink)',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path
          d="M3 7.5 11 3l8 4.5-8 4.5-8-4.5Z"
          stroke="#fff"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M3 11.5 11 16l8-4.5"
          stroke="#fff"
          strokeWidth="1.6"
          strokeLinejoin="round"
          opacity=".65"
        />
        <path
          d="M3 15.5 11 20l8-4.5"
          stroke="#fff"
          strokeWidth="1.6"
          strokeLinejoin="round"
          opacity=".35"
        />
      </svg>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
