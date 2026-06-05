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

function getIconPath() {
  const iconFile = process.platform === "win32" ? "app.ico" : "app-icon-256.png";
  return path.join(__dirname, "assets", iconFile);
}

function sendStatus() {
  const status = getStatus();
  mainWindow?.webContents.send("bridge:status", status);
  refreshTrayMenu(status);
  return status;
}

function showMainWindow() {
  if (!mainWindow) return;

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
}

function refreshTrayMenu(status = getStatus()) {
  if (!tray) return;

  const bridgeLabel = status.bridgeRunning ? "Disable Bridge" : "Enable Bridge";
  const presenceLabel = status.presenceEnabled ? "Disable Rich Presence" : "Enable Rich Presence";
  const accountLabel = status.accountDisplayEnabled ? "Hide Account on Presence" : "Show Account on Presence";

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

  autoUpdater.autoDownload = true;

  autoUpdater.on("checking-for-update", () => {
    bridgeEvents.emit("log", "Checking for updates...");
  });

  autoUpdater.on("update-available", (info) => {
    bridgeEvents.emit("log", `Downloading update ${info.version || ""}...`.trim());
  });

  autoUpdater.on("update-not-available", () => {
    bridgeEvents.emit("log", "Presence Bridge is up to date.");
  });

  autoUpdater.on("download-progress", (progress) => {
    bridgeEvents.emit("log", `Downloading update ${Math.round(progress.percent || 0)}%...`);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    updateReady = true;
    bridgeEvents.emit("log", `Update ${info.version || ""} is ready to install.`.trim());

    const result = await dialog.showMessageBox({
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "ZeFoX Presence Bridge Update",
      message: "A new Presence Bridge update is ready.",
      detail: "Restart the app now to install it, or install it the next time you quit.",
    });

    if (result.response === 0) {
      isQuitting = true;
      stopBridge();
      autoUpdater.quitAndInstall(false, true);
    }
  });

  autoUpdater.on("error", (error) => {
    bridgeEvents.emit("error", formatUpdateError(error));
  });

  autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    bridgeEvents.emit("error", formatUpdateError(error));
  });
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
    mainWindow?.webContents.send("bridge:status", status);
    refreshTrayMenu(status);
  });

  bridgeEvents.on("error", (message) => {
    mainWindow?.webContents.send("bridge:error", message);
  });

  bridgeEvents.on("log", (message) => {
    mainWindow?.webContents.send("bridge:log", message);
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
  if (!updateReady) return;

  isQuitting = true;
});
