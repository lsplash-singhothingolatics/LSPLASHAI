# Adding GitHub sign-in

Four files changed: `server.js`, `public/index.html`, `public/app.js`,
`public/styles.css`. Replace them on GitHub, then do the setup below.

The GitHub button stays hidden until both env vars are set, so nothing breaks
in the meantime.

## 1. Register a GitHub OAuth app (free, ~2 minutes)

1. Go to https://github.com/settings/developers → **OAuth Apps** → **New OAuth App**
2. Fill in:
   - **Application name:** Lsplash AI
   - **Homepage URL:** `https://lsplash-ai.onrender.com`
   - **Authorization callback URL:** `https://lsplash-ai.onrender.com/auth/github/callback`
     (exactly this — no trailing slash)
3. Click **Register application**
4. Copy the **Client ID** shown
5. Click **Generate a new client secret** → copy it immediately (you can't see it again)

## 2. Add both to Render

Render → LSPLASH-AI → **Environment** → add two variables:
- `GITHUB_CLIENT_ID` = the Client ID
- `GITHUB_CLIENT_SECRET` = the client secret

Save → wait for the redeploy to go Live.

## 3. Test

Visit https://lsplash-ai.onrender.com/ — a black **Continue with GitHub**
button now appears under the Google one. Click it → you go to GitHub → approve
→ land back signed in.

## Notes

- The database gets a new `github_id` column automatically on deploy — nothing
  is wiped, existing accounts stay intact.
- If someone signs in with GitHub using the same email they used for Google or
  OTP, it's treated as the **same account** (matched by email), so their gallery
  carries over.
- GitHub sometimes hides your email; the app handles that by asking GitHub's
  email API, and falls back to your GitHub noreply address if needed.
