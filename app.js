const $ = (sel) => document.querySelector(sel);

const form = $("#generateForm");
const promptEl = $("#prompt");
const generateBtn = $("#generateBtn");
const statusEl = $("#status");
const grid = $("#grid");
const emptyEl = $("#empty");
const searchEl = $("#search");

const drawer = $("#drawer");
const scrim = $("#scrim");
const thread = $("#thread");
const chatForm = $("#chatForm");
const chatInput = $("#chatInput");

const history = [];

function setStatus(text, tone = "") {
  statusEl.textContent = text;
  statusEl.dataset.tone = tone;
}

/* -------------------------------------------------------------- gallery --- */

function tile(item) {
  const el = document.createElement("figure");
  el.className = "tile";
  el.dataset.id = item.id;

  const img = document.createElement("img");
  img.src = item.url;
  img.alt = item.prompt;
  img.loading = "lazy";

  const caption = document.createElement("figcaption");
  caption.className = "tile__caption";
  caption.textContent = item.prompt;

  const remove = document.createElement("button");
  remove.className = "tile__remove";
  remove.type = "button";
  remove.title = "Remove from gallery";
  remove.textContent = "×";
  remove.addEventListener("click", async () => {
    await fetch(`/api/gallery/${item.id}`, { method: "DELETE" });
    el.remove();
    emptyEl.hidden = grid.children.length > 0;
  });

  el.append(img, caption, remove);
  return el;
}

async function loadGallery(query = "") {
  const res = await fetch(`/api/gallery?q=${encodeURIComponent(query)}`);
  const data = await res.json();

  grid.replaceChildren(...data.items.map(tile));
  emptyEl.hidden = data.items.length > 0;
  if (query && data.items.length === 0) {
    emptyEl.hidden = false;
    emptyEl.textContent = `No prompts match "${query}".`;
  } else if (data.items.length === 0) {
    emptyEl.textContent = "Nothing here yet. Generate something above.";
  }
}

let searchTimer;
searchEl.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadGallery(searchEl.value.trim()), 220);
});

/* ------------------------------------------------------------- generate --- */

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    promptEl.value = chip.textContent;
    promptEl.focus();
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = promptEl.value.trim();
  if (!prompt) return;

  generateBtn.disabled = true;
  generateBtn.classList.add("is-blooming");
  setStatus("Painting…");

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Generation failed.");

    searchEl.value = "";
    grid.prepend(tile(data));
    emptyEl.hidden = true;
    setStatus("Added to your gallery.");
    promptEl.value = "";
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    generateBtn.disabled = false;
    setTimeout(() => generateBtn.classList.remove("is-blooming"), 900);
  }
});

/* ----------------------------------------------------------------- chat --- */

function openDrawer(open) {
  drawer.classList.toggle("is-open", open);
  drawer.setAttribute("aria-hidden", String(!open));
  scrim.hidden = !open;
  if (open) chatInput.focus();
}

$("#openChat").addEventListener("click", () => openDrawer(true));
$("#closeChat").addEventListener("click", () => openDrawer(false));
scrim.addEventListener("click", () => openDrawer(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") openDrawer(false);
});

function bubble(text, who) {
  const el = document.createElement("div");
  el.className = `msg msg--${who}`;
  el.textContent = text;
  thread.append(el);
  thread.scrollTop = thread.scrollHeight;
  return el;
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  bubble(text, "me");
  history.push({ role: "user", content: text });
  chatInput.value = "";
  const pending = bubble("…", "bot");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Chat failed.");

    pending.textContent = data.reply;
    history.push({ role: "assistant", content: data.reply });
  } catch (err) {
    pending.textContent = err.message;
  }
});

loadGallery();
