import express from "express";
import path from "node:path";
import { randomUUID, randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import pg from "pg";
import nodemailer from "nodemailer";
import { OAuth2Client } from "google-auth-library";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CHAT_MODEL = process.env.CHAT_MODEL || "claude-sonnet-5";
const IMAGE_PROVIDER = process.env.IMAGE_PROVIDER || "pollinations";
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me-in-production";
const DATABASE_URL = process.env.DATABASE_URL;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const COOKIE_NAME = "lsplash_session";

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

/* ================================================================= db === */
/**
 * Everything below degrades gracefully if DATABASE_URL isn't set yet, so the
 * app still runs during setup — it just won't remember users or gallery
 * items across restarts until a real Postgres database is attached.
 */
const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

async function initDb() {
  if (!pool) {
    console.warn("No DATABASE_URL set — running without persistence. See README.");
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      google_id TEXT UNIQUE,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gallery (
      id UUID PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  console.log("Database ready.");
}

// In-memory fallback gallery, used only when there's no database configured.
const memoryGallery = [];

/* =============================================================== auth === */

function signSession(user) {
  return jwt.sign({ sub: user.id, email: user.email }, SESSION_SECRET, { expiresIn: "30d" });
}

function setSessionCookie(res, user) {
  res.cookie(COOKIE_NAME, signSession(user), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function readSession(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, SESSION_SECRET);
  } catch {
    return null;
  }
}

/** Blocks the request unless signed in — but only once a database exists,
 *  so the app stays testable while you're still wiring things up. */
function requireAuth(req, res, next) {
  if (!pool) {
    req.user = null;
    return next();
  }
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: "Sign in first." });
  req.user = session;
  next();
}

async function findOrCreateUserByEmail(email) {
  const { rows } = await pool.query(
    `INSERT INTO users (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id, email`,
    [email]
  );
  return rows[0];
}

async function findOrCreateUserByGoogle(googleId, email) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, google_id) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET google_id = EXCLUDED.google_id
     RETURNING id, email`,
    [email, googleId]
  );
  return rows[0];
}

/* -------------------------------------------------------------- email --- */

const mailer =
  GMAIL_USER && GMAIL_APP_PASSWORD
    ? nodemailer.createTransport({ service: "gmail", auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } })
    : null;

async function sendOtpEmail(email, code) {
  if (!mailer) {
    // No mailer configured yet — log it so you can still test the flow locally.
    console.log(`[dev only] OTP for ${email}: ${code}`);
    return;
  }
  await mailer.sendMail({
    from: `Lsplash AI <${GMAIL_USER}>`,
    to: email,
    subject: `${code} is your Lsplash AI code`,
    text: `Your Lsplash AI verification code is ${code}. It expires in 10 minutes.`,
  });
}

/* ------------------------------------------------------------- google --- */

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

/* ---------------------------------------------------------- auth routes -- */

app.get("/api/config", (_req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID || null, dbConfigured: Boolean(pool) });
});

app.get("/api/auth/me", (req, res) => {
  const session = readSession(req);
  res.json({ user: session ? { email: session.email } : null });
});

app.post("/api/auth/otp/request", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid email." });
  }
  if (!pool) return res.status(503).json({ error: "Sign-in isn't set up yet — add DATABASE_URL." });

  const code = String(randomInt(100000, 999999));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  try {
    await pool.query(`DELETE FROM otp_codes WHERE email = $1`, [email]);
    await pool.query(`INSERT INTO otp_codes (email, code, expires_at) VALUES ($1, $2, $3)`, [
      email,
      code,
      expiresAt,
    ]);
    await sendOtpEmail(email, code);
    res.json({ ok: true, devHint: mailer ? undefined : "Mailer not configured — check server logs for the code." });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Could not send the code. Try again." });
  }
});

app.post("/api/auth/otp/verify", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const code = String(req.body?.code ?? "").trim();
  if (!pool) return res.status(503).json({ error: "Sign-in isn't set up yet — add DATABASE_URL." });

  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM otp_codes WHERE email = $1 AND code = $2 AND expires_at > now()`,
      [email, code]
    );
    if (rows.length === 0) return res.status(401).json({ error: "That code is wrong or expired." });

    await pool.query(`DELETE FROM otp_codes WHERE email = $1`, [email]);
    const user = await findOrCreateUserByEmail(email);
    setSessionCookie(res, user);
    res.json({ user: { email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sign-in failed. Try again." });
  }
});

app.post("/api/auth/google", async (req, res) => {
  const credential = req.body?.credential;
  if (!googleClient) return res.status(503).json({ error: "Google sign-in isn't configured yet." });
  if (!pool) return res.status(503).json({ error: "Sign-in isn't set up yet — add DATABASE_URL." });

  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const user = await findOrCreateUserByGoogle(payload.sub, payload.email.toLowerCase());
    setSessionCookie(res, user);
    res.json({ user: { email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: "Google sign-in failed." });
  }
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

/* ---------------------------------------------------------------- chat ---- */

app.post("/api/chat", requireAuth, async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : null;

  if (!messages || messages.length === 0) {
    return res.status(400).json({ error: "Send a `messages` array." });
  }
  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: "Chat is not configured. Add an ANTHROPIC_API_KEY environment variable.",
    });
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        max_tokens: 1024,
        system:
          "You are the assistant inside Lsplash AI, an image generation studio. " +
          "Help people sharpen their image prompts and answer questions about the app. " +
          "Keep replies short and concrete.",
        messages: messages.slice(-20).map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(m.content ?? "").slice(0, 4000),
        })),
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error("Anthropic error:", upstream.status, detail);
      return res.status(502).json({ error: "The model did not respond. Try again." });
    }

    const data = await upstream.json();
    const reply = (data.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    res.json({ reply: reply || "No text came back. Try rephrasing." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Chat request failed." });
  }
});

/* ------------------------------------------------------------- generate ---- */

function pollinationsUrl(prompt, seed) {
  const encoded = encodeURIComponent(prompt);
  return `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&seed=${seed}&nologo=true`;
}

async function generateWithReplicate(prompt) {
  const create = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${REPLICATE_API_TOKEN}`,
      "content-type": "application/json",
      prefer: "wait",
    },
    body: JSON.stringify({ input: { prompt, aspect_ratio: "1:1" } }),
  });

  if (!create.ok) throw new Error(`Replicate responded ${create.status}`);

  const prediction = await create.json();
  const output = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (!output) throw new Error("Replicate returned no image.");
  return output;
}

app.post("/api/generate", requireAuth, async (req, res) => {
  const prompt = String(req.body?.prompt ?? "").trim();

  if (!prompt) return res.status(400).json({ error: "Write a prompt first." });
  if (prompt.length > 800) return res.status(400).json({ error: "Keep prompts under 800 characters." });

  try {
    const seed = Math.floor(Math.random() * 1_000_000);
    const url =
      IMAGE_PROVIDER === "replicate" && REPLICATE_API_TOKEN
        ? await generateWithReplicate(prompt)
        : pollinationsUrl(prompt, seed);

    const id = randomUUID();
    const createdAt = new Date().toISOString();

    if (pool && req.user) {
      await pool.query(`INSERT INTO gallery (id, user_id, prompt, url) VALUES ($1, $2, $3, $4)`, [
        id,
        req.user.sub,
        prompt,
        url,
      ]);
    } else {
      memoryGallery.unshift({ id, prompt, url, createdAt });
      if (memoryGallery.length > 200) memoryGallery.length = 200;
    }

    res.json({ id, prompt, url, createdAt });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "The image provider failed. Try again in a moment." });
  }
});

/* -------------------------------------------------------------- gallery ---- */

app.get("/api/gallery", requireAuth, async (req, res) => {
  const q = String(req.query.q ?? "").trim();

  if (pool && req.user) {
    const { rows } = await pool.query(
      `SELECT id, prompt, url, created_at AS "createdAt" FROM gallery
       WHERE user_id = $1 AND ($2 = '' OR prompt ILIKE '%' || $2 || '%')
       ORDER BY created_at DESC LIMIT 60`,
      [req.user.sub, q]
    );
    return res.json({ count: rows.length, items: rows });
  }

  const items = q
    ? memoryGallery.filter((item) => item.prompt.toLowerCase().includes(q.toLowerCase()))
    : memoryGallery;
  res.json({ count: items.length, items: items.slice(0, 60) });
});

app.delete("/api/gallery/:id", requireAuth, async (req, res) => {
  if (pool && req.user) {
    const result = await pool.query(`DELETE FROM gallery WHERE id = $1 AND user_id = $2`, [
      req.params.id,
      req.user.sub,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Not found." });
    return res.json({ ok: true });
  }

  const index = memoryGallery.findIndex((item) => item.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Not found." });
  memoryGallery.splice(index, 1);
  res.json({ ok: true });
});

/* ---------------------------------------------------------------- misc ----- */

app.get("/healthz", (_req, res) => res.json({ ok: true, db: Boolean(pool) }));

initDb()
  .catch((err) => console.error("DB init failed:", err))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Lsplash AI listening on port ${PORT}`);
    });
  });
