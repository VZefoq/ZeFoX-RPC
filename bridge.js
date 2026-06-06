const express = require("express");
const cors = require("cors");
const RPC = require("discord-rpc");
const { EventEmitter } = require("events");
const { execFile } = require("child_process");
const packageInfo = require("./package.json");

const CLIENT_ID = "1505230354779214086";
const PORT = 3030;
const APP_VERSION = sanitizeVersion(packageInfo.version);
const DISCORD_CLIENTS = [
  { id: "stable", name: "Discord", exe: "Discord.exe", shortName: "DC" },
  { id: "ptb", name: "Discord PTB", exe: "DiscordPTB.exe", shortName: "PTB" },
  { id: "canary", name: "Discord Canary", exe: "DiscordCanary.exe", shortName: "CAN" },
  { id: "development", name: "Discord Dev", exe: "DiscordDevelopment.exe", shortName: "DEV" },
];

const bridgeEvents = new EventEmitter();

let httpApp = null;
let server = null;
let rpc = null;

let bridgeRunning = false;
let rpcReady = false;
let presenceEnabled = false;
let accountDisplayEnabled = false;
let lastStartedAt = Date.now();
let lastActivity = {};
let lastAccount = null;
let lastExtensionVersion = APP_VERSION;
let activeDiscordClientId = "stable";
let discordClientStatuses = DISCORD_CLIENTS.map((client) => ({
  ...client,
  running: false,
  connected: false,
  presenceActive: false,
}));
let discordDetectTimer = null;

function getStatus() {
  return {
    bridgeRunning,
    rpcReady,
    presenceEnabled,
    accountDisplayEnabled,
    account: lastAccount,
    port: PORT,
    activeDiscordClientId,
    discordClients: discordClientStatuses,
  };
}

function emitStatus() {
  bridgeEvents.emit("status", getStatus());
}

function detectProcessRunning(exeName) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve(false);
      return;
    }

    execFile("tasklist", ["/FI", `IMAGENAME eq ${exeName}`, "/NH"], { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }

      resolve(String(stdout || "").toLowerCase().includes(exeName.toLowerCase()));
    });
  });
}

async function refreshDiscordClients() {
  const statuses = await Promise.all(
    DISCORD_CLIENTS.map(async (client) => {
      const running = await detectProcessRunning(client.exe);
      const isActive = client.id === activeDiscordClientId;

      return {
        ...client,
        running,
        connected: Boolean(isActive && rpcReady),
        presenceActive: Boolean(isActive && rpcReady && presenceEnabled),
      };
    })
  );

  discordClientStatuses = statuses;
  emitStatus();
  return getStatus();
}

function startDiscordDetectionLoop() {
  if (discordDetectTimer) return;

  refreshDiscordClients().catch(() => {});

  discordDetectTimer = setInterval(() => {
    refreshDiscordClients().catch(() => {});
  }, 5000);
}

function stopDiscordDetectionLoop() {
  if (!discordDetectTimer) return;

  clearInterval(discordDetectTimer);
  discordDetectTimer = null;
}

function getActiveDiscordClientName() {
  return DISCORD_CLIENTS.find((client) => client.id === activeDiscordClientId)?.name || "Discord";
}

function selectDiscordClient(clientId) {
  if (!DISCORD_CLIENTS.some((client) => client.id === clientId)) {
    return getStatus();
  }

  activeDiscordClientId = clientId;
  bridgeEvents.emit("log", `Selected ${getActiveDiscordClientName()} as the preferred Discord client.`);

  if (rpc) {
    const currentRpc = rpc;
    rpc = null;
    rpcReady = false;

    try {
      currentRpc.destroy().catch(() => {});
    } catch {}
  }

  if (bridgeRunning) {
    createRpcClient();
  }

  refreshDiscordClients().catch(() => emitStatus());
  return getStatus();
}

function createRpcClient() {
  if (rpc) return;

  rpc = new RPC.Client({ transport: "ipc" });
  const currentRpc = rpc;
  RPC.register(CLIENT_ID);

  rpc.on("ready", () => {
    if (rpc !== currentRpc) return;

    rpcReady = true;
    bridgeEvents.emit("log", `Connected to ${getActiveDiscordClientName()}.`);
    emitStatus();
    refreshDiscordClients().catch(() => {});

    if (presenceEnabled) {
      setZeFoXPresence(lastActivity);
    }
  });

  rpc.on("disconnected", () => {
    if (rpc !== currentRpc) return;

    rpcReady = false;
    bridgeEvents.emit("log", `Disconnected from ${getActiveDiscordClientName()}.`);
    emitStatus();
    refreshDiscordClients().catch(() => {});
  });

  rpc.on("error", (error) => {
    if (rpc !== currentRpc) return;

    bridgeEvents.emit("error", `Discord RPC error. ${error.message || error}`);
  });

  rpc.login({ clientId: CLIENT_ID }).catch((error) => {
    if (rpc !== currentRpc) return;

    rpcReady = false;
    bridgeEvents.emit("error", `Could not connect to ${getActiveDiscordClientName()}. Make sure that Discord client is open. ${error.message || error}`);
    emitStatus();
    refreshDiscordClients().catch(() => {});
  });
}

function sanitizeAccount(account = {}) {
  const id = String(account.id || account.userId || "").trim();
  const username = String(account.username || account.name || "").trim();
  const displayName = String(account.displayName || "").trim();
  const thumbnailUrl = String(account.thumbnailUrl || account.headshotUrl || "").trim();

  if (!id && !username && !displayName && !thumbnailUrl) {
    return null;
  }

  return {
    id,
    username,
    displayName,
    thumbnailUrl,
    profileUrl: id ? `https://www.roblox.com/users/${encodeURIComponent(id)}/profile` : "",
  };
}

function getAccountLabel(account) {
  if (!account) return "Roblox";

  if (account.username) {
    return `@${account.username}`;
  }

  return account.displayName || "Roblox account";
}

function sanitizeVersion(version) {
  const value = String(version || "").trim();
  return /^\d+(?:\.\d+){0,3}(?:[-+][a-z0-9.-]+)?$/i.test(value) ? value : "";
}

function setZeFoXPresence(activity = {}) {
  lastActivity = activity || {};

  const extensionVersion = sanitizeVersion(
    lastActivity.extensionVersion || lastActivity.version || lastActivity.extension?.version
  );
  if (extensionVersion) {
    lastExtensionVersion = extensionVersion;
  }

  const account = sanitizeAccount(lastActivity.account);
  if (account) {
    lastAccount = account;
  }

  if (!rpcReady || !rpc || !presenceEnabled) return;

  const buttons = [
    {
      label: "Download now",
      url: "https://zefoxx.netlify.app",
    },
  ];

  if (accountDisplayEnabled && lastAccount?.profileUrl) {
    buttons.push({
      label: "View account",
      url: lastAccount.profileUrl,
    });
  }

  const presence = {
    details: "Enhance ur roblox experience",
    startTimestamp: lastStartedAt,
    largeImageKey: "zefox_logo",
    largeImageText: "ZeFoX",
    smallImageKey: accountDisplayEnabled && lastAccount?.thumbnailUrl ? lastAccount.thumbnailUrl : "roblox_logo",
    smallImageText: accountDisplayEnabled ? getAccountLabel(lastAccount) : "Roblox",
    buttons,
    instance: false,
  };

  if (lastExtensionVersion) {
    presence.state = `Version ${lastExtensionVersion}`;
  }

  rpc.setActivity(presence).catch((error) => {
    bridgeEvents.emit("error", `Could not update Discord presence. ${error.message || error}`);
  });
  bridgeEvents.emit("log", "Presence updated.");
}

function clearPresence() {
  if (!rpcReady || !rpc) return;

  rpc.clearActivity().catch(() => {});
  bridgeEvents.emit("log", "Presence cleared.");
}

function startBridge() {
  if (bridgeRunning || server) return;

  httpApp = express();

  httpApp.use(cors({
    origin(origin, callback) {
      const allowedOrigins = new Set([
        "https://www.roblox.com",
        "https://web.roblox.com",
      ]);

      if (!origin || allowedOrigins.has(origin) || String(origin).startsWith("chrome-extension://")) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed by ZeFoX Presence Bridge"));
    },
  }));

  httpApp.use(express.json({ limit: "100kb" }));

  httpApp.get("/health", (_req, res) => {
    res.json({
      ok: true,
      app: "ZeFoX Presence Bridge",
      ...getStatus(),
    });
  });

  httpApp.post("/presence", (req, res) => {
    presenceEnabled = Boolean(req.body?.enabled);

    if (presenceEnabled) {
      lastStartedAt = Date.now();
      setZeFoXPresence(req.body || {});
    } else {
      clearPresence();
    }

    emitStatus();
    res.json({ ok: true });
  });

  server = httpApp.listen(PORT, "127.0.0.1", () => {
    bridgeRunning = true;
    bridgeEvents.emit("log", `Bridge enabled on http://127.0.0.1:${PORT}`);
    emitStatus();
  });

  server.on("error", (error) => {
    bridgeRunning = false;
    server = null;
    httpApp = null;
    bridgeEvents.emit("error", `Bridge server error: ${error.message || error}`);
    emitStatus();
  });

  createRpcClient();
  startDiscordDetectionLoop();
}

function stopBridge() {
  presenceEnabled = false;
  clearPresence();
  stopDiscordDetectionLoop();

  if (rpc) {
    const currentRpc = rpc;
    rpc = null;
    rpcReady = false;

    try {
      currentRpc.destroy().catch(() => {});
    } catch {}
  } else {
    rpcReady = false;
  }

  if (server) {
    try {
      server.close();
    } catch {}
  }

  server = null;
  httpApp = null;
  bridgeRunning = false;

  discordClientStatuses = discordClientStatuses.map((client) => ({
    ...client,
    connected: false,
    presenceActive: false,
  }));

  bridgeEvents.emit("log", "Bridge disabled.");
  emitStatus();
}

function setPresenceEnabled(enabled) {
  presenceEnabled = Boolean(enabled);

  if (presenceEnabled) {
    if (!bridgeRunning) {
      startBridge();
    }

    lastStartedAt = Date.now();
    setZeFoXPresence(lastActivity);
  } else {
    clearPresence();
  }

  emitStatus();
}

function setAccountDisplayEnabled(enabled) {
  accountDisplayEnabled = Boolean(enabled);

  if (presenceEnabled) {
    setZeFoXPresence(lastActivity);
  }

  emitStatus();
}

module.exports = {
  startBridge,
  stopBridge,
  setPresenceEnabled,
  setAccountDisplayEnabled,
  selectDiscordClient,
  refreshDiscordClients,
  getStatus,
  bridgeEvents,
};
