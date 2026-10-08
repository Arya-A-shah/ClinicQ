import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { Staff, Token, getSettings } from '../models.js';
import { setSession, clearSession, requireStaff } from '../auth.js';
import { today, createToken, publicState, broadcast, callNext, setStatus } from '../queue.js';
import { cleanName, cleanPhone } from '../validate.js';

const router = Router();

// Stops password guessing: 10 attempts per 15 minutes per IP.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true });

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const staff = await Staff.findOne({ username: username.toLowerCase().trim() });
  // Compare even when the user doesn't exist, so timing doesn't reveal valid usernames.
  const ok = await bcrypt.compare(password, staff?.passwordHash || '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
  if (!staff || !ok) return res.status(401).json({ error: 'Wrong username or password' });
  setSession(res, 'staff', { sid: staff._id.toString(), role: staff.role, username: staff.username }, 1);
  res.json({ username: staff.username, role: staff.role });
});

router.post('/logout', (req, res) => {
  clearSession(res, 'staff');
  res.json({ ok: true });
});

router.use(requireStaff); // everything below needs a staff login

router.get('/me', (req, res) => {
  res.json({ username: req.staff.username, role: req.staff.role });
});

// Full queue for today, with names and phone numbers (staff only).
router.get('/queue', async (req, res) => {
  const date = today();
  const [tokens, state, settings] = await Promise.all([
    Token.find({ date }).sort({ number: 1 }).lean(),
    publicState(),
    getSettings(),
  ]);
  res.json({
    state,
    settings: {
      bookingOpen: settings.bookingOpen,
      avgMinutesPerPatient: settings.avgMinutesPerPatient,
      dailyLimit: settings.dailyLimit,
      maxActivePerAccount: settings.maxActivePerAccount,
    },
    tokens: tokens.map((t) => ({
      id: t._id,
      number: t.number,
      patientName: t.patientName,
      phone: t.phone,
      source: t.source,
      status: t.status,
      createdAt: t.createdAt,
      calledAt: t.calledAt,
    })),
  });
});

router.post('/call-next', async (req, res) => {
  const t = await callNext();
  await broadcast();
  res.json({ called: t ? { number: t.number, patientName: t.patientName } : null });
});

router.post('/tokens/:id/status', async (req, res) => {
  try {
    const t = await setStatus(req.params.id, req.body?.status);
    if (!t) return res.status(404).json({ error: 'Token not found' });
    await broadcast();
    res.json({ ok: true });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    if (e.name === 'CastError') return res.status(404).json({ error: 'Token not found' });
    throw e;
  }
});

// Receptionist adds someone who walked in (no phone / no Google account needed).
router.post('/walkin', async (req, res) => {
  const patientName = cleanName(req.body?.patientName);
  const phone = cleanPhone(req.body?.phone);
  if (!patientName) return res.status(400).json({ error: 'Enter a valid name' });
  if (req.body?.phone && !phone) return res.status(400).json({ error: 'Invalid mobile number' });
  const t = await createToken({ patientName, phone, source: 'walkin' });
  await broadcast();
  res.status(201).json({ id: t._id, number: t.number });
});

router.patch('/settings', async (req, res) => {
  const b = req.body || {};
  const update = {};
  if (typeof b.bookingOpen === 'boolean') update.bookingOpen = b.bookingOpen;
  const nums = { avgMinutesPerPatient: [1, 60], dailyLimit: [1, 2000], maxActivePerAccount: [1, 5] };
  for (const [k, [min, max]] of Object.entries(nums)) {
    if (b[k] !== undefined) {
      const n = Number(b[k]);
      if (!Number.isInteger(n) || n < min || n > max) {
        return res.status(400).json({ error: `${k} must be a whole number from ${min} to ${max}` });
      }
      update[k] = n;
    }
  }
  const s = await getSettings();
  Object.assign(s, update);
  await s.save();
  await broadcast();
  res.json({ ok: true });
});

export default router;
