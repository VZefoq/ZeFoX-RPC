const express = require("express");
const cors = require("cors");
const RPC = require("discord-rpc");
const { EventEmitter } = require("events");

const CLIENT_ID = "1505230354779214086";
const PORT = 3030;

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

function getStatus() {
  return {
    bridgeRunning,
    rpcReady,
    presenceEnabled,
    accountDisplayEnabled,
    account: lastAccount,
    port: PORT,
  };
}

function emitStatus() {
  bridgeEvents.emit("status", getStatus());
}

function createRpcClient() {
  if (rpc) return;

  rpc = new RPC.Client({ transport: "ipc" });
  RPC.register(CLIENT_ID);

  rpc.on("ready", () => {
    rpcReady = true;
    bridgeEvents.emit("log", "Connected to Discord.");
    emitStatus();

    if (presenceEnabled) {
      setZeFoXPresence(lastActivity);
    }
  });

  rpc.on("disconnected", () => {
    rpcReady = false;
    bridgeEvents.emit("log", "Disconnected from Discord.");
    emitStatus();
  });

  rpc.login({ clientId: CLIENT_ID }).catch((error) => {
    rpcReady = false;
    bridgeEvents.emit("error", `Could not connect to Discord. Make sure Discord desktop is open. ${error.message || error}`);
    emitStatus();
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

function setZeFoXPresence(activity = {}) {
  lastActivity = activity || {};

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
    state: "v0.8.9",
    startTimestamp: lastStartedAt,
    largeImageKey: "zefox_logo",
    largeImageText: "ZeFoX",
    smallImageKey: accountDisplayEnabled && lastAccount?.thumbnailUrl ? lastAccount.thumbnailUrl : "roblox_logo",
    smallImageText: accountDisplayEnabled ? getAccountLabel(lastAccount) : "Roblox",
    buttons,
    instance: false,
  };

  rpc.setActivity(presence);
  bridgeEvents.emit("log", "Presence updated.");
}

function clearPresence() {
  if (!rpcReady || !rpc) return;

  rpc.clearActivity();
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
}

function stopBridge() {
  presenceEnabled = false;
  clearPresence();

  if (rpc) {
    try {
      rpc.destroy();
    } catch {}
  }

  rpc = null;
  rpcReady = false;

  if (server) {
    try {
      server.close();
    } catch {}
  }

  server = null;
  httpApp = null;
  bridgeRunning = false;

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
  getStatus,
  bridgeEvents,
};
