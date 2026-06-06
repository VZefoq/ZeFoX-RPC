const { app, BrowserWindow, ipcMain, Tray, Menu, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const {
  startBridge,
  stopBridge,
  setPresenceEnabled,
  setAccountDisplayEnabled,
  getStatus,
  bridgeEvents,
} = require("./bridge");

let mainWindow = null;
let tray = null;
let isQuitting = false;
let updateReady = false;
let updateCheckInProgress = false;
let updateDownloadInProgress = false;
let updatePromptOpen = false;
let manualUpdateCheckRequested = false;
let installAfterDownload = false;

function getIconPath() {
  const iconFile = process.platform === "win32" ? "app.ico" : "app-icon-256.png";
  return path.join(__dirname, "assets", iconFile);
}

function sendStatus() {
  const status = getStatus();
  sendToMainWindow("bridge:status", status);
  refreshTrayMenu(status);
  return status;
}

function sendToMainWindow(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const webContents = mainWindow.webContents;
  if (!webContents || webContents.isDestroyed()) return;

  try {
    webContents.send(channel, payload);
  } catch {}
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 620,
    minWidth: 420,
    minHeight: 580,
    title: "ZeFoX Presence Bridge",
    backgroundColor: "#191b1f",
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.removeMenu();
  mainWindow.loadFile("renderer.html");

  mainWindow.on("close", (event) => {
    if (isQuitting) return;

    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function refreshTrayMenu(status = getStatus()) {
  if (!tray) return;

  const bridgeLabel = status.bridgeRunning ? "Disable Bridge" : "Enable Bridge";
  const presenceLabel = status.presenceEnabled ? "Disable Rich Presence" : "Enable Rich Presence";
  const accountLabel = status.accountDisplayEnabled ? "Hide Account on Presence" : "Show Account on Presence";
  const updateBusy = updateCheckInProgress || updateDownloadInProgress || updatePromptOpen;

  const menu = Menu.buildFromTemplate([
    {
      label: "Open ZeFoX Presence Bridge",
      click: showMainWindow,
    },
    { type: "separator" },
    {
      label: bridgeLabel,
      click: () => {
        if (getStatus().bridgeRunning) {
          stopBridge();
        } else {
          startBridge();
        }

        sendStatus();
      },
    },
    {
      label: presenceLabel,
      enabled: status.bridgeRunning,
      click: () => {
        setPresenceEnabled(!getStatus().presenceEnabled);
        sendStatus();
      },
    },
    {
      label: accountLabel,
      enabled: status.bridgeRunning,
      click: () => {
        setAccountDisplayEnabled(!getStatus().accountDisplayEnabled);
        sendStatus();
      },
    },
    { type: "separator" },
    {
      label: "Check for Updates",
      enabled: !updateBusy,
      click: () => {
        void checkForUpdates(true);
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        stopBridge();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip(`ZeFoX Presence Bridge - ${status.bridgeRunning ? "Enabled" : "Disabled"}`);
}

function createTray() {
  try {
    tray = new Tray(getIconPath());
  } catch (error) {
    bridgeEvents.emit("error", `Could not create tray icon. ${error.message || error}`);
    return;
  }

  tray.on("click", showMainWindow);
  refreshTrayMenu();
}

function setupAutoUpdater() {
  if (!app.isPackaged) {
    bridgeEvents.emit("log", "Update checks are disabled in development.");
    return;
  }

  autoUpdater.autoDownload = false;

  autoUpdater.on("checking-for-update", () => {
    updateCheckInProgress = true;
    refreshTrayMenu();
    bridgeEvents.emit("log", "Checking for updates...");
  });

  autoUpdater.on("update-available", async (info) => {
    updateCheckInProgress = false;
    manualUpdateCheckRequested = false;
    refreshTrayMenu();
    bridgeEvents.emit("log", `Update ${info.version || ""} is available.`.trim());

    await promptForAvailableUpdate(info);
  });

  autoUpdater.on("update-not-available", () => {
    const shouldShowDialog = manualUpdateCheckRequested;
    updateCheckInProgress = false;
    manualUpdateCheckRequested = false;
    refreshTrayMenu();
    bridgeEvents.emit("log", "Presence Bridge is up to date.");

    if (shouldShowDialog) {
      void showAppMessageBox({
        type: "info",
        buttons: ["OK"],
        defaultId: 0,
        title: "No Update Available",
        message: "ZeFoX Presence Bridge is up to date.",
      });
    }
  });

  autoUpdater.on("download-progress", (progress) => {
    updateDownloadInProgress = true;
    refreshTrayMenu();
    bridgeEvents.emit("log", `Downloading update ${Math.round(progress.percent || 0)}%...`);
  });

  autoUpdater.on("update-downloaded", (info) => {
    updateReady = true;
    updateDownloadInProgress = false;
    bridgeEvents.emit("log", `Update ${info.version || ""} is ready to install.`.trim());
    refreshTrayMenu();

    if (installAfterDownload) {
      isQuitting = true;
      stopBridge();
      autoUpdater.quitAndInstall(false, true);
    }
  });

  autoUpdater.on("error", (error) => {
    const shouldShowDialog = manualUpdateCheckRequested;
    const message = formatUpdateError(error);

    updateCheckInProgress = false;
    updateDownloadInProgress = false;
    updatePromptOpen = false;
    manualUpdateCheckRequested = false;
    installAfterDownload = false;
    refreshTrayMenu();

    bridgeEvents.emit("error", message);

    if (shouldShowDialog) {
      void showAppMessageBox({
        type: "error",
        buttons: ["OK"],
        defaultId: 0,
        title: "Update Check Failed",
        message,
      });
    }
  });

  void checkForUpdates(false);
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    bridgeEvents.emit("log", "Update checks are disabled in development.");

    if (manual) {
      await showAppMessageBox({
        type: "info",
        buttons: ["OK"],
        defaultId: 0,
        title: "Updates Disabled",
        message: "Update checks are available after ZeFoX Presence Bridge is installed.",
      });
    }

    return;
  }

  if (updateReady) {
    await promptToInstallDownloadedUpdate();
    return;
  }

  if (updateCheckInProgress || updateDownloadInProgress || updatePromptOpen) {
    if (manual) {
      await showAppMessageBox({
        type: "info",
        buttons: ["OK"],
        defaultId: 0,
        title: "Update Check Running",
        message: "An update check is already running.",
      });
    }

    return;
  }

  manualUpdateCheckRequested = manual;

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    const shouldShowDialog = manualUpdateCheckRequested;
    const message = formatUpdateError(error);

    updateCheckInProgress = false;
    updateDownloadInProgress = false;
    updatePromptOpen = false;
    manualUpdateCheckRequested = false;
    installAfterDownload = false;
    refreshTrayMenu();
    bridgeEvents.emit("error", message);

    if (shouldShowDialog) {
      await showAppMessageBox({
        type: "error",
        buttons: ["OK"],
        defaultId: 0,
        title: "Update Check Failed",
        message,
      });
    }
  }
}

async function promptForAvailableUpdate(info) {
  if (updatePromptOpen) return;

  updatePromptOpen = true;
  refreshTrayMenu();

  const version = info?.version ? ` Version ${info.version} is available.` : "";
  const result = await showAppMessageBox({
    type: "info",
    buttons: ["Update", "Later"],
    defaultId: 0,
    cancelId: 1,
    title: "Update Available",
    message: "Update available. Update now?",
    detail: `${version} Choose Update to download and install it now.`.trim(),
  });

  updatePromptOpen = false;

  if (result.response !== 0) {
    installAfterDownload = false;
    bridgeEvents.emit("log", "Update postponed.");
    refreshTrayMenu();
    return;
  }

  installAfterDownload = true;
  updateDownloadInProgress = true;
  refreshTrayMenu();
  bridgeEvents.emit("log", `Downloading update ${info?.version || ""}...`.trim());

  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    const message = formatUpdateError(error);

    updateDownloadInProgress = false;
    installAfterDownload = false;
    refreshTrayMenu();
    bridgeEvents.emit("error", message);

    await showAppMessageBox({
      type: "error",
      buttons: ["OK"],
      defaultId: 0,
      title: "Update Download Failed",
      message,
    });
  }
}

async function promptToInstallDownloadedUpdate() {
  const result = await showAppMessageBox({
    type: "info",
    buttons: ["Update", "Later"],
    defaultId: 0,
    cancelId: 1,
    title: "Update Ready",
    message: "Update available. Update now?",
    detail: "The update has already been downloaded. Choose Update to restart and install it now.",
  });

  if (result.response === 0) {
    isQuitting = true;
    stopBridge();
    autoUpdater.quitAndInstall(false, true);
  }
}

function showAppMessageBox(options) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    return dialog.showMessageBox(mainWindow, options);
  }

  return dialog.showMessageBox(options);
}

function formatUpdateError(error) {
  const message = String(error?.message || error || "");

  if (/releases\.atom/i.test(message) && /\b404\b/.test(message)) {
    return "Update check failed because the GitHub release feed is not public. Use a public release repo or make the release repo public.";
  }

  return `Update check failed. ${message}`;
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  bridgeEvents.on("status", (status) => {
    sendToMainWindow("bridge:status", status);
    refreshTrayMenu(status);
  });

  bridgeEvents.on("error", (message) => {
    sendToMainWindow("bridge:error", message);
  });

  bridgeEvents.on("log", (message) => {
    sendToMainWindow("bridge:log", message);
  });

  setupAutoUpdater();
  startBridge();
});

app.on("activate", () => {
  if (!mainWindow) {
    createWindow();
  }

  showMainWindow();
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

ipcMain.handle("bridge:getStatus", () => getStatus());

ipcMain.handle("bridge:setPresenceEnabled", (_event, enabled) => {
  setPresenceEnabled(Boolean(enabled));
  return sendStatus();
});

ipcMain.handle("bridge:setAccountDisplayEnabled", (_event, enabled) => {
  setAccountDisplayEnabled(Boolean(enabled));
  return sendStatus();
});

ipcMain.handle("bridge:start", () => {
  startBridge();
  return sendStatus();
});

ipcMain.handle("bridge:stop", () => {
  stopBridge();
  return sendStatus();
});

app.on("before-quit", () => {
  isQuitting = true;
});
