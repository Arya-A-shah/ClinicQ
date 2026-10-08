# ClinicQ: online token queue for a clinic

A real clinic runs on paper tokens, and patients wait 1–2 hours inside. ClinicQ lets them **book a token from their phone and wait wherever they like**. They watch the line move live and head to the clinic when they're about 3 patients away.

Built for a family doctor's clinic that sees ~250 patients a day (~350 on Saturdays).

## Features

**Patients** (`/`)
- Sign in with Google → enter patient name (+ optional mobile) → get a token number
- Live view: "Now serving #12 · 6 people ahead of you · about 28 min"
- Card turns amber when ≤3 people are ahead and green when it's their turn (vibration + browser notification)
- Book for a family member (max 2 active tokens per account), cancel a token

**Reception** (`/staff`, username + password)
- One big **Call next** button; "Didn't come" for no-shows; "Put back in line" for late arrivals
- Add walk-in patients who don't use the app
- Open/close online booking, set daily limit and minutes per patient
- Live list of everyone waiting, with phone numbers to call

**Waiting-room TV** (`/display`): huge "Now serving" number plus the next 5 tokens (numbers only, no names)

## How it works

```
React (Vite) ──HTTP /api──▶ Express ──▶ MongoDB (Mongoose)
     ▲                         │
     └──── Socket.IO ◀─────────┘  "queue:update" pushed on every change
```

- **Live updates:** after any change (booking, call next, cancel), the server broadcasts the public queue state over Socket.IO. Every open phone updates instantly, with no refresh and no polling.
- **Token numbers:** a per-day counter document incremented with MongoDB's atomic `$inc`, plus a unique index on `(date, number)` and a retry on duplicate-key errors. Two people booking in the same millisecond can never get the same number.
- **Daily reset:** every token stores the date in the clinic's time zone (Asia/Kolkata), so numbering restarts at #1 each day with no cron job.
- **Wait estimate:** average gap between the last ~10 "call next" presses today (ignoring outliers such as a lunch break). Until there's enough data it uses the minutes-per-patient setting.
- **Double-tap safety:** "Call next" runs inside a small in-process lock, so two quick taps call two patients in order and never leave two patients marked "with the doctor".

## Security / anti-spam

| Threat | Protection |
|---|---|
| Bots booking fake tokens | Google sign-in required (server verifies the Google ID token signature) |
| One person hoarding tokens | Max 2 active tokens per Google account (configurable) |
| API flooding | Rate limits: 120 req/min per IP overall, stricter on login and booking |
| Staff password guessing | bcrypt-hashed passwords, 10 login attempts / 15 min per IP |
| Session theft via XSS | Sessions are signed JWTs in `httpOnly`, `secure`, `sameSite=lax` cookies |
| Privacy | Public screens show token numbers only; names and phones are visible to staff only |
| Bad input | Server-side validation of names and Indian mobile numbers, 10 KB body limit, Helmet security headers + CSP |

Per-IP limits are deliberately generous because many patients share the clinic Wi-Fi or a mobile carrier's IP.

## Run locally

Needs Node 20+ and MongoDB running locally.

```bash
npm install                          # installs server + client too
cp server/.env.example server/.env   # then fill in JWT_SECRET (see the comment in the file)
npm run create-staff --prefix server -- reception <a-password> reception

# two terminals:
npm run dev:server                   # API on http://localhost:4000
npm run dev:client                   # app on http://localhost:5173
```

With `DEV_LOGIN=true` in `.env`, the patient page shows a **Dev login** button, so you can test without setting up Google. It is disabled automatically when `NODE_ENV=production`.

Tests (with the dev server running): `npm test`. These are 12 API tests covering auth, limits, concurrent bookings, call-next races and privacy.

## Deploy

```bash
npm install && npm run build   # build command
npm start                      # start command (serves API + built React app on one port)
```

Environment variables: see **[DEPLOY.md](DEPLOY.md)** for the full step-by-step guide (MongoDB Atlas, Google sign-in, Hostinger / Render).

## Roadmap

- [ ] WhatsApp/SMS alert when 3 patients away (for people who close the tab)
- [ ] AI intake summary: patient describes symptoms while waiting, and the doctor gets a short structured note (the doctor decides everything)
- [ ] Better wait-time prediction from historical data (day of week, time of day)
- [ ] Daily stats for the doctor (patients seen, average wait, no-show rate)
