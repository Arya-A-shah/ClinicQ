import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useQueue } from '../lib/useQueue.js';

export default function StaffPage() {
  const [staff, setStaff] = useState(undefined); // undefined = checking, null = logged out
  useEffect(() => {
    api('/staff/me').then(setStaff).catch(() => setStaff(null));
  }, []);
  if (staff === undefined) return <div className="page"><div className="card muted">Loading…</div></div>;
  return staff ? <Dashboard staff={staff} onLogout={() => setStaff(null)} /> : <Login onLogin={setStaff} />;
}

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      onLogin(await api('/staff/login', { method: 'POST', body: { username, password } }));
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div className="page narrow">
      <form className="card" onSubmit={submit}>
        <h2>Reception login</h2>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn wide">Log in</button>
      </form>
    </div>
  );
}

function Dashboard({ staff, onLogout }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api('/staff/queue')
        .then(setData)
        .catch((e) => (e.status === 401 ? onLogout() : setError(e.message))),
    [onLogout]
  );
  const { connected } = useQueue(load);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn) => {
    setError('');
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="page"><div className="card muted">Loading queue…</div></div>;

  const { tokens, settings, state } = data;
  const current = tokens.find((t) => t.status === 'called');
  const waiting = tokens.filter((t) => t.status === 'waiting');
  const closed = tokens.filter((t) => !['waiting', 'called'].includes(t.status)).reverse();
  const seen = tokens.filter((t) => t.status === 'done').length;

  return (
    <div className="page wide-page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>+</span>
          <span>Reception · {state.date}</span>
        </div>
        <div className="topbar-right">
          <span className={`live ${connected ? 'on' : ''}`}>{connected ? 'Live' : 'Reconnecting…'}</span>
          <button className="link" onClick={() => api('/staff/logout', { method: 'POST' }).then(onLogout)}>
            Log out ({staff.username})
          </button>
        </div>
      </header>

      {error && <p className="error card">{error}</p>}

      <div className="staff-grid">
        <section className="card now-card">
          <span className="eyebrow">With the doctor</span>
          <div className="my-number">{current ? `#${current.number}` : '—'}</div>
          <p className="big-msg">{current ? current.patientName : 'No one called yet'}</p>
          <div className="row">
            <button className="btn huge" disabled={busy || waiting.length === 0} onClick={() => act(() => api('/staff/call-next', { method: 'POST' }))}>
              Call next{waiting[0] ? ` → #${waiting[0].number}` : ''}
            </button>
            {current && (
              <button className="btn ghost" disabled={busy} onClick={() => act(() => setStatus(current.id, 'skipped'))}>
                Didn't come
              </button>
            )}
          </div>
          <p className="muted small-text">
            Seen today: {seen} · Waiting: {waiting.length} · Issued: {state.tokensIssued}
          </p>
        </section>

        <WalkIn onAdd={(body) => act(() => api('/staff/walkin', { method: 'POST', body }))} busy={busy} />

        <Settings settings={settings} onSave={(body) => act(() => api('/staff/settings', { method: 'PATCH', body }))} busy={busy} />
      </div>

      <section className="card">
        <h3>Waiting ({waiting.length})</h3>
        {waiting.length === 0 ? (
          <p className="muted">Queue is empty.</p>
        ) : (
          <table className="queue">
            <thead>
              <tr><th>#</th><th>Name</th><th>Phone</th><th>Via</th><th>Booked</th><th></th></tr>
            </thead>
            <tbody>
              {waiting.map((t) => (
                <tr key={t.id}>
                  <td className="num">{t.number}</td>
                  <td>{t.patientName}</td>
                  <td>{t.phone ? <a href={`tel:${t.phone}`}>{t.phone}</a> : '—'}</td>
                  <td><span className={`pill ${t.source}`}>{t.source === 'online' ? 'Online' : 'Walk-in'}</span></td>
                  <td>{time(t.createdAt)}</td>
                  <td><button className="link" disabled={busy} onClick={() => act(() => setStatus(t.id, 'skipped'))}>Mark absent</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {closed.length > 0 && (
        <section className="card">
          <h3>Finished / missed / cancelled</h3>
          <table className="queue">
            <tbody>
              {closed.map((t) => (
                <tr key={t.id}>
                  <td className="num">{t.number}</td>
                  <td>{t.patientName}</td>
                  <td><span className={`pill ${t.status}`}>{t.status}</span></td>
                  <td>
                    {(t.status === 'skipped' || t.status === 'cancelled') && (
                      <button className="link" disabled={busy} onClick={() => act(() => setStatus(t.id, 'waiting'))}>
                        Put back in line
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function setStatus(id, status) {
  return api(`/staff/tokens/${id}/status`, { method: 'POST', body: { status } });
}

function WalkIn({ onAdd, busy }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        await onAdd({ patientName: name, phone });
        setName('');
        setPhone('');
      }}
    >
      <h3>Add walk-in patient</h3>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
      </label>
      <label>
        Mobile <span className="muted">(optional)</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={14} />
      </label>
      <button className="btn wide" disabled={busy}>Give token</button>
    </form>
  );
}

function Settings({ settings, onSave, busy }) {
  const [avg, setAvg] = useState(settings.avgMinutesPerPatient);
  const [limit, setLimit] = useState(settings.dailyLimit);
  useEffect(() => {
    setAvg(settings.avgMinutesPerPatient);
    setLimit(settings.dailyLimit);
  }, [settings.avgMinutesPerPatient, settings.dailyLimit]);
  return (
    <section className="card">
      <h3>Online booking</h3>
      <button
        className={`btn wide ${settings.bookingOpen ? 'danger' : ''}`}
        disabled={busy}
        onClick={() => onSave({ bookingOpen: !settings.bookingOpen })}
      >
        {settings.bookingOpen ? 'Stop online booking' : 'Open online booking'}
      </button>
      <p className="muted small-text">Currently {settings.bookingOpen ? 'OPEN: patients can book from home' : 'CLOSED'}.</p>
      <div className="row">
        <label>
          Min per patient
          <input type="number" min={1} max={60} value={avg} onChange={(e) => setAvg(e.target.value)} />
        </label>
        <label>
          Daily limit
          <input type="number" min={1} max={2000} value={limit} onChange={(e) => setLimit(e.target.value)} />
        </label>
      </div>
      <button className="btn ghost wide" disabled={busy} onClick={() => onSave({ avgMinutesPerPatient: Number(avg), dailyLimit: Number(limit) })}>
        Save
      </button>
    </section>
  );
}

function time(d) {
  return new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}
