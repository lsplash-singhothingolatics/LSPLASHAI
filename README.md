# Lsplash AI

Image generation, a chat assistant, and a searchable gallery — one Node app, no build step.

## What's inside

| Path | Job |
| --- | --- |
| `server.js` | Express server + three API routes |
| `public/` | The whole frontend (HTML, CSS, one JS file) |
| `render.yaml` | Render service config, so deploy is one click |
| `.env.example` | The environment variables you need |

### API

- `POST /api/generate` — `{ "prompt": "..." }` → an image, also pushed into the gallery
- `POST /api/chat` — `{ "messages": [...] }` → a reply from Claude
- `GET /api/gallery?q=` — search saved images by prompt text
- `DELETE /api/gallery/:id` — remove one

## Run it locally

```bash
npm install
cp .env.example .env    # then paste your key in
npm run dev
```

Open http://localhost:3000

Image generation works with no key at all — it uses Pollinations by default. The chat drawer needs `ANTHROPIC_API_KEY`.

## Put it on GitHub

```bash
git init
git add .
git commit -m "Lsplash AI"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/lsplash-ai.git
git push -u origin main
```

## Deploy on Render

1. Go to **render.com → New → Web Service** and connect your GitHub repo.
2. Render reads `render.yaml`, so the settings fill themselves in. If you'd rather do it by hand:
   - Runtime: **Node**
   - Build command: `npm install`
   - Start command: `npm start`
3. Under **Environment**, add `ANTHROPIC_API_KEY`. Never commit the key — `.env` is gitignored.
4. Deploy. Every push to `main` redeploys automatically.

Free instances sleep after 15 minutes of no traffic, so the first request after a nap takes ~30 seconds.

## Things to change next

- **The gallery is in memory.** It empties whenever the instance restarts. Add Render Postgres and swap the `gallery` array in `server.js` for real queries.
- **Better images.** Set `IMAGE_PROVIDER=replicate` and add `REPLICATE_API_TOKEN` to run FLUX instead of Pollinations.
- **Accounts.** Right now every visitor shares one gallery.
- **Rate limiting.** A public generate endpoint with your key behind it will get abused. Add `express-rate-limit` before you share the URL widely.
