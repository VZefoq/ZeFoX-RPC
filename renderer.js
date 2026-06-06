const appState = document.getElementById("appState");
const bridgeToggle = document.getElementById("bridgeToggle");
const presenceToggle = document.getElementById("presenceToggle");
const accountToggle = document.getElementById("accountToggle");
const appVersion = document.getElementById("appVersion");
const discordClients = document.getElementById("discordClients");
const refreshClients = document.getElementById("refreshClients");

let rendering = false;

function renderDiscordClients(status) {
  if (!discordClients) return;

  const clients = Array.isArray(status.discordClients) ? status.discordClients : [];
  const activeId = status.activeDiscordClientId;

  discordClients.innerHTML = "";

  for (const client of clients) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "discord-client-card";
    card.classList.toggle("active", client.id === activeId);
    card.classList.toggle("running", Boolean(client.running));
    card.classList.toggle("connected", Boolean(client.presenceActive));

    const connectionText = client.presenceActive
      ? "Connected with Presence"
      : client.connected
        ? "Connected"
        : "Not connected";

    const runningText = client.running ? "Running" : "Not running";

    card.innerHTML = `
      <span class="client-icon">${client.shortName || "DC"}</span>
      <span class="client-copy">
        <strong>${client.name}</strong>
        <small>${runningText} - ${connectionText}</small>
      </span>
    `;

    card.addEventListener("click", async () => {
      if (rendering) return;

      const nextStatus = await window.zefoxBridge.selectDiscordClient(client.id);
      renderStatus(nextStatus);
    });

    discordClients.appendChild(card);
  }
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
  if (rendering) return;

  const status = bridgeToggle.checked
    ? await window.zefoxBridge.start()
    : await window.zefoxBridge.stop();

  renderStatus(status);
});

presenceToggle.addEventListener("change", async () => {
  if (rendering) return;

  const status = await window.zefoxBridge.setPresenceEnabled(presenceToggle.checked);
  renderStatus(status);
});

accountToggle.addEventListener("change", async () => {
  if (rendering) return;

  const status = await window.zefoxBridge.setAccountDisplayEnabled(accountToggle.checked);
  renderStatus(status);
});

if (refreshClients) {
  refreshClients.addEventListener("click", async () => {
    if (rendering) return;

    const status = await window.zefoxBridge.refreshDiscordClients();
    renderStatus(status);
  });
}

window.zefoxBridge.onStatus(renderStatus);

refreshStatus();
renderAppVersion();
