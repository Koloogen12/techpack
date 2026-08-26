import { useRef, useState } from 'react';
import { api } from './api';
import { Logo } from './main';

/**
 * Мастер: фото + пять вопросов. По ux/01 F1 и хендоффу (экран 4).
 *
 * Два шага, прогресс-полоса сверху. Ничего лишнего: человек на созвоне
 * должен дойти до кнопки «Запустить генерацию» без подсказок голосом.
 */

const CATEGORIES = [
  { id: 'tshirt', label: 'Футболка' },
  { id: 'longsleeve', label: 'Лонгслив' },
  { id: 'sweatshirt', label: 'Свитшот' },
  { id: 'hoodie', label: 'Худи' },
] as const;

const FITS = [
  { id: 'fitted', label: 'Прилегающая' },
  { id: 'semi_fitted', label: 'Обычная' },
  { id: 'loose', label: 'Свободная' },
  { id: 'oversize', label: 'Oversize' },
] as const;

const FABRICS = [
  { id: 'knit', label: 'Трикотаж' },
  { id: 'woven', label: 'Ткань' },
] as const;

const SIZES = [42, 44, 46, 48, 50, 52, 54];

/** Ракурс снимка. Объявленный ракурс поднимает точность разбора. */
const VIEWS = [
  { id: 'front', label: 'перед' },
  { id: 'back', label: 'спинка' },
  { id: 'side', label: 'бок' },
  { id: 'flat', label: 'разложено' },
] as const;

interface Shot {
  file: File;
  url: string;
  view: string | null;
}

export function Wizard({ name, onLaunched }: { name: string; onLaunched: (id: string) => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [shots, setShots] = useState<Shot[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [gender, setGender] = useState<'women' | 'men' | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [height, setHeight] = useState('170');
  const [fit, setFit] = useState<string | null>(null);
  const [fabric, setFabric] = useState<string>('knit');
  const [range, setRange] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const next = [...shots];
    for (const file of Array.from(files)) {
      if (next.length >= 6) break;
      if (!file.type.startsWith('image/')) continue;
      next.push({ file, url: URL.createObjectURL(file), view: next.length === 0 ? 'front' : null });
    }
    setShots(next);
    void api.event('photos_added', { count: next.length });
  };

  const ready2 =
    category !== null && gender !== null && size !== null && fit !== null && range.length > 0;

  const launch = async () => {
    if (!ready2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const sizes = [...new Set([...range, size!])].sort((a, b) => a - b);
      const { id } = await api.createJob({
        id: `demo-${Date.now()}`,
        name: `${CATEGORIES.find((c) => c.id === category)!.label}`,
        article: `DEMO-${String(Date.now()).slice(-6)}`,
        category,
        gender,
        base_size_ru: size,
        base_height_cm: Number(height) || 170,
        fit_intent: fit,
        fabric_kind: fabric,
        size_range: sizes,
        quantity: 100,
      });
      for (const shot of shots) await api.uploadPhoto(id, shot.file, shot.view);
      await api.start(id);
      onLaunched(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'не получилось запустить');
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Прогресс-полоса мастера */}
      <div style={{ height: 3, background: 'rgba(14,14,14,.08)' }}>
        <div
          style={{
            height: '100%',
            background: 'var(--ink)',
            width: step === 1 ? '33%' : '66%',
            transition: 'width 300ms ease',
          }}
        />
      </div>

      <div style={{ maxWidth: 880, margin: '0 auto', padding: '48px 32px 96px', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 34 }}>
          <Logo />
          <div>
            <div className="kicker">Seamsterly · демонстрация</div>
            <div style={{ fontSize: 15, marginTop: 3 }}>Здравствуйте, {name}</div>
          </div>
        </div>

        {step === 1 && (
          <div className="sfup">
            <h1 style={{ fontSize: 32, letterSpacing: '-1px', margin: '0 0 8px' }}>
              Фото или эскиз
            </h1>
            <div
              style={{
                color: 'var(--secondary)',
                marginBottom: 26,
                maxWidth: 560,
                lineHeight: 1.55,
              }}
            >
              Достаточно одного снимка спереди. Каждый следующий ракурс открывает новые точки замера
              — спинка, бок, разложенное на столе.
            </div>

            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
              style={{
                border: '1.5px dashed var(--lib-grey)',
                borderRadius: 14,
                padding: '42px 24px',
                textAlign: 'center',
                cursor: 'pointer',
                background: 'var(--paper)',
              }}
            >
              <div style={{ fontSize: 15.5, fontWeight: 600 }}>
                Перетащите фото сюда или нажмите
              </div>
              <div style={{ color: 'var(--secondary)', fontSize: 13, marginTop: 6 }}>
                {shots.length} из 6 · JPG, PNG, WebP
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => addFiles(e.target.files)}
              />
            </div>

            {shots.length > 0 && (
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 18 }}>
                {shots.map((shot, i) => (
                  <div key={i} className="panel" style={{ padding: 10, width: 148 }}>
                    <div style={{ position: 'relative' }}>
                      <img
                        src={shot.url}
                        alt=""
                        style={{ width: '100%', height: 108, objectFit: 'cover', borderRadius: 7 }}
                      />
                      <button
                        onClick={() => setShots(shots.filter((_, j) => j !== i))}
                        style={{
                          position: 'absolute',
                          top: 5,
                          right: 5,
                          width: 22,
                          height: 22,
                          borderRadius: 11,
                          border: 0,
                          background: 'rgba(14,14,14,.75)',
                          color: '#fff',
                          fontSize: 12,
                          lineHeight: 1,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                    {/* Ракурс — данные разбора, а не подпись картинки. */}
                    <select
                      value={shot.view ?? ''}
                      onChange={(e) =>
                        setShots(
                          shots.map((s, j) =>
                            j === i ? { ...s, view: e.target.value || null } : s,
                          ),
                        )
                      }
                      style={{ width: '100%', marginTop: 8, fontSize: 12, padding: '6px 8px' }}
                    >
                      <option value="">ракурс не указан</option>
                      {VIEWS.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 30, alignItems: 'center' }}>
              <button className="btn" onClick={() => setStep(2)}>
                Дальше — пять вопросов
              </button>
              {shots.length === 0 && (
                <span style={{ color: 'var(--secondary)', fontSize: 13 }}>
                  Можно и без фото — соберём по типовым пропорциям категории
                </span>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="sfup">
            <h1 style={{ fontSize: 32, letterSpacing: '-1px', margin: '0 0 8px' }}>
              Пять вопросов
            </h1>
            <div
              style={{
                color: 'var(--secondary)',
                marginBottom: 26,
                lineHeight: 1.55,
                maxWidth: 560,
              }}
            >
              Масштаб изделия приходит отсюда, а не с фотографии: абсолютные сантиметры по снимку
              недостижимы — это свойство оптики.
            </div>

            <Question n="01" title="Что за изделие">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  className={`chip ${category === c.id ? 'on' : ''}`}
                  onClick={() => setCategory(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </Question>

            <Question n="02" title="Для кого">
              <button
                className={`chip ${gender === 'women' ? 'on' : ''}`}
                onClick={() => setGender('women')}
              >
                Женское
              </button>
              <button
                className={`chip ${gender === 'men' ? 'on' : ''}`}
                onClick={() => setGender('men')}
              >
                Мужское
              </button>
            </Question>

            <Question n="03" title="Базовый размер и рост">
              {SIZES.map((s) => (
                <button
                  key={s}
                  className={`chip ${size === s ? 'on' : ''}`}
                  onClick={() => setSize(s)}
                >
                  RU {s}
                </button>
              ))}
              <span style={{ marginLeft: 10, color: 'var(--secondary)', fontSize: 13 }}>рост</span>
              <input
                type="number"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                style={{ width: 84 }}
              />
            </Question>

            <Question n="04" title="Посадка">
              {FITS.map((f) => (
                <button
                  key={f.id}
                  className={`chip ${fit === f.id ? 'on' : ''}`}
                  onClick={() => setFit(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </Question>

            <Question n="05" title="Полотно и размерный ряд">
              {FABRICS.map((f) => (
                <button
                  key={f.id}
                  className={`chip ${fabric === f.id ? 'on' : ''}`}
                  onClick={() => setFabric(f.id)}
                >
                  {f.label}
                </button>
              ))}
              <span style={{ width: 18 }} />
              {SIZES.map((s) => (
                <button
                  key={s}
                  className={`chip ${range.includes(s) ? 'on' : ''}`}
                  onClick={() =>
                    setRange(range.includes(s) ? range.filter((x) => x !== s) : [...range, s])
                  }
                >
                  {s}
                </button>
              ))}
            </Question>

            {error && (
              <div style={{ color: 'var(--data-red)', margin: '16px 0', fontSize: 13.5 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 30 }}>
              <button className="btn white" onClick={() => setStep(1)}>
                ← Назад
              </button>
              <button className="btn" disabled={!ready2 || busy} onClick={launch}>
                {busy ? 'Запускаем…' : 'Запустить генерацию'}
              </button>
              {!ready2 && (
                <span style={{ alignSelf: 'center', color: 'var(--secondary)', fontSize: 13 }}>
                  Не хватает:{' '}
                  {[
                    category === null && 'категория',
                    gender === null && 'для кого',
                    size === null && 'размер',
                    fit === null && 'посадка',
                    range.length === 0 && 'размерный ряд',
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Question({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="panel" style={{ padding: '18px 20px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
        <span className="mono" style={{ color: 'var(--tertiary)', fontSize: 11 }}>
          {n}
        </span>
        <span style={{ fontWeight: 600, fontSize: 15 }}>{title}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {children}
      </div>
    </div>
  );
}
