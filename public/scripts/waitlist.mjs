import { supabase } from "/scripts/supabase-client.mjs";

const WAITLIST_TABLE = "waitlist";
const WAITLIST_SOURCE = "alpha_waitlist";
const LIMITS = {
  email: 200,
  role: 80,
  website: 200,
  note: 300,
};
const STORAGE_KEY = "geo_waitlist_email";

const form = document.getElementById("waitlist-form");
const emailInput = document.getElementById("waitlist-email");
const roleInput = document.getElementById("waitlist-role");
const websiteInput = document.getElementById("waitlist-website");
const noteInput = document.getElementById("waitlist-note");
const statusEl = document.getElementById("waitlist-status");
const submitBtn = document.getElementById("waitlist-submit");
const resetBtn = document.getElementById("waitlist-reset");

if (!form || !emailInput || !statusEl || !submitBtn) {
  console.error("[waitlist] missing required form elements.");
}

const env = window.__GEO_PUBLIC__ || {};
const webhookUrl = env.PUBLIC_WAITLIST_WEBHOOK || "";

let busy = false;

function setStatus(message, tone = "info") {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = "text-xs";
  if (tone === "success") statusEl.classList.add("text-emerald-300");
  else if (tone === "error") statusEl.classList.add("text-rose-300");
  else statusEl.classList.add("text-slate-400");
}

function setDisabled(disabled) {
  const nodes = form ? form.querySelectorAll("input, textarea, button") : [];
  nodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node === resetBtn) return;
    node.toggleAttribute("disabled", disabled);
    node.classList.toggle("opacity-70", disabled);
    node.classList.toggle("pointer-events-none", disabled);
  });
}

function lockWithEmail(email, message) {
  if (emailInput) emailInput.value = email;
  setDisabled(true);
  if (resetBtn) resetBtn.classList.remove("hidden");
  setStatus(message, "success");
  try {
    localStorage.setItem(STORAGE_KEY, email);
  } catch (e) {
    console.warn("[waitlist] localStorage unavailable:", e);
  }
}

function resetForm() {
  setDisabled(false);
  if (form) form.reset();
  if (resetBtn) resetBtn.classList.add("hidden");
  setStatus("You can submit another email.");
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn("[waitlist] localStorage unavailable:", e);
  }
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function overLimit(value, max) {
  return value && value.length > max;
}

function getUtmPayload() {
  const params = new URLSearchParams(window.location.search);
  const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
  const payload = {};
  keys.forEach((key) => {
    const val = params.get(key);
    if (val) payload[key] = val;
  });
  return payload;
}

async function notifyWebhook(payload) {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn("[waitlist] webhook notify failed:", e);
  }
}

async function submitWaitlist(event) {
  event.preventDefault();
  if (busy || !form || !emailInput) return;
  if (!supabase) {
    setStatus("Supabase is not configured.", "error");
    return;
  }

  const email = normalizeEmail(emailInput.value || "");
  const role = roleInput?.value?.trim() || "";
  const website = websiteInput?.value?.trim() || "";
  const note = noteInput?.value?.trim() || "";

  if (overLimit(email, LIMITS.email)) {
    setStatus("Email is too long.", "error");
    return;
  }
  if (overLimit(role, LIMITS.role)) {
    setStatus("Role is too long.", "error");
    return;
  }
  if (overLimit(website, LIMITS.website)) {
    setStatus("Website is too long.", "error");
    return;
  }
  if (overLimit(note, LIMITS.note)) {
    setStatus("Note is too long (max 300).", "error");
    return;
  }
  if (!email) {
    setStatus("Please enter a valid email.", "error");
    return;
  }

  busy = true;
  setStatus("Submitting...", "info");
  setDisabled(true);

  const payload = {
    email,
    role: role || null,
    website: website || null,
    note: note || null,
    source: WAITLIST_SOURCE,
    page_url: window.location.href,
    referrer: document.referrer || null,
    ...getUtmPayload(),
  };

  try {
    const { error } = await supabase.from(WAITLIST_TABLE).insert(payload, {
      returning: "minimal",
    });

    if (error) {
      const code = String(error.code || "");
      const message = String(error.message || "");
      if (code === "23505" || message.includes("duplicate key")) {
        lockWithEmail(email, "You are already on the waitlist.");
        await notifyWebhook({ ...payload, duplicate: true });
        return;
      }

      console.error("[waitlist] insert error:", error);
      setStatus("Submission failed. Please try again later.", "error");
      return;
    }

    lockWithEmail(email, "Thanks! You are on the waitlist.");
    await notifyWebhook(payload);
  } catch (e) {
    console.error("[waitlist] unexpected error:", e);
    setStatus("Network error. Please try again.", "error");
  } finally {
    busy = false;
    if (!statusEl?.textContent?.includes("waitlist")) {
      setDisabled(false);
    }
  }
}

if (form) {
  form.addEventListener("submit", submitWaitlist);
}

if (resetBtn) {
  resetBtn.addEventListener("click", () => resetForm());
}

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) lockWithEmail(saved, "You are already on the waitlist.");
} catch (e) {
  console.warn("[waitlist] localStorage unavailable:", e);
}
