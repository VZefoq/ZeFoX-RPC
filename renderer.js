const appState = document.getElementById("appState");
const bridgeStatus = document.getElementById("bridgeStatus");
const discordStatus = document.getElementById("discordStatus");
const portStatus = document.getElementById("portStatus");
const bridgeToggle = document.getElementById("bridgeToggle");
const presenceToggle = document.getElementById("presenceToggle");
const accountToggle = document.getElementById("accountToggle");
const message = document.getElementById("message");

let rendering = false;

function renderStatus(status) {
  rendering = true;

  const bridgeRunning = Boolean(status.bridgeRunning);
  const presenceEnabled = Boolean(status.presenceEnabled);

  appState.textContent = bridgeRunning ? "Enabled" : "Disabled";
  appState.classList.toggle("disabled", !bridgeRunning);

  bridgeStatus.textContent = bridgeRunning ? "Enabled" : "Disabled";
  discordStatus.textContent = status.rpcReady ? "Connected" : "Not connected";
  portStatus.textContent = `127.0.0.1:${status.port || 3030}`;

  bridgeToggle.checked = bridgeRunning;
  presenceToggle.checked = presenceEnabled;
  presenceToggle.disabled = !bridgeRunning;
  accountToggle.checked = Boolean(status.accountDisplayEnabled);
  accountToggle.disabled = !bridgeRunning;

  rendering = false;
}

async function refreshStatus() {
  const status = await window.zefoxBridge.getStatus();
  renderStatus(status);
}

bridgeToggle.addEventListener("change", async () => {
  if (rendering) return;

  message.textContent = bridgeToggle.checked
    ? "Enabling bridge..."
    : "Disabling bridge...";

  const status = bridgeToggle.checked
    ? await window.zefoxBridge.start()
    : await window.zefoxBridge.stop();

  renderStatus(status);
  message.textContent = status.bridgeRunning
    ? "Bridge enabled."
    : "Bridge disabled.";
});

presenceToggle.addEventListener("change", async () => {
  if (rendering) return;

  const status = await window.zefoxBridge.setPresenceEnabled(presenceToggle.checked);
  renderStatus(status);

  message.textContent = status.presenceEnabled
    ? "Rich Presence enabled."
    : "Rich Presence disabled.";
});

accountToggle.addEventListener("change", async () => {
  if (rendering) return;

  const status = await window.zefoxBridge.setAccountDisplayEnabled(accountToggle.checked);
  renderStatus(status);

  message.textContent = status.accountDisplayEnabled
    ? "Account display enabled."
    : "Account display disabled.";
});

window.zefoxBridge.onStatus(renderStatus);

window.zefoxBridge.onError((text) => {
  message.textContent = text;
});

window.zefoxBridge.onLog((text) => {
  message.textContent = text;
});

refreshStatus();
