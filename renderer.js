const appState = document.getElementById("appState");
const bridgeToggle = document.getElementById("bridgeToggle");
const presenceToggle = document.getElementById("presenceToggle");
const accountToggle = document.getElementById("accountToggle");
const gameToggle = document.getElementById("gameToggle");
const appVersion = document.getElementById("appVersion");
const discordClients = document.getElementById("discordClients");
const refreshClients = document.getElementById("refreshClients");
const updateStatus = document.getElementById("updateStatus");
const updateStatusText = document.getElementById("updateStatusText");

let rendering = false;
let clientActionBusy = false;
let pendingClientId = null;
function getDiscordClientIcon() {
  return `
    <svg viewBox="0 -28.5 256 256" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M216.856 16.597C200.285 8.843 182.566 3.208 164.042 0c-2.276 4.113-4.933 9.645-6.766 14.046-19.692-2.961-39.203-2.961-58.533 0C96.911 9.645 94.193 4.113 91.897 0 73.353 3.208 55.613 8.864 39.042 16.638 5.618 67.147-3.443 116.401 1.087 164.956c22.169 16.555 43.653 26.612 64.775 33.193 5.215-7.178 9.866-14.807 13.873-22.849-7.631-2.9-14.94-6.478-21.846-10.632 1.832-1.357 3.624-2.777 5.356-4.237 42.122 19.702 87.89 19.702 129.51 0 1.751 1.46 3.543 2.879 5.355 4.237-6.926 4.175-14.255 7.753-21.886 10.653 4.006 8.02 8.638 15.671 13.873 22.848 21.142-6.581 42.646-16.637 64.815-33.213 5.316-56.288-9.081-105.09-38.056-148.359ZM85.474 135.095c-12.645 0-23.015-11.805-23.015-26.18 0-14.375 10.149-26.2 23.015-26.2s23.236 11.804 23.015 26.2c.02 14.375-10.148 26.18-23.015 26.18Zm85.051 0c-12.645 0-23.014-11.805-23.014-26.18 0-14.375 10.148-26.2 23.014-26.2s23.236 11.804 23.015 26.2c0 14.375-10.148 26.18-23.015 26.18Z"></path>
    </svg>
  `;
}

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
      <span class="client-icon client-icon-${client.id}">${getDiscordClientIcon(client.id)}</span>
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
  gameToggle.checked = Boolean(status.gameDisplayEnabled);
  gameToggle.disabled = !bridgeRunning;

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

gameToggle.addEventListener("change", async () => {
  if (rendering || clientActionBusy) return;

  const status = await window.zefoxBridge.setGameDisplayEnabled(gameToggle.checked);
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
