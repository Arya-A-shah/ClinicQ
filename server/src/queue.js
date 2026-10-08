import { Token, Counter, getSettings } from './models.js';

const TZ = process.env.CLINIC_TZ || 'Asia/Kolkata';

// Today's date in the clinic's time zone, e.g. '2026-10-08'.
// Tokens restart from #1 every day because the date changes.
export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

// $inc is atomic in MongoDB, so concurrent bookings get different numbers.
async function nextTokenNumber(date) {
  const c = await Counter.findOneAndUpdate(
    { date },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return c.seq;
}

// Creates a token with the next number. The unique index on (date, number) is the
// final safety net: if two requests ever collide (e.g. both creating the day's first
// counter at the same instant), the loser gets E11000 and simply retries.
export async function createToken(fields) {
  const date = today();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const number = await nextTokenNumber(date);
      return await Token.create({ ...fields, date, number });
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }
  throw new Error('Could not assign a token number, please retry');
}

// Average consultation time = average gap between the last few "called" times today.
// Falls back to the staff-configured value until there is enough data.
async function averageMinutes(date, fallback) {
  const recent = await Token.find({ date, calledAt: { $ne: null } })
    .sort({ calledAt: -1 })
    .limit(11)
    .select('calledAt')
    .lean();
  if (recent.length < 4) return fallback;
  const gaps = [];
  for (let i = 0; i < recent.length - 1; i++) {
    const mins = (recent[i].calledAt - recent[i + 1].calledAt) / 60000;
    if (mins > 0.3 && mins < 45) gaps.push(mins); // ignore lunch breaks / double clicks
  }
  if (gaps.length < 3) return fallback;
  return Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10;
}

// What everyone (even logged-out visitors) can see. No names or phones here.
export async function publicState() {
  const date = today();
  const settings = await getSettings();
  const [serving, waiting, issued] = await Promise.all([
    Token.findOne({ date, status: 'called' }).sort({ calledAt: -1 }).select('number').lean(),
    Token.find({ date, status: 'waiting' }).sort({ number: 1 }).select('number').lean(),
    Counter.findOne({ date }).lean(),
  ]);
  const avg = await averageMinutes(date, settings.avgMinutesPerPatient);
  return {
    date,
    nowServing: serving ? serving.number : null,
    waitingNumbers: waiting.map((t) => t.number),
    waitingCount: waiting.length,
    avgMinutesPerPatient: avg,
    bookingOpen: settings.bookingOpen,
    tokensIssued: issued ? issued.seq : 0,
    dailyLimit: settings.dailyLimit,
  };
}

// Where a given token stands in the line.
export function positionInfo(token, state) {
  if (token.status !== 'waiting') return { ahead: 0, etaMinutes: 0 };
  const ahead = state.waitingNumbers.filter((n) => n < token.number).length;
  // +1 for the patient currently inside with the doctor
  const inside = state.nowServing ? 1 : 0;
  return { ahead, etaMinutes: Math.round((ahead + inside) * state.avgMinutesPerPatient) };
}

// --- broadcasting -------------------------------------------------------
let io = null;
export function attachIo(server) {
  io = server;
}
export async function broadcast() {
  if (!io) return;
  io.emit('queue:update', await publicState());
}

// --- staff actions ------------------------------------------------------
// A tiny lock so a double-tap on "Call next" can't call two patients at once.
// (Fine for a single server process, which is all one clinic needs.)
let busy = Promise.resolve();
function exclusive(fn) {
  const run = busy.then(fn, fn);
  busy = run.catch(() => {});
  return run;
}

export function callNext() {
  return exclusive(async () => {
    const date = today();
    const now = new Date();
    // Whoever was inside is finished.
    await Token.updateMany({ date, status: 'called' }, { status: 'done', finishedAt: now });
    const next = await Token.findOneAndUpdate(
      { date, status: 'waiting' },
      { status: 'called', calledAt: now },
      { sort: { number: 1 }, new: true }
    );
    return next;
  });
}

export function setStatus(id, status) {
  return exclusive(async () => {
    const date = today();
    const token = await Token.findOne({ _id: id, date });
    if (!token) return null;
    const allowed = {
      done: ['called'],
      skipped: ['called', 'waiting'],
      waiting: ['skipped', 'cancelled'], // re-queue
      cancelled: ['waiting'],
    };
    if (!allowed[status] || !allowed[status].includes(token.status)) {
      const err = new Error(`Cannot change ${token.status} to ${status}`);
      err.status = 400;
      throw err;
    }
    token.status = status;
    if (status === 'done' || status === 'skipped') token.finishedAt = new Date();
    if (status === 'waiting') {
      token.calledAt = undefined;
      token.finishedAt = undefined;
    }
    await token.save();
    return token;
  });
}
