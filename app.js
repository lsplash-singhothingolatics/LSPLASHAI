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

const gate = $("#authGate");
const gateStatus = $("#gateStatus");
const otpRequestForm = $("#otpRequestForm");
const otpVerifyForm = $("#otpVerifyForm");
const otpEmail = $("#otpEmail");
const otpCode = $("#otpCode");
const accountEl = $("#account");
const accountEmailEl = $("#accountEmail");
const logoutBtn = $("#logoutBtn");
const googleLink = $("#googleSignInLink");
const githubLink = $("#githubSignInLink");

const history = [];
let currentUser = null;
let pendingOtpEmail = "";

function setStatus(text, tone = "") {
  statusEl.textContent = text;
  statusEl.dataset.tone = tone;
}

function setGateStatus(text, tone = "") {
  gateStatus.textContent = text;
  gateStatus.dataset.tone = tone;
}

/* ------------------------------------------------------------------ auth --- */

async function loadConfig() {
  const res = await fetch("/api/config");
  const data = await res.json();
  googleLink.hidden = !data.googleEnabled;
  githubLink.hidden = !data.githubEnabled;
}

const AUTH_ERROR_MESSAGES = {
  no_database: "Sign-in isn't set up yet — the database isn't connected.",
  google_failed: "Google sign-in failed. Try again.",
  github_failed: "GitHub sign-in failed. Try again.",
  bad_state: "That sign-in link expired. Try again.",
  access_denied: "Sign-in was cancelled.",
};

function showAuthErrorFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const err = params.get("auth_error");
  if (!err) return;
  gate.hidden = false;
  setGateStatus(AUTH_ERROR_MESSAGES[err] || "Sign-in failed. Try again.", "error");
  window.history.replaceState({}, "", window.location.pathname);
}

async function refreshAuth() {
  const res = await fetch("/api/auth/me");
  const data = await res.json();
  currentUser = data.user;

  if (currentUser) {
    gate.hidden = true;
    accountEl.hidden = false;
    accountEmailEl.textContent = currentUser.email;
  } else {
    gate.hidden = false;
    accountEl.hidden = true;
  }
}

otpRequestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = otpEmail.value.trim();
  if (!email) return;

  setGateStatus("Sending code…");
  try {
    const res = await fetch("/api/auth/otp/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not send the code.");

    pendingOtpEmail = email;
    otpRequestForm.hidden = true;
    otpVerifyForm.hidden = false;
    otpCode.focus();
    setGateStatus(data.devHint || "Code sent. Check your inbox.", "ok");
  } catch (err) {
    setGateStatus(err.message, "error");
  }
});

otpVerifyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = otpCode.value.trim();
  if (!code) return;

  setGateStatus("Verifying…");
  try {
    const res = await fetch("/api/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: pendingOtpEmail, code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "That code didn't work.");

    setGateStatus("");
    otpVerifyForm.hidden = true;
    otpRequestForm.hidden = false;
    otpCode.value = "";
    await refreshAuth();
    loadGallery();
  } catch (err) {
    setGateStatus(err.message, "error");
  }
});

logoutBtn.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  currentUser = null;
  grid.replaceChildren();
  await refreshAuth();
});

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
  if (res.status === 401) return; // not signed in yet
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

  if (!currentUser) {
    gate.hidden = false;
    setGateStatus("Sign in to generate images.", "error");
    return;
  }

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

    if (res.status === 401) {
      gate.hidden = false;
      setGateStatus("Sign in to generate images.", "error");
      return;
    }
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
  if (open && !currentUser) {
    gate.hidden = false;
    setGateStatus("Sign in to chat with Lsplash.", "error");
    return;
  }
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

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Minimal, safe Markdown: escapes first, then formats code/bold/lists. */
function renderMarkdown(text) {
  const codeBlocks = [];
  // Pull out fenced code blocks so their contents aren't touched by other rules.
  let out = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
    const i = codeBlocks.length;
    const cls = lang ? ` data-lang="${escapeHtml(lang)}"` : "";
    codeBlocks.push(`<pre class="code"${cls}><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
    return `\u0000CODE${i}\u0000`;
  });

  out = escapeHtml(out);
  out = out.replace(/`([^`]+)`/g, (_m, c) => `<code class="inline">${c}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/^### (.+)$/gm, "<strong>$1</strong>");
  out = out.replace(/^\s*[-*] (.+)$/gm, "\u2022 $1");
  out = out.replace(/\n/g, "<br>");

  out = out.replace(/\u0000CODE(\d+)\u0000/g, (_m, i) => codeBlocks[Number(i)]);
  return out;
}

function bubble(text, who, asMarkdown = false) {
  const el = document.createElement("div");
  el.className = `msg msg--${who}`;
  if (asMarkdown) el.innerHTML = renderMarkdown(text);
  else el.textContent = text;
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

    pending.innerHTML = renderMarkdown(data.reply);
    history.push({ role: "assistant", content: data.reply });
  } catch (err) {
    pending.textContent = err.message;
  }
});

/* ----------------------------------------------------------------- init --- */

(async function init() {
  showAuthErrorFromUrl();
  await refreshAuth();
  await loadConfig();
  loadGallery();
})();
