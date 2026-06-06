const appState = document.getElementById("appState");
const bridgeToggle = document.getElementById("bridgeToggle");
const presenceToggle = document.getElementById("presenceToggle");
const accountToggle = document.getElementById("accountToggle");
const appVersion = document.getElementById("appVersion");
const discordClients = document.getElementById("discordClients");
const refreshClients = document.getElementById("refreshClients");
const updateStatus = document.getElementById("updateStatus");
const updateStatusText = document.getElementById("updateStatusText");

let rendering = false;
let clientActionBusy = false;
let pendingClientId = null;

function setClientActionBusy(busy, clientId = null) {
  clientActionBusy = Boolean(busy);
  pendingClientId = clientActionBusy ? clientId : null;

  if (refreshClients) {
    refreshClients.classList.toggle("is-loading", clientActionBusy && !pendingClientId);
  }
}

function renderDiscordClients(status) {
  if (!discordClients) return;

  const clients = Array.isArray(status.discordClients) ? status.discordClients : [];

  discordClients.innerHTML = "";

  if (!clients.length) {
    const empty = document.createElement("div");
    empty.className = "discord-empty";
    empty.textContent = "No Discord clients detected.";
    discordClients.appendChild(empty);
    return;
  }

  for (const client of clients) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "discord-client-card";
    const isPending = pendingClientId === client.id;
    const isOn = Boolean(client.selected);

    card.classList.toggle("active", isOn);
    card.classList.toggle("running", Boolean(client.running));
    card.classList.toggle("connecting", Boolean(client.connecting || isPending));
    card.classList.toggle("connected", isOn);

    const connectionText = isPending
      ? "Updating"
      : client.presenceActive
        ? "Connected with Presence"
        : client.connected
          ? "Connected"
          : client.connecting
            ? "Connecting"
            : isOn && client.running
              ? "Waiting for Discord"
              : "Not connected";

    const runningText = client.running ? "Running" : "Not running";
    const powerText = isOn ? "On" : "Off";

    card.innerHTML = `
      <span class="client-icon">${client.shortName || "DC"}</span>
      <span class="client-copy">
        <strong>${client.name}</strong>
        <small>${powerText} - ${runningText} - ${connectionText}</small>
        <span class="client-loading-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      </span>
    `;

    card.addEventListener("click", async () => {
      if (rendering || clientActionBusy) return;

      setClientActionBusy(true, client.id);
      renderStatus(status);

      let nextStatus = null;

      try {
        nextStatus = await window.zefoxBridge.selectDiscordClient(client.id);
      } finally {
        setClientActionBusy(false);
        if (nextStatus) {
          renderStatus(nextStatus);
        }
      }
    });

    discordClients.appendChild(card);
  }
}

function renderUpdateStatus(status = {}) {
  if (!updateStatus || !updateStatusText) return;

  const text = String(status.text || "").trim();
  updateStatus.hidden = !text;
  updateStatus.classList.toggle("busy", Boolean(status.busy));
  updateStatusText.textContent = text;
}

function renderStatus(status) {
  rendering = true;

  const bridgeRunning = Boolean(status.bridgeRunning);
  const presenceEnabled = Boolean(status.presenceEnabled);

  appState.textContent = bridgeRunning ? "Enabled" : "Disabled";
  appState.classList.toggle("disabled", !bridgeRunning);

  bridgeToggle.checked = bridgeRunning;
  presenceToggle.checked = presenceEnabled;
  presenceToggle.disabled = !bridgeRunning;
  accountToggle.checked = Boolean(status.accountDisplayEnabled);
  accountToggle.disabled = !bridgeRunning;

  renderDiscordClients(status);

  rendering = false;
}

async function refreshStatus() {
  const status = await window.zefoxBridge.getStatus();
  renderStatus(status);
}

async function renderAppVersion() {
  const version = await window.zefoxBridge.getVersion();
  appVersion.textContent = version ? `Version ${version}` : "";
}

bridgeToggle.addEventListener("change", async () => {
  if (rendering || clientActionBusy) return;

  const status = bridgeToggle.checked
    ? await window.zefoxBridge.start()
    : await window.zefoxBridge.stop();

  renderStatus(status);
});

presenceToggle.addEventListener("change", async () => {
  if (rendering || clientActionBusy) return;

  const status = await window.zefoxBridge.setPresenceEnabled(presenceToggle.checked);
  renderStatus(status);
});

accountToggle.addEventListener("change", async () => {
  if (rendering || clientActionBusy) return;

  const status = await window.zefoxBridge.setAccountDisplayEnabled(accountToggle.checked);
  renderStatus(status);
});

if (refreshClients) {
  refreshClients.addEventListener("click", async () => {
    if (rendering || clientActionBusy) return;

    setClientActionBusy(true);

    try {
      const status = await window.zefoxBridge.refreshDiscordClients();
      renderStatus(status);
    } finally {
      setClientActionBusy(false);
    }
  });
}

window.zefoxBridge.onStatus(renderStatus);
window.zefoxBridge.onUpdateStatus(renderUpdateStatus);

refreshStatus();
renderAppVersion();
