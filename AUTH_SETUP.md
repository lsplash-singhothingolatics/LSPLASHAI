# Setting up sign-in (OTP + Google)

Five files changed: `server.js`, `package.json`, and all three files in `public/`.
Replace all five on GitHub, then do the three setup steps below. The app still
runs if you skip these — generate/chat just won't require sign-in until a
database exists.

## 1. Add a database (required for any of this to work)

1. Render dashboard → **New** → **PostgreSQL**
2. Name it anything, pick the **Free** plan, create it
3. Once it's ready, copy the **Internal Database URL**
4. Go to your `lsplash-ai` web service → **Environment** → add:
   - `DATABASE_URL` = *(the internal URL you copied)*
5. Also add a random secret for signing sessions:
   - `SESSION_SECRET` = *(any long random string — mash your keyboard)*

Saving triggers a redeploy. Check the logs for `Database ready.` — that
confirms the tables were created automatically.

## 2. Email OTP — Gmail app password (free, no new signup)

1. On your Google Account → **Security** → turn on **2-Step Verification** if
   it isn't already on
2. Search for **App passwords** in Google Account settings → create one
   (name it "Lsplash AI") → copy the 16-character password
3. In Render → Environment, add:
   - `GMAIL_USER` = your Gmail address
   - `GMAIL_APP_PASSWORD` = the 16-character password (no spaces)

Without this, OTP codes just get printed in the Render logs instead of
emailed — fine for testing, not for real users.

## 3. Google Sign-In

1. Go to your Google Cloud project → **APIs & Services** → **Credentials**
2. **Create Credentials** → **OAuth client ID** → type **Web application**
3. Under **Authorized JavaScript origins**, add:
   `https://lsplash-ai.onrender.com`
4. Save, copy the **Client ID** (looks like `xxxx.apps.googleusercontent.com`)
5. In Render → Environment, add:
   - `GOOGLE_CLIENT_ID` = *(that client ID)*

No client secret needed — this flow verifies the sign-in token on the server
directly, no redirect callback required.

## What changed under the hood

- Users, one-time codes, and gallery images now live in Postgres instead of
  memory, so nothing resets when the free instance sleeps or restarts
- `/api/generate` and `/api/chat` now require a signed-in session
- Each signed-in user only sees their own gallery
- Sessions last 30 days, stored in a secure httpOnly cookie

## Testing without setting anything up yet

The app still boots and works exactly as before if you skip all three steps
— generation stays open to everyone, nothing is gated. Add `DATABASE_URL`
first; that's the switch that turns sign-in on.
