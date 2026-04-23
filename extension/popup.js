const tokenCard  = document.getElementById("token-card");
const tokenInput = document.getElementById("token-input");
const actionBtn  = document.getElementById("action-btn");
const liCard     = document.getElementById("linkedin-card");
const liTitle    = document.getElementById("li-title");
const liDetail   = document.getElementById("li-detail");
const openLiBtn  = document.getElementById("open-li-btn");

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
    await chrome.storage.local.remove(["token", "dmedProfiles", "nextSendAt"]);
  } catch {
    // ignore storage errors
  }
  tokenInput.value = "";
  showDisconnected();
}

// ── Init ──────────────────────────────────────────────────────────────────────

openLiBtn.onclick = () => {
  chrome.tabs.create({ url: "https://www.linkedin.com/feed/" });
};

async function init() {
  const { token } = await chrome.storage.local.get("token");
  if (token) {
    await showConnected();
  } else {
    showDisconnected();
  }
}

init();
