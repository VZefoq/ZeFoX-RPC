const appState = document.getElementById("appState");
const bridgeToggle = document.getElementById("bridgeToggle");
const presenceToggle = document.getElementById("presenceToggle");
const accountToggle = document.getElementById("accountToggle");
const appVersion = document.getElementById("appVersion");

let rendering = false;

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

window.zefoxBridge.onStatus(renderStatus);

refreshStatus();
renderAppVersion();
