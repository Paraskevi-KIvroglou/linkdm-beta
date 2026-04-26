const tokenCard  = document.getElementById("token-card");
const tokenInput = document.getElementById("token-input");
const actionBtn  = document.getElementById("action-btn");
const liCard     = document.getElementById("linkedin-card");
const liTitle    = document.getElementById("li-title");
const liDetail   = document.getElementById("li-detail");
const openLiBtn  = document.getElementById("open-li-btn");
const sessionCard  = document.getElementById("session-card");
const sessionTitle = document.getElementById("session-title");
const sessionDetail = document.getElementById("session-detail");
const syncBtn      = document.getElementById("sync-session-btn");

// ── Helpers ───────────────────────────────────────────────────────────────────

function setCard(el, type, title, detail) {
  el.className = `card ${type}`;
  el.querySelector(".label").textContent = title;
  if (el.querySelector("span")) {
    el.querySelector("span").textContent = detail || "";
  }
}

// Ping the content script in any open LinkedIn tab.
// Returns "ok" | "no_tab" | "no_script"
async function pingLinkedIn() {
  const tabs = await chrome.tabs.query({ url: "https://www.linkedin.com/*" });
  if (!tabs.length) return "no_tab";
  try {
    const res = await chrome.tabs.sendMessage(tabs[0].id, { type: "PING" });
    return res?.ok ? "ok" : "no_script";
  } catch {
    return "no_script";
  }
}

// ── UI states ────────────────────────────────────────────────────────────────

async function showConnected() {
  setCard(tokenCard, "ok",
    "✅ Connected",
    "Your token is saved and campaigns are running."
  );
  tokenInput.style.display = "none";
  tokenInput.value = "";
  actionBtn.textContent = "Disconnect";
  actionBtn.className = "danger";
  actionBtn.onclick = disconnect;

  liCard.style.display = "";
  openLiBtn.style.display = "";

  // Check LinkedIn availability
  setCard(liCard, "warn", "Checking LinkedIn…", "");
  const ping = await pingLinkedIn();
  if (ping === "ok") {
    setCard(liCard, "ok",
      "✅ LinkedIn is open",
      "The extension is active and will send messages automatically."
    );
    openLiBtn.style.display = "none";
  } else if (ping === "no_tab") {
    setCard(liCard, "warn",
      "⚠️ LinkedIn isn't open",
      "Open LinkedIn in a tab and keep it open while campaigns run."
    );
    openLiBtn.style.display = "";
  } else {
    // no_script: tab is open but content script isn't reachable
    setCard(liCard, "warn",
      "⚠️ Refresh your LinkedIn tab",
      "Click the button below, or manually refresh the LinkedIn tab."
    );
    openLiBtn.style.display = "";
    openLiBtn.textContent = "Open LinkedIn (refresh)";
  }

  await refreshSessionStatus();
}

function showDisconnected() {
  setCard(tokenCard, "warn",
    "⚠️ Not connected",
    "Paste your token below to start."
  );
  tokenInput.style.display = "";
  actionBtn.textContent = "Connect";
  actionBtn.className = "";
  actionBtn.onclick = connect;
  liCard.style.display = "none";
  openLiBtn.style.display = "none";
  if (sessionCard) sessionCard.style.display = "none";
  if (syncBtn) syncBtn.style.display = "none";
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function connect() {
  const token = tokenInput.value.trim();
  if (!token.startsWith("lnkdm_") || token.length < 30) {
    setCard(tokenCard, "error",
      "⚠️ Invalid token",
      "Copy the token exactly from your linkdm dashboard."
    );
    return;
  }
  try {
    await chrome.storage.local.set({ token });
    await showConnected();
  } catch {
    setCard(tokenCard, "error",
      "⚠️ Could not save token",
      "Please try again."
    );
  }
}

async function disconnect() {
  try {
    await chrome.storage.local.remove(["token", "dmedProfiles", "nextSendAt", "failedProfiles", "sessionStatus", "sessionSyncedAt"]);
  } catch {
    // ignore storage errors
  }
  tokenInput.value = "";
  showDisconnected();
}

// ── Failed DMs ────────────────────────────────────────────────────────────────

function friendlyError(raw) {
  if (!raw) return "Unknown reason";
  if (raw.includes("SESSION_EXPIRED") || raw.includes("NO_CSRF") || raw.includes("401")) return "LinkedIn session expired — refresh LinkedIn";
  if (raw.includes("CONNECT_REQUEST_FAILED")) return "Couldn't send message or connection request";
  if (raw.includes("RECIPIENT_RESTRICTED") || raw.includes("403")) return "Connections only — couldn't message or connect";
  if (raw.includes("400")) return "Message blocked by LinkedIn";
  if (raw.includes("PROFILE_LOOKUP")) return "Couldn't find this person's profile";
  if (raw.includes("ME_NO_URN") || raw.includes("COULD_NOT_GET")) return "Couldn't identify your account";
  return "Message couldn't be delivered";
}

async function renderFailedList() {
  const failedSection = document.getElementById("failed-section");
  const failedList    = document.getElementById("failed-list");
  const { failedProfiles = {} } = await chrome.storage.local.get("failedProfiles");

  // Flatten all campaigns' failures into one list
  const all = Object.values(failedProfiles).flat();
  if (!all.length) {
    failedSection.style.display = "none";
    return;
  }

  failedSection.style.display = "";
  failedList.innerHTML = all.map(f => {
    const reason = friendlyError(f.error);
    const connTag = f.connectionStatus === "CONNECTED"
      ? `<span style="color:#059669; margin-left:4px">· connected</span>`
      : f.connectionStatus === "NOT_CONNECTED"
        ? `<span style="color:#9ca3af; margin-left:4px">· not connected</span>`
        : "";
    return `
      <div style="font-size:12px; padding:4px 0; border-bottom:1px solid #f3f4f6; color:#374151">
        <span style="font-weight:500">${f.profileName}</span>${connTag}
        <div style="color:#9ca3af; font-size:11px">${reason}</div>
      </div>`;
  }).join("");
}

// ── Session sync ──────────────────────────────────────────────────────────────

// These must match the values in background.js and Convex env vars.
const SYNC_CONVEX_SITE_URL = "https://utmost-lemur-208.eu-west-1.convex.site";
const SYNC_HMAC_SECRET = "4efe5984dd50cc5242cb75b68dbc4a06f93fe4764a1e8adf377c0a32332d5cf9";

/**
 * Reads LinkedIn cookies and POSTs them to Convex directly from the popup page.
 * Avoids going through the background service worker (which can be killed mid-flight).
 */
async function syncLinkedInSessionFromPopup(extensionToken) {
  try {
    const [liAtCookie, jsessionCookie] = await Promise.all([
      chrome.cookies.get({ url: "https://www.linkedin.com", name: "li_at" }),
      chrome.cookies.get({ url: "https://www.linkedin.com", name: "JSESSIONID" }),
    ]);

    if (!liAtCookie) return { success: false, error: "li_at cookie not found — please log in to LinkedIn first" };
    if (!jsessionCookie) return { success: false, error: "JSESSIONID cookie not found — please log in to LinkedIn first" };

    const liAt = liAtCookie.value;
    const jsessionId = jsessionCookie.value;

    // Build HMAC-SHA256 signature
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(SYNC_HMAC_SECRET),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(`timestamp=${timestamp}`));
    const signature = Array.from(new Uint8Array(sigBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let res;
    try {
      res = await fetch(`${SYNC_CONVEX_SITE_URL}/api/extension/sync-session`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Authorization": `Bearer ${extensionToken}`,
          "X-Timestamp": timestamp,
          "X-Signature": signature,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ liAt, jsessionId, userAgent: navigator.userAgent }),
      });
    } catch (fetchErr) {
      clearTimeout(timer);
      if (fetchErr.name === "AbortError") {
        return { success: false, error: "Connection timed out — please check your internet and try again." };
      }
      throw fetchErr;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { success: false, error: `Server error ${res.status}: ${text.slice(0, 200)}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message ?? "Unknown error" };
  }
}

function setSessionCard(type, title, detail) {
  sessionCard.className = `card ${type}`;
  sessionTitle.textContent = title;
  sessionDetail.textContent = detail;
}

async function refreshSessionStatus() {
  if (!sessionCard || !syncBtn) return;
  sessionCard.style.display = "";
  syncBtn.style.display = "";
  setSessionCard("warn", "Checking session…", "");

  const { sessionStatus, sessionSyncedAt } = await chrome.storage.local.get(["sessionStatus", "sessionSyncedAt"]);
  if (sessionStatus === "active") {
    const mins = sessionSyncedAt ? Math.floor((Date.now() - sessionSyncedAt) / 60000) : null;
    const ago = mins !== null ? (mins < 2 ? "just now" : `${mins}m ago`) : "unknown";
    setSessionCard("ok", "✅ LinkedIn session synced", `Last synced: ${ago}. Cloud campaigns are active.`);
  } else if (sessionStatus === "expired") {
    setSessionCard("error", "❌ LinkedIn session expired", "Your session expired. Sync again to resume cloud campaigns.");
  } else {
    setSessionCard("warn", "⚠️ LinkedIn session not synced", "Click Sync to enable cloud campaigns.");
  }
}

if (syncBtn) {
  syncBtn.onclick = async () => {
    syncBtn.disabled = true;
    syncBtn.textContent = "Syncing…";
    setSessionCard("warn", "Syncing LinkedIn session…", "");

    const { token } = await chrome.storage.local.get("token");
    if (!token) {
      setSessionCard("error", "❌ Sync failed", "Extension not connected — paste your token first");
      syncBtn.disabled = false;
      syncBtn.textContent = "🔄 Sync LinkedIn session";
      return;
    }

    // Run sync directly in popup (avoids service worker lifecycle issues)
    const result = await syncLinkedInSessionFromPopup(token);
    if (result.success) {
      await chrome.storage.local.set({ sessionStatus: "active", sessionSyncedAt: Date.now() });
      setSessionCard("ok", "✅ Session synced!", "Cloud campaigns are now active.");
    } else {
      setSessionCard("error", "❌ Sync failed", result.error ?? "Unknown error");
    }
    syncBtn.disabled = false;
    syncBtn.textContent = "🔄 Sync LinkedIn session";
  };
}

// ── Init ──────────────────────────────────────────────────────────────────────

openLiBtn.onclick = () => {
  chrome.tabs.create({ url: "https://www.linkedin.com/feed/" });
};

document.getElementById("clear-failed-btn").onclick = async () => {
  await chrome.storage.local.remove("failedProfiles");
  renderFailedList();
};

async function init() {
  const { token } = await chrome.storage.local.get("token");
  if (token) {
    await showConnected();
    await renderFailedList();
  } else {
    showDisconnected();
  }
}

init();
