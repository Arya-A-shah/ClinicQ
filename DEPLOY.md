# Deploying ClinicQ

Three pieces: **the app** (one Node server that serves both the API and the React pages), **the database** (MongoDB Atlas), and **Google sign-in** (a free client ID). Expect about 1–2 hours the first time.

## 1. Database: MongoDB Atlas (free)

The MongoDB on your laptop can't be used in production, because the server can't reach your laptop. Use Atlas:

1. Sign up at mongodb.com/atlas → create a **free (M0)** cluster → pick the **Mumbai (ap-south-1)** region.
2. *Database Access* → add a user with a long random password.
3. *Network Access* → allow `0.0.0.0/0`. Shared hosts don't give you a fixed IP; the password is the protection.
4. *Connect → Drivers* → copy the `mongodb+srv://…` string and add the database name: `…mongodb.net/clinicq?retryWrites=true&w=majority`.

The free tier gives 0.5 GB of storage and 100 operations/second. At ~350 tokens a day you'd use roughly 50 MB a year, so it's plenty for one clinic.

## 2. Google sign-in

1. console.cloud.google.com → new project "ClinicQ".
2. *APIs & Services → OAuth consent screen* → External, app name, your email → publish it.
3. *Credentials → Create credentials → OAuth client ID → Web application*.
4. **Authorized JavaScript origins:** your real URL (e.g. `https://clinicq.yourdomain.com`) and `http://localhost:5173` for testing.
5. Copy the **Client ID**. It ends in `.apps.googleusercontent.com`. No client secret is needed.

## 3. Hosting the app

### Option A: Hostinger (you mentioned it)

Node.js apps run only on the **Business web hosting** plan or the **Cloud** plans. The cheaper Single/Premium plans can't run them.

1. Push this repo to GitHub.
2. hPanel → *Websites → Add website → Web App → Import Git repository* → choose `ClinicQ`.
3. Framework: **Express** (or *Other*). Build command `npm run build`, entry file `server.js`, Node 20+.
4. Add the environment variables from step 4 below, then deploy.
5. Connect a domain or subdomain; Hostinger provides HTTPS.

Hostinger's docs don't say whether WebSockets are supported on these plans. That's OK: Socket.IO automatically falls back to HTTP long-polling, so live updates still work, just slightly less efficiently. Hostinger also overwrites files on each deploy, so never edit files on the server. Change the code, then push.

### Option B: Render (simplest Git-based host)

New → Web Service → connect the repo → Build `npm install && npm run build` → Start `npm start` → add env vars.
- **Don't use the free instance for the clinic:** it sleeps after 15 minutes idle and takes about a minute to wake, so the first patient of the morning would see a frozen page.
- The **Starter** instance (~$7/month) stays awake and supports WebSockets.

### Option C: a small VPS (later, if you want to learn DevOps)

Ubuntu + Node + PM2 + Nginx + a free Let's Encrypt certificate. It's cheapest at scale and teaches you a lot, but it's more work. Don't make it your first deploy.

## 4. Environment variables (production)

| Name | Value |
|---|---|
| `NODE_ENV` | `production` (also turns off the dev login and enables secure cookies) |
| `MONGODB_URI` | Atlas string from step 1 |
| `JWT_SECRET` | output of `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `GOOGLE_CLIENT_ID` | from step 2 |
| `CLINIC_NAME` | the doctor's clinic name |

**Do not** set `DEV_LOGIN` in production.

## 5. Create the reception login

Run this once from your laptop, with `MONGODB_URI` in `server/.env` pointing at Atlas:

```bash
npm run create-staff --prefix server -- reception 'a-strong-password' reception
npm run create-staff --prefix server -- doctor 'another-strong-password' doctor
```

Then switch your `.env` back to your local MongoDB.

## 6. At the clinic

- Print a **QR code** of the site URL and stick it at the entrance and the reception desk.
- Open `/staff` on the receptionist's phone or laptop, then tap **Open online booking** each morning.
- Optional: open `/display` on a spare tablet or TV in the waiting room.
- Run a **one-week trial** alongside the paper tokens before switching fully.

## Do / don't

- ✅ Keep `.env` out of GitHub (already in `.gitignore`).
- ✅ Test every change locally before pushing. A push to GitHub redeploys the live site.
- ✅ Track real numbers from week one: tokens per day, average wait, % booked online. They go on your resume.
- ❌ Don't put patients' medical details in this app. It only stores a name and an optional phone number, and it should stay that way unless you study data-protection rules (India's DPDP Act) first.
- ❌ Don't share the staff password over WhatsApp groups. Change it if it leaks: re-run `create-staff` with a new password.
