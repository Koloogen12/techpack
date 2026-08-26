import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css';
import { api, inviteToken } from './api.js';
import { StoreProvider, useStore } from './store.js';
import { Sidebar } from './sidebar.js';
import { Home, Packs } from './home.js';
import { Wizard } from './wizard.js';
import { Generating } from './generating.js';
import { Doc } from './doc.js';
import { Library, Billing } from './library.js';

/**
 * Каркас кабинета — хендофф: промо-бар · сайдбар 300px · канвас.
 * Промо-бар скрыт на рабочих экранах (документ, мастер, генерация) —
 * как в прототипе.
 */

function Shell() {
  const s = useStore();
  const working = s.screen === 'doc' || s.screen === 'wizard' || s.screen === 'generating';

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {!working && (
        <div
          style={{
            height: 34,
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            background: '#D9F2E3',
            borderBottom: '1px solid #9FD8B6',
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 3, background: '#1F8A4C' }} />
          <span style={{ fontSize: 11.5, color: '#0D4F2B' }}>
            Ранний доступ: 3 техпака в месяц бесплатно
          </span>
          <span
            onClick={() => s.showToast('Записали в лист ожидания')}
            style={{
              padding: '3px 12px',
              borderRadius: 999,
              background: '#1F8A4C',
              color: '#fff',
              fontSize: 10.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Подключить
          </span>
        </div>
      )}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Sidebar />
        <div
          style={{
            flex: 1,
            minWidth: 0,
            position: 'relative',
            overflow: s.screen === 'doc' ? 'hidden' : 'auto',
          }}
        >
          {s.screen === 'home' && <Home />}
          {s.screen === 'packs' && <Packs />}
          {s.screen === 'wizard' && <Wizard />}
          {s.screen === 'generating' && <Generating />}
          {s.screen === 'doc' && <Doc />}
          {s.screen === 'library' && <Library />}
          {s.screen === 'billing' && <Billing />}
        </div>
      </div>
      {s.toast && (
        <div className="toast">
          <span className="dot" /> {s.toast}
        </div>
      )}
    </div>
  );
}

function App() {
  const [me, setMe] = useState<{ name: string; org: string } | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!inviteToken()) {
      setDenied(true);
      return;
    }
    api
      .me()
      .then(setMe)
      .catch(() => setDenied(true));
  }, []);

  if (denied) {
    return (
      <div style={{ height: '100vh', display: 'grid', placeItems: 'center' }}>
        <div className="card sfup" style={{ width: 400, padding: '36px 34px' }}>
          <Logo />
          <h1 style={{ fontSize: 21, margin: '18px 0 10px' }}>Вход по приглашению</h1>
          <div style={{ color: 'var(--secondary)', fontSize: 14, lineHeight: 1.55 }}>
            Это закрытая бета. Откройте ссылку, которую вам прислали, — целиком, вместе с её
            хвостом. Если ссылка не срабатывает, напишите тому, кто вас пригласил.
          </div>
        </div>
      </div>
    );
  }

  if (!me) return null;

  return (
    <StoreProvider me={me}>
      <Shell />
    </StoreProvider>
  );
}

export function Logo({ size = 44 }: { size?: number }) {
  const r = Math.round(size * 0.32);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: r,
        background: 'var(--ink)',
        display: 'grid',
        placeItems: 'center',
        flex: 'none',
      }}
    >
      <svg width={size / 2} height={size / 2} viewBox="0 0 22 22" fill="none">
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
