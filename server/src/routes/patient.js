import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { User, Token, getSettings, ACTIVE_STATUSES } from '../models.js';
import {
  verifyGoogleCredential,
  setSession,
  clearSession,
  requirePatient,
  optionalPatient,
} from '../auth.js';
import { today, createToken, publicState, positionInfo, broadcast } from '../queue.js';
import { cleanName, cleanPhone } from '../validate.js';

const router = Router();

// Patients often share the clinic Wi-Fi or a mobile carrier's IP, so per-IP limits
// are kept generous. The real protection is "one Google account = max N active tokens".
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true });
const bookLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: true });

// Settings the browser needs at startup (so the client needs no build-time secrets).
router.get('/config', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    devLogin: process.env.NODE_ENV !== 'production' && process.env.DEV_LOGIN === 'true',
    clinicName: process.env.CLINIC_NAME || 'Clinic',
  });
});

// Public queue status (used by the home page and the TV display).
router.get('/queue', async (req, res) => {
  res.json(await publicState());
});

// Browser sends the Google ID token; we verify it and start a session.
router.post('/auth/google', loginLimiter, async (req, res) => {
  const { credential } = req.body || {};
  if (typeof credential !== 'string') return res.status(400).json({ error: 'Missing credential' });
  let profile;
  try {
    profile = await verifyGoogleCredential(credential);
  } catch {
    return res.status(401).json({ error: 'Google sign-in failed' });
  }
  const user = await User.findOneAndUpdate(
    { googleId: profile.googleId },
    { $set: { email: profile.email, name: profile.name, picture: profile.picture } },
    { upsert: true, new: true }
  );
  setSession(res, 'patient', { uid: user._id.toString() }, 30);
  res.json({ user: { name: user.name, email: user.email, picture: user.picture, phone: user.phone } });
});

// Local-development shortcut so you can test without setting up Google.
// Refuses to run in production.
if (process.env.NODE_ENV !== 'production' && process.env.DEV_LOGIN === 'true') {
  router.post('/auth/dev', async (req, res) => {
    const email = String(req.body?.email || 'tester@example.com').slice(0, 80);
    const user = await User.findOneAndUpdate(
      { googleId: `dev:${email}` },
      { $set: { email, name: email.split('@')[0] } },
      { upsert: true, new: true }
    );
    setSession(res, 'patient', { uid: user._id.toString() }, 1);
    res.json({ user: { name: user.name, email: user.email } });
  });
}

router.post('/auth/logout', (req, res) => {
  clearSession(res, 'patient');
  res.json({ ok: true });
});

// Who am I + my tokens for today.
router.get('/me', async (req, res) => {
  const s = optionalPatient(req);
  if (!s) return res.json({ user: null, tokens: [] });
  const user = await User.findById(s.uid).lean();
  if (!user) return res.json({ user: null, tokens: [] });
  const [tokens, state] = await Promise.all([
    Token.find({ user: user._id, date: today() }).sort({ number: 1 }).lean(),
    publicState(),
  ]);
  res.json({
    user: { name: user.name, email: user.email, picture: user.picture, phone: user.phone },
    tokens: tokens.map((t) => ({
      id: t._id,
      number: t.number,
      patientName: t.patientName,
      status: t.status,
      ...positionInfo(t, state),
    })),
  });
});

// Book a token.
router.post('/tokens', requirePatient, bookLimiter, async (req, res) => {
  const patientName = cleanName(req.body?.patientName);
  const phone = cleanPhone(req.body?.phone);
  if (!patientName) return res.status(400).json({ error: 'Please enter the patient name' });
  if (req.body?.phone && !phone) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });

  const settings = await getSettings();
  if (!settings.bookingOpen) {
    return res.status(403).json({ error: 'Online booking is closed right now' });
  }
  const date = today();
  const active = await Token.countDocuments({
    user: req.patient.uid,
    date,
    status: { $in: ACTIVE_STATUSES },
  });
  if (active >= settings.maxActivePerAccount) {
    return res.status(429).json({
      error: `You already have ${active} active token(s). One account can hold at most ${settings.maxActivePerAccount}.`,
    });
  }
  const issuedSoFar = await Token.countDocuments({ date });
  if (issuedSoFar >= settings.dailyLimit) {
    return res.status(403).json({ error: "Today's tokens are full. Please visit the clinic." });
  }

  const token = await createToken({ patientName, phone, source: 'online', user: req.patient.uid });
  if (phone) await User.updateOne({ _id: req.patient.uid }, { $set: { phone } });
  await broadcast();
  res.status(201).json({ id: token._id, number: token.number });
});

// Patient cancels their own token (only while still waiting).
router.post('/tokens/:id/cancel', requirePatient, async (req, res) => {
  const t = await Token.findOneAndUpdate(
    { _id: req.params.id, user: req.patient.uid, date: today(), status: 'waiting' },
    { status: 'cancelled', finishedAt: new Date() },
    { new: true }
  ).catch(() => null);
  if (!t) return res.status(404).json({ error: 'Token not found or already called' });
  await broadcast();
  res.json({ ok: true });
});

export default router;
