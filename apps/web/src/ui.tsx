import { useState } from 'react';

/**
 * Мелкие элементы из хендоффа: статус-точки, чипы, тултипы терминов,
 * кикеры. Значения стилей — из README хендоффа, не округлены.
 */

export const STATUS_RU: Record<string, string> = {
  fit_confirmed: 'подтверждено по образцу',
  user_input: 'указано вами',
  measured_by_scale: 'снято по масштабу',
  estimated_from_photo: 'оценка по фото',
  default_from_base: 'типовое значение',
  assumption: 'предположение',
};

export function Dot({ status }: { status: string }) {
  return <span className={`dot ${status}`} />;
}

export function Kicker({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className="kicker" style={style}>
      {children}
    </div>
  );
}

/** Тултип термина: пунктирное подчёркивание, чёрная карточка ≤240px. */
export function Term({ text, tip }: { text: string; tip: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      style={{ position: 'relative', borderBottom: '1px dashed var(--lib-grey)', cursor: 'help' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {text}
      {open && (
        <span
          style={{
            position: 'absolute',
            bottom: '130%',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--ink)',
            color: '#fff',
            borderRadius: 10,
            padding: '9px 12px',
            width: 240,
            fontSize: 11.5,
            lineHeight: 1.5,
            zIndex: 60,
            fontWeight: 400,
            boxShadow: 'var(--shadow-menu)',
            animation: 'sfup 140ms ease',
            whiteSpace: 'normal',
            textTransform: 'none',
            letterSpacing: 'normal',
          }}
        >
          {tip}
        </span>
      )}
    </span>
  );
}

export function StatusChip({ stage }: { stage: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    done: { label: 'Готов', color: 'var(--confirm-green)', bg: 'rgba(47,124,90,.1)' },
    error: { label: 'Ошибка', color: 'var(--data-red)', bg: 'rgba(192,57,43,.08)' },
    queued: { label: 'Черновик', color: 'var(--secondary)', bg: 'rgba(14,14,14,.05)' },
  };
  const m = map[stage] ?? { label: 'Генерация', color: 'var(--ink)', bg: 'rgba(14,14,14,.05)' };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 600,
        color: m.color,
        background: m.bg,
      }}
    >
      {m.label}
    </span>
  );
}

/** Силуэт категории — плейсхолдер черновиков (хендофф, обновление 11). */
export function Silhouette({ category, size = 40 }: { category: string; size?: number }) {
  const hood = category === 'hoodie';
  const short = category === 'tshirt';
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" style={{ display: 'block' }}>
      {hood && <path d="M15 8c0-3 10-3 10 0l1 4H14l1-4Z" stroke="#B0ADA6" strokeWidth="1.4" />}
      <path
        d={
          short
            ? 'M14 12 8 15l3 6 3-1v12h12V20l3 1 3-6-6-3c-2 2-8 2-12 0Z'
            : 'M14 12 8 15l2 14 4-1v6h12v-6l4 1 2-14-6-3c-2 2-8 2-12 0Z'
        }
        stroke="#B0ADA6"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Menu({
  items,
  onClose,
}: {
  items: { label: string; danger?: boolean; onClick: () => void }[];
  onClose: () => void;
}) {
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={onClose} />
      <div
        className="sfup"
        style={{
          position: 'absolute',
          right: 0,
          top: '100%',
          marginTop: 6,
          background: '#fff',
          borderRadius: 12,
          boxShadow: 'var(--shadow-menu)',
          padding: 6,
          zIndex: 50,
          minWidth: 190,
        }}
      >
        {items.map((item) => (
          <button
            key={item.label}
            onClick={() => {
              onClose();
              item.onClick();
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              border: 0,
              background: 'none',
              padding: '9px 12px',
              borderRadius: 8,
              fontSize: 13,
              color: item.danger ? 'var(--data-red)' : 'var(--ink)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(14,14,14,.05)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
