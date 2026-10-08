# Deploying ClinicQ (step by step)

**What "deploying" means here:** your laptop stops being the server. Three online services replace it:

| Piece | On your laptop today | Online | Cost |
|---|---|---|---|
| The app (Express + React) | `npm run dev` | **Render** web service | Free to try, $7/month to keep it always on |
| The database | local MongoDB | **MongoDB Atlas** | Free |
| Google sign-in | dev login button | **Google Cloud** client ID | Free |

Do the steps in order. Every value you copy goes into Step 5.

---

## Step 1: Push the code to GitHub

```bash
cd ~/Development/projects/ClinicQ
git push -u origin main
```

Check that https://github.com/Arya-A-shah/ClinicQ shows your files.

## Step 2: Create the database (MongoDB Atlas)

1. Go to **cloud.mongodb.com** → sign up with Google.
2. **Create cluster** → choose **Free (M0)** → provider AWS → region **Mumbai (ap-south-1)** → Create.
3. It asks you to create a database user. Username `clinicq`, click **Autogenerate password**, and **copy the password somewhere safe**.
4. Left menu **Network Access** → *Add IP address* → **Allow access from anywhere** (`0.0.0.0/0`) → Confirm. Render doesn't have a fixed IP address, so this is needed.
5. Left menu **Database → Connect → Drivers** → copy the string. It looks like:
   `mongodb+srv://clinicq:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
6. Replace `<password>` with your password, and add `clinicq` after `.net/`:
   `mongodb+srv://clinicq:YOURPASS@cluster0.xxxxx.mongodb.net/clinicq?retryWrites=true&w=majority`
   → This is your **MONGODB_URI**.

## Step 3: Put the app online (Render)

1. Go to **render.com** → sign up **with GitHub**.
2. **New + → Web Service** → pick the **ClinicQ** repo.
3. Fill in:
   - **Name:** `clinicq` (your URL becomes `https://clinicq-xxxx.onrender.com`)
   - **Region:** Singapore (closest to India)
   - **Branch:** `main`
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm start`
   - **Instance type:** Free for now
4. Don't click Deploy yet. Scroll to **Environment Variables** (Step 5). Copy the URL Render shows you; you need it for Step 4.

## Step 4: Get the Google sign-in ID

1. Go to **console.cloud.google.com** → top bar → **New project** → name it `ClinicQ`.
2. Search for **"OAuth consent screen"** → External → app name `ClinicQ`, your email → Save. Then **Publish app**.
3. Search for **"Credentials"** → **Create credentials → OAuth client ID** → type **Web application**.
4. Under **Authorized JavaScript origins**, add both:
   - your Render URL, e.g. `https://clinicq-xxxx.onrender.com`
   - `http://localhost:5173` (so it works on your laptop too)
5. Create → copy the **Client ID** (ends in `.apps.googleusercontent.com`). You don't need the client secret.

## Step 5: Add environment variables on Render, then deploy

On Render, add these under *Environment*:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | from Step 2 |
| `GOOGLE_CLIENT_ID` | from Step 4 |
| `JWT_SECRET` | run `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` on your laptop and paste the output |
| `CLINIC_NAME` | the doctor's clinic name |

Click **Deploy**. The first build takes a few minutes. When the log says `ClinicQ running…`, open your URL.

## Step 6: Create the reception login (one time)

On your laptop, run this with the Atlas string from Step 2. It writes the login into the online database:

```bash
cd ~/Development/projects/ClinicQ
MONGODB_URI="paste-your-atlas-string" npm run create-staff --prefix server -- reception 'StrongPassword123' reception
```

Now open `https://your-url/staff` and log in.

## Step 7: Test it like a real day

1. On `/staff`, tap **Open online booking**.
2. On your phone, open the URL → sign in with Google → book a token.
3. On `/staff`, add a walk-in and press **Call next**. Your phone should update by itself.
4. Open `/display` on another screen.

## Step 8: Before the clinic actually uses it

- **Upgrade Render to Starter ($7/month).** The free instance sleeps after 15 minutes without visitors and takes about a minute to wake up. Starter never sleeps.
- *Optional:* buy a domain (e.g. from Hostinger) → Render → *Settings → Custom Domain* → follow its DNS instructions → add the new domain to Google's *Authorized JavaScript origins* too.
- Print a **QR code** of the URL for the clinic entrance and reception desk.
- Run it alongside the paper tokens for a week before switching fully.

---

## After this: updating the live site

Change the code on your laptop → test with `npm run dev:server` + `npm run dev:client` → `git commit` → `git push`. Render redeploys automatically within a few minutes.

## Rules

- Never commit `.env` or paste keys into code.
- Never set `DEV_LOGIN` on Render.
- Don't store medical details in this app: names and phone numbers only.
- If the staff password leaks, re-run Step 6 with a new password.

## If something goes wrong

| Problem | Fix |
|---|---|
| Build fails on Render | Read the *Logs* tab; the first red line is the real error |
| "Could not connect to MongoDB" | Wrong password in `MONGODB_URI`, or Step 2.4 (Network Access) missing |
| Google button missing or "origin not allowed" | Render URL not added in Step 4.4 exactly (https, no trailing slash) |
| Page shows "Sign-in is not configured" | `GOOGLE_CLIENT_ID` env var missing → add it → *Manual Deploy* |
