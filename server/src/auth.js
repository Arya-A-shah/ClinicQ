import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set and at least 32 characters long (see .env.example)');
}

const isProd = process.env.NODE_ENV === 'production';
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Checks the ID token Google gave the browser. This is what stops people
// from faking a login: only Google can sign these tokens.
export async function verifyGoogleCredential(credential) {
  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const p = ticket.getPayload();
  if (!p.email_verified) throw new Error('Google email not verified');
  return { googleId: p.sub, email: p.email, name: p.name, picture: p.picture };
}

// Session = signed JWT inside an httpOnly cookie (JavaScript on the page can't read it,
// so an XSS bug can't steal it).
const COOKIES = { patient: 'cq_patient', staff: 'cq_staff' };

export function setSession(res, kind, payload, days) {
  const token = jwt.sign({ ...payload, kind }, JWT_SECRET, { expiresIn: `${days}d` });
  res.cookie(COOKIES[kind], token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: days * 24 * 60 * 60 * 1000,
  });
}

export function clearSession(res, kind) {
  res.clearCookie(COOKIES[kind], { httpOnly: true, secure: isProd, sameSite: 'lax' });
}

function readSession(req, kind) {
  const raw = req.cookies?.[COOKIES[kind]];
  if (!raw) return null;
  try {
    const data = jwt.verify(raw, JWT_SECRET);
    return data.kind === kind ? data : null;
  } catch {
    return null;
  }
}

export function requirePatient(req, res, next) {
  const s = readSession(req, 'patient');
  if (!s) return res.status(401).json({ error: 'Please sign in' });
  req.patient = s;
  next();
}

export function requireStaff(req, res, next) {
  const s = readSession(req, 'staff');
  if (!s) return res.status(401).json({ error: 'Staff login required' });
  req.staff = s;
  next();
}

export function optionalPatient(req) {
  return readSession(req, 'patient');
}
