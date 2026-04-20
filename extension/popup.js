const statusEl = document.getElementById("status");
const tokenInput = document.getElementById("token-input");
const actionBtn = document.getElementById("action-btn");

async function init() {
  const { token } = await chrome.storage.local.get("token");
  if (token) {
    showConnected();
  } else {
    showDisconnected();
  }
}

function showConnected() {
  statusEl.className = "status connected";
  statusEl.textContent = "✅ Connected — campaigns are running automatically.";
  tokenInput.style.display = "none";
  actionBtn.textContent = "Disconnect";
  actionBtn.className = "danger";
  actionBtn.onclick = disconnect;
}

function showDisconnected() {
  statusEl.className = "status disconnected";
  statusEl.textContent = "⚠️ Not connected — paste your token below.";
  tokenInput.style.display = "";
  actionBtn.textContent = "Connect";
  actionBtn.className = "";
  actionBtn.onclick = connect;
}

async function connect() {
  const token = tokenInput.value.trim();
  if (!token.startsWith("lnkdm_")) {
    statusEl.textContent =
      "⚠️ Invalid token format. Copy it exactly from your linkdm dashboard.";
    return;
  }
  await chrome.storage.local.set({ token });
  showConnected();
}

async function disconnect() {
  await chrome.storage.local.remove(["token", "dmedProfiles", "nextSendAt"]);
  tokenInput.value = "";
  showDisconnected();
}

actionBtn.onclick = connect;
init();
