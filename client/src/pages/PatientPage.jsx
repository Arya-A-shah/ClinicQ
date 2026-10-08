import { useCallback, useEffect, useRef, useState } from 'react';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { api } from '../lib/api.js';
import { useQueue } from '../lib/useQueue.js';
import StatusBoard from '../components/StatusBoard.jsx';

const NEAR = 3; // alert when this many (or fewer) people are ahead

export default function PatientPage() {
  const [config, setConfig] = useState(null);
  const [me, setMe] = useState({ user: null, tokens: [] });
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(() => api('/me').then(setMe).catch(() => {}), []);
  const { state, connected } = useQueue(loadMe);

  useEffect(() => {
    api('/config').then(setConfig).catch(() => setConfig({}));
    loadMe().finally(() => setLoading(false));
  }, [loadMe]);

  const content = (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>+</span>
          <span>{config?.clinicName || 'Clinic'} · Tokens</span>
        </div>
        {me.user && (
          <button className="link" onClick={() => api('/auth/logout', { method: 'POST' }).then(loadMe)}>
            Sign out
          </button>
        )}
      </header>

      <StatusBoard state={state} connected={connected} />

      {loading || !config ? (
        <div className="card muted">Loading…</div>
      ) : me.user ? (
        <SignedIn me={me} state={state} reload={loadMe} />
      ) : (
        <SignedOut config={config} state={state} onLogin={loadMe} />
      )}

      <footer className="foot">
        Please reach the clinic when you are about {NEAR} patients away. If you miss your turn, tell the
        reception and they will put you back in line.
      </footer>
    </div>
  );

  // Google's provider is only needed when a client ID is configured.
  return config?.googleClientId ? (
    <GoogleOAuthProvider clientId={config.googleClientId}>{content}</GoogleOAuthProvider>
  ) : (
    content
  );
}

function SignedOut({ config, state, onLogin }) {
  const [error, setError] = useState('');
  const login = async (path, body) => {
    setError('');
    try {
      await api(path, { method: 'POST', body });
      await onLogin();
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <section className="card">
      <h2>Get your token from your phone</h2>
      <p className="muted">
        Sign in with Google, book a token, and wait wherever you like. This page shows how many people are
        ahead of you, live.
      </p>
      {state && !state.bookingOpen && <p className="notice">Online booking is closed right now.</p>}
      <div className="login-row">
        {config.googleClientId && (
          <GoogleLogin
            onSuccess={(r) => login('/auth/google', { credential: r.credential })}
            onError={() => setError('Google sign-in failed. Please try again.')}
            text="continue_with"
            shape="pill"
          />
        )}
        {config.devLogin && (
          <button className="btn ghost" onClick={() => login('/auth/dev', { email: 'tester@example.com' })}>
            Dev login (local only)
          </button>
        )}
        {!config.googleClientId && !config.devLogin && (
          <p className="error">Sign-in is not configured yet (GOOGLE_CLIENT_ID missing on the server).</p>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function SignedIn({ me, state, reload }) {
  const active = me.tokens.filter((t) => t.status === 'waiting' || t.status === 'called');
  const past = me.tokens.filter((t) => !(t.status === 'waiting' || t.status === 'called'));
  useNearAlert(active);

  return (
    <>
      {active.map((t) => (
        <MyToken key={t.id} token={t} reload={reload} />
      ))}
      <BookForm me={me} state={state} activeCount={active.length} reload={reload} />
      {past.length > 0 && (
        <section className="card">
          <h3>Earlier today</h3>
          <ul className="plain">
            {past.map((t) => (
              <li key={t.id}>
                #{t.number} · {t.patientName} · <span className={`pill ${t.status}`}>{label(t.status)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function MyToken({ token, reload }) {
  const [busy, setBusy] = useState(false);
  const called = token.status === 'called';
  const near = !called && token.ahead <= NEAR;
  const cancel = async () => {
    if (!window.confirm?.(`Cancel token #${token.number}?`)) return;
    setBusy(true);
    await api(`/tokens/${token.id}/cancel`, { method: 'POST' }).catch(() => {});
    await reload();
    setBusy(false);
  };
  return (
    <section className={`card my-token ${called ? 'is-called' : near ? 'is-near' : ''}`}>
      <div className="my-token-head">
        <span className="eyebrow">Your token · {token.patientName}</span>
      </div>
      <div className="my-number">#{token.number}</div>
      {called ? (
        <p className="big-msg">It's your turn. Please go in.</p>
      ) : (
        <>
          <p className="big-msg">
            {token.ahead === 0 ? 'You are next' : `${token.ahead} ${token.ahead === 1 ? 'person' : 'people'} ahead of you`}
          </p>
          <p className="muted">
            About {token.etaMinutes} min{near ? '. Please head to the clinic now.' : ''}
          </p>
          <button className="btn ghost small" onClick={cancel} disabled={busy}>
            Cancel token
          </button>
        </>
      )}
    </section>
  );
}

function BookForm({ me, state, activeCount, reload }) {
  const [name, setName] = useState(activeCount === 0 ? me.user.name || '' : '');
  const [phone, setPhone] = useState(me.user.phone || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(activeCount === 0);

  if (!state) return null;
  if (!state.bookingOpen) {
    return activeCount === 0 ? <div className="card notice">Online booking is closed right now.</div> : null;
  }
  if (!open) {
    return (
      <button className="btn ghost wide" onClick={() => setOpen(true)}>
        + Book for another family member
      </button>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/tokens', { method: 'POST', body: { patientName: name, phone } });
      askNotificationPermission();
      setName('');
      setOpen(false);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h2>{activeCount === 0 ? 'Book a token' : 'Book another token'}</h2>
      <p className="muted">
        {state.waitingCount} waiting now · about {Math.round(state.waitingCount * state.avgMinutesPerPatient)} min
      </p>
      <label>
        Patient name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoComplete="name" />
      </label>
      <label>
        Mobile number <span className="muted">(optional)</span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          maxLength={14}
          placeholder="98XXXXXXXX"
          autoComplete="tel"
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn wide" disabled={busy}>
        {busy ? 'Booking…' : 'Get token'}
      </button>
    </form>
  );
}

// Vibrate + system notification once when the patient gets close.
function useNearAlert(active) {
  const alerted = useRef(new Set());
  useEffect(() => {
    for (const t of active) {
      const key = `${t.id}:${t.status === 'called' ? 'called' : 'near'}`;
      const isNear = t.status === 'called' || t.ahead <= NEAR;
      if (!isNear || alerted.current.has(key)) continue;
      alerted.current.add(key);
      const msg = t.status === 'called' ? `Token #${t.number}: it's your turn!` : `Token #${t.number}: ${t.ahead} ahead. Please come to the clinic.`;
      navigator.vibrate?.([300, 150, 300]);
      try {
        if ('Notification' in window && Notification.permission === 'granted') new Notification(msg);
      } catch {
        /* some mobile browsers only allow notifications from a service worker */
      }
    }
  }, [active]);
}

function askNotificationPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  } catch {
    /* ignore */
  }
}

function label(s) {
  return { done: 'Seen', skipped: 'Missed', cancelled: 'Cancelled', waiting: 'Waiting', called: 'Now' }[s] || s;
}
