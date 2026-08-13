import express from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CHAT_MODEL = process.env.CHAT_MODEL || "claude-sonnet-5";
const IMAGE_PROVIDER = process.env.IMAGE_PROVIDER || "pollinations";
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

/**
 * Gallery lives in memory. Render's free instances restart and wipe this —
 * swap `gallery` for a database call when you want images to survive a restart.
 */
const gallery = [];
const MAX_ITEMS = 200;

/* ---------------------------------------------------------------- chat ---- */

app.post("/api/chat", async (req, res) => {
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

app.post("/api/generate", async (req, res) => {
  const prompt = String(req.body?.prompt ?? "").trim();

  if (!prompt) return res.status(400).json({ error: "Write a prompt first." });
  if (prompt.length > 800) return res.status(400).json({ error: "Keep prompts under 800 characters." });

  try {
    const seed = Math.floor(Math.random() * 1_000_000);
    const url =
      IMAGE_PROVIDER === "replicate" && REPLICATE_API_TOKEN
        ? await generateWithReplicate(prompt)
        : pollinationsUrl(prompt, seed);

    const item = { id: randomUUID(), prompt, url, createdAt: new Date().toISOString() };
    gallery.unshift(item);
    if (gallery.length > MAX_ITEMS) gallery.length = MAX_ITEMS;

    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "The image provider failed. Try again in a moment." });
  }
});

/* -------------------------------------------------------------- gallery ---- */

app.get("/api/gallery", (req, res) => {
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const items = q ? gallery.filter((item) => item.prompt.toLowerCase().includes(q)) : gallery;
  res.json({ count: items.length, items: items.slice(0, 60) });
});

app.delete("/api/gallery/:id", (req, res) => {
  const index = gallery.findIndex((item) => item.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Not found." });
  gallery.splice(index, 1);
  res.json({ ok: true });
});

/* ---------------------------------------------------------------- misc ----- */

app.get("/healthz", (_req, res) => res.json({ ok: true, images: gallery.length }));

app.listen(PORT, () => {
  console.log(`Lsplash AI listening on port ${PORT}`);
});
