const express = require("express");
const cors = require("cors");
const RPC = require("discord-rpc");
const rpcTransports = require("discord-rpc/src/transports");
const net = require("net");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { execFile } = require("child_process");
const packageInfo = require("./package.json");

const CLIENT_ID = "1505230354779214086";
const PORT = 3030;
const APP_VERSION = sanitizeVersion(packageInfo.version);
const DISCORD_CLIENTS = [
  { id: "stable", name: "Discord", exe: "Discord.exe", installDir: "Discord", shortName: "DC" },
  { id: "canary", name: "Discord Canary", exe: "DiscordCanary.exe", installDir: "DiscordCanary", shortName: "CAN" },
  { id: "ptb", name: "Discord PTB", exe: "DiscordPTB.exe", installDir: "DiscordPTB", shortName: "PTB" },
  { id: "development", name: "Discord Dev", exe: "DiscordDevelopment.exe", installDir: "DiscordDevelopment", shortName: "DEV" },
];
const OPCodes = {
  HANDSHAKE: 0,
  FRAME: 1,
  CLOSE: 2,
  PING: 3,
  PONG: 4,
};

function getIPCPath(id) {
  if (process.platform === "win32") {
    return `\\\\?\\pipe\\discord-ipc-${id}`;
  }

  const { XDG_RUNTIME_DIR, TMPDIR, TMP, TEMP } = process.env;
  const prefix = XDG_RUNTIME_DIR || TMPDIR || TMP || TEMP || "/tmp";
  return `${prefix.replace(/\/$/, "")}/discord-ipc-${id}`;
}

function encodeDiscordPacket(op, data) {
  const json = JSON.stringify(data);
  const length = Buffer.byteLength(json);
  const packet = Buffer.alloc(8 + length);

  packet.writeInt32LE(op, 0);
  packet.writeInt32LE(length, 4);
  packet.write(json, 8, length);

  return packet;
}

class ZeFoXIPCTransport extends EventEmitter {
  constructor(client) {
    super();
    this.client = client;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
  }

  connect() {
    return new Promise((resolve, reject) => {
      const pipeId = Number(this.client.options.pipeId || 0);
      const socket = net.createConnection(getIPCPath(pipeId));

      this.socket = socket;

      socket.once("connect", () => {
        socket.removeListener("error", reject);
        socket.on("close", this.onClose.bind(this));
        socket.on("error", this.onClose.bind(this));
        socket.on("data", this.onData.bind(this));
        this.emit("open");
        this.send({
          v: 1,
          client_id: this.client.clientId,
        }, OPCodes.HANDSHAKE);
        resolve();
      });

      socket.once("error", reject);
    });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0);
      const length = this.buffer.readInt32LE(4);

      if (this.buffer.length < 8 + length) return;

      const raw = this.buffer.slice(8, 8 + length).toString();
      this.buffer = this.buffer.slice(8 + length);

      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        continue;
      }

      if (op === OPCodes.PING) {
        this.send(data, OPCodes.PONG);
      } else if (op === OPCodes.FRAME) {
        this.emit("message", data);
      } else if (op === OPCodes.CLOSE) {
        this.emit("close", data);
      }
    }
  }

  onClose(error) {
    this.emit("close", error);
  }

  send(data, op = OPCodes.FRAME) {
    if (!this.socket || this.socket.destroyed) return;
    this.socket.write(encodeDiscordPacket(op, data));
  }

  close() {
    return new Promise((resolve) => {
      if (!this.socket || this.socket.destroyed) {
        resolve();
        return;
      }

      const socket = this.socket;
      const finish = () => resolve();
      const timeout = setTimeout(finish, 700);

      socket.once("close", () => {
        clearTimeout(timeout);
        finish();
      });

      try {
        this.send({}, OPCodes.CLOSE);
        socket.end();
      } catch {
        socket.destroy();
        clearTimeout(timeout);
        finish();
      }
    });
  }
}

rpcTransports.zefoxIpc = ZeFoXIPCTransport;

const bridgeEvents = new EventEmitter();

let httpApp = null;
let server = null;
const rpcClients = new Map();

let bridgeRunning = false;
let rpcReady = false;
let presenceEnabled = false;
let accountDisplayEnabled = false;
let gameDisplayEnabled = false;
let lastStartedAt = Date.now();
let lastActivity = {};
let lastAccount = null;
let lastExtensionVersion = APP_VERSION;
let selectedDiscordClientIds = new Set();
let discordClientStatuses = [];
let discordDetectTimer = null;
let discordRefreshPromise = null;

function getStatus() {
  return {
    bridgeRunning,
    rpcReady,
    presenceEnabled,
    accountDisplayEnabled,
    gameDisplayEnabled,
    account: lastAccount,
    port: PORT,
    activeDiscordClientId: Array.from(selectedDiscordClientIds)[0] || "",
    selectedDiscordClientIds: Array.from(selectedDiscordClientIds),
    discordClients: discordClientStatuses,
  };
}

function emitStatus() {
  bridgeEvents.emit("status", getStatus());
}

function updateRpcReady() {
  rpcReady = Array.from(rpcClients.values()).some((session) => session.ready);
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

function detectDiscordIpcState() {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve(null);
      return;
    }

    const quotedExeNames = DISCORD_CLIENTS
      .map((client) => `'${client.exe.replace(/'/g, "''")}'`)
      .join(",");
    const quotedInstallDirs = DISCORD_CLIENTS
      .map((client) => `'${client.installDir.replace(/'/g, "''")}'`)
      .join(",");
    const command = [
      `$names = @(${quotedExeNames})`,
      `$installDirs = @(${quotedInstallDirs})`,
      "$processes = Get-CimInstance Win32_Process |",
      "Where-Object {",
      "$process = $_",
      "$names -contains $process.Name -or",
      "($process.ExecutablePath -and ($installDirs | Where-Object { $process.ExecutablePath -like ('*\\' + $_ + '\\*') }))",
      "} |",
      "ForEach-Object {",
      "[PSCustomObject]@{",
      "Name = $_.Name;",
      "ProcessId = [int]$_.ProcessId;",
      "ExecutablePath = [string]$_.ExecutablePath;",
      "CreationDate = $_.CreationDate.ToUniversalTime().ToString('o')",
      "}",
      "}",
      "$typeDefinition = 'using System; using System.Runtime.InteropServices; public static class ZeFoXPipeNative { [DllImport(\"kernel32.dll\", SetLastError = true)] public static extern bool GetNamedPipeServerProcessId(IntPtr pipe, out uint serverProcessId); }'",
      "Add-Type -TypeDefinition $typeDefinition",
      "$pipes = @()",
      "for ($i = 0; $i -lt 10; $i++) {",
      "try {",
      "$pipe = [System.IO.Pipes.NamedPipeClientStream]::new('.', \"discord-ipc-$i\", [System.IO.Pipes.PipeDirection]::InOut, [System.IO.Pipes.PipeOptions]::None)",
      "try {",
      "$pipe.Connect(75)",
      "[uint32]$serverProcessId = 0",
      "if ([ZeFoXPipeNative]::GetNamedPipeServerProcessId($pipe.SafePipeHandle.DangerousGetHandle(), [ref]$serverProcessId)) {",
      "$pipes += [PSCustomObject]@{ PipeId = [int]$i; ProcessId = [int]$serverProcessId }",
      "}",
      "} finally { $pipe.Dispose() }",
      "} catch {}",
      "}",
      "[PSCustomObject]@{ Processes = @($processes); Pipes = @($pipes) } | ConvertTo-Json -Compress -Depth 4",
    ].join("\n");

    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
      { windowsHide: true, timeout: 4000 },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }

        const raw = String(stdout || "").trim();
        if (!raw) {
          resolve({
            processesByClientId: new Map(),
            pipeIdsByClientId: new Map(),
          });
          return;
        }

        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          resolve(null);
          return;
        }

        const processRows = Array.isArray(parsed?.Processes)
          ? parsed.Processes
          : (parsed?.Processes ? [parsed.Processes] : []);
        const pipeRows = Array.isArray(parsed?.Pipes)
          ? parsed.Pipes
          : (parsed?.Pipes ? [parsed.Pipes] : []);
        const processesByClientId = new Map();
        const processesById = new Map();

        processRows.forEach((row) => {
          const exeName = String(row?.Name || "").toLowerCase();
          const executablePath = String(row?.ExecutablePath || "").toLowerCase();
          const processId = Number(row?.ProcessId) || 0;
          const startedAtMs = Date.parse(row?.CreationDate);
          if (!exeName || !processId) return;
          const client = getClientForProcess(exeName, executablePath);
          if (!client) return;

          const processInfo = {
            clientId: client.id,
            exeName,
            executablePath,
            processId,
            startedAtMs: Number.isNaN(startedAtMs) ? 0 : startedAtMs,
          };
          const existing = processesByClientId.get(client.id);

          if (!existing || processInfo.startedAtMs < existing.startedAtMs) {
            processesByClientId.set(client.id, processInfo);
          }

          processesById.set(processId, processInfo);
        });

        const pipeIdsByClientId = new Map();

        pipeRows.forEach((row) => {
          const pipeId = Number(row?.PipeId);
          const processId = Number(row?.ProcessId) || 0;
          const processInfo = processesById.get(processId);
          if (!Number.isInteger(pipeId) || !processInfo) return;

          const existingPipeId = pipeIdsByClientId.get(processInfo.clientId);
          if (existingPipeId === undefined || pipeId < existingPipeId) {
            pipeIdsByClientId.set(processInfo.clientId, pipeId);
          }
        });

        resolve({
          processesByClientId,
          pipeIdsByClientId,
        });
      }
    );
  });
}

function detectDiscordInstalled(client, running = false) {
  if (running) return true;

  if (process.platform !== "win32") {
    return false;
  }

  const installRoots = [
    process.env.LOCALAPPDATA,
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
  ].filter(Boolean);

  return installRoots.some((root) => {
    const installPath = path.join(root, client.installDir);

    try {
      return fs.existsSync(installPath);
    } catch {
      return false;
    }
  });
}

function getClientName(clientId) {
  return DISCORD_CLIENTS.find((client) => client.id === clientId)?.name || "Discord";
}

function getClientForProcess(exeName, executablePath = "") {
  const normalizedPath = String(executablePath || "").replace(/\//g, "\\").toLowerCase();
  const pathClient = DISCORD_CLIENTS.find((client) => normalizedPath.includes(`\\${client.installDir.toLowerCase()}\\`));

  if (pathClient) {
    return pathClient;
  }

  return DISCORD_CLIENTS.find((client) => client.exe.toLowerCase() === exeName);
}

function getRunningClients(statuses = discordClientStatuses) {
  return DISCORD_CLIENTS.filter((client) => {
    const status = statuses.find((item) => item.id === client.id);
    return Boolean(status?.running);
  });
}

function getClientPipeId(clientId, statuses = discordClientStatuses) {
  const status = statuses.find((item) => item.id === clientId);
  if (Number.isInteger(status?.pipeId)) {
    return status.pipeId;
  }

  const runningClients = getRunningClients(statuses);
  const index = runningClients.findIndex((client) => client.id === clientId);
  return index >= 0 ? index : null;
}

async function refreshDiscordClients() {
  if (discordRefreshPromise) {
    return discordRefreshPromise;
  }

  discordRefreshPromise = refreshDiscordClientsNow().finally(() => {
    discordRefreshPromise = null;
  });

  return discordRefreshPromise;
}

async function refreshDiscordClientsAfterSelection() {
  if (discordRefreshPromise) {
    await discordRefreshPromise.catch(() => {});
  }

  return refreshDiscordClients();
}

async function refreshDiscordClientsNow() {
  const detectedIpcState = await detectDiscordIpcState();
  const processStatuses = await Promise.all(
    DISCORD_CLIENTS.map(async (client) => {
      const processInfo = detectedIpcState?.processesByClientId.get(client.id);
      const running = detectedIpcState ? Boolean(processInfo) : await detectProcessRunning(client.exe);
      const installed = detectDiscordInstalled(client, running);
      const session = rpcClients.get(client.id);
      const selected = selectedDiscordClientIds.has(client.id);

      return {
        ...client,
        installed,
        selected,
        running,
        pipeId: detectedIpcState?.pipeIdsByClientId.get(client.id) ?? null,
        processId: processInfo?.processId || null,
        processStartedAtMs: processInfo?.startedAtMs || null,
        connecting: Boolean(session?.connecting),
        connected: Boolean(session?.ready),
        presenceActive: Boolean(session?.ready && presenceEnabled),
      };
    })
  );

  const installedStatuses = processStatuses.filter((client) => client.installed);
  discordClientStatuses = installedStatuses.map((client) => ({
    ...client,
    selected: selectedDiscordClientIds.has(client.id),
  }));
  syncDiscordRpcClients(discordClientStatuses);
  updateRpcReady();
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

function syncDiscordRpcClients(statuses = discordClientStatuses) {
  if (!bridgeRunning) return;

  const desiredClientPipeIds = new Map();

  statuses
    .filter((client) => client.running && selectedDiscordClientIds.has(client.id))
    .forEach((client) => {
      const pipeId = getClientPipeId(client.id, statuses);
      if (pipeId !== null) {
        desiredClientPipeIds.set(client.id, pipeId);
      }
    });

  for (const [clientId, session] of rpcClients) {
    const desiredPipeId = desiredClientPipeIds.get(clientId);

    if (desiredPipeId === undefined || desiredPipeId !== session.pipeId) {
      rpcClients.delete(clientId);
      session.ready = false;
      session.connecting = false;

      try {
        session.rpc.clearActivity().catch(() => {});
      } catch {}

      try {
        session.rpc.destroy().catch(() => {});
      } catch {}
    }
  }

  for (const [clientId, pipeId] of desiredClientPipeIds) {
    const existingSession = rpcClients.get(clientId);
    if (existingSession?.ready || existingSession?.connecting) continue;

    createRpcClient(clientId, pipeId);
  }
}

async function selectDiscordClient(clientId) {
  if (!DISCORD_CLIENTS.some((client) => client.id === clientId)) {
    return getStatus();
  }

  if (selectedDiscordClientIds.has(clientId)) {
    selectedDiscordClientIds.delete(clientId);
    await clearPresenceForClient(clientId);
    bridgeEvents.emit("log", `${getClientName(clientId)} disabled for Rich Presence.`);
  } else {
    selectedDiscordClientIds.add(clientId);
    bridgeEvents.emit("log", `${getClientName(clientId)} enabled for Rich Presence.`);
  }

  await refreshDiscordClientsAfterSelection();

  if (presenceEnabled) {
    setZeFoXPresence(lastActivity);
  }

  return getStatus();
}

function createRpcClient(clientId, pipeId) {
  if (rpcClients.has(clientId)) return;

  const rpc = new RPC.Client({ transport: "zefoxIpc", pipeId });
  const session = {
    clientId,
    pipeId,
    rpc,
    ready: false,
    connecting: true,
  };

  rpcClients.set(clientId, session);
  RPC.register(CLIENT_ID);

  rpc.on("ready", () => {
    if (rpcClients.get(clientId) !== session) return;

    session.ready = true;
    session.connecting = false;
    updateRpcReady();
    bridgeEvents.emit("log", `Connected to ${getClientName(clientId)}.`);
    emitStatus();
    refreshDiscordClients().catch(() => {});

    if (presenceEnabled) {
      setZeFoXPresence(lastActivity);
    }
  });

  rpc.on("disconnected", () => {
    if (rpcClients.get(clientId) !== session) return;

    session.ready = false;
    session.connecting = false;
    rpcClients.delete(clientId);
    updateRpcReady();
    bridgeEvents.emit("log", `Disconnected from ${getClientName(clientId)}.`);
    emitStatus();
    refreshDiscordClients().catch(() => {});
  });

  rpc.on("error", (error) => {
    if (rpcClients.get(clientId) !== session) return;

    bridgeEvents.emit("error", `${getClientName(clientId)} RPC error. ${error.message || error}`);
  });

  rpc.login({ clientId: CLIENT_ID }).catch((error) => {
    if (rpcClients.get(clientId) !== session) return;

    session.ready = false;
    session.connecting = false;
    rpcClients.delete(clientId);
    updateRpcReady();
    bridgeEvents.emit("error", `Could not connect to ${getClientName(clientId)}. Make sure that Discord client is open. ${error.message || error}`);
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

function sanitizeText(value, maxLength = 128) {
  return String(value || "").trim().slice(0, maxLength);
}

function sanitizeUrl(value) {
  const url = String(value || "").trim();

  if (!url) return "";

  try {
    const parsed = new URL(url);

    if (!["https:", "http:"].includes(parsed.protocol)) {
      return "";
    }

    return parsed.toString();
  } catch {
    return "";
  }
}

function getGameName(activity = {}) {
  const presence =
    activity.userPresence ||
    activity.robloxPresence ||
    activity.userPresences?.[0] ||
    activity.robloxPresence?.userPresences?.[0];

  return sanitizeText(
    activity.gameName ||
      activity.placeName ||
      activity.experienceName ||
      activity.game?.name ||
      activity.place?.name ||
      presence?.lastLocation,
    96,
  );
}

function getGameImageUrl(activity = {}) {
  return sanitizeUrl(
    activity.gameIconUrl ||
      activity.gameThumbnailUrl ||
      activity.thumbnailUrl ||
      activity.imageUrl ||
      activity.game?.iconUrl ||
      activity.game?.thumbnailUrl ||
      activity.game?.imageUrl ||
      activity.place?.iconUrl ||
      activity.place?.thumbnailUrl ||
      activity.place?.imageUrl,
  );
}

function getJoinGameUrl(activity = {}) {
  const presence =
    activity.userPresence ||
    activity.robloxPresence ||
    activity.userPresences?.[0] ||
    activity.robloxPresence?.userPresences?.[0];

  const placeId =
    activity.placeId ||
    activity.rootPlaceId ||
    presence?.placeId ||
    presence?.rootPlaceId;

  const gameInstanceId =
    activity.gameInstanceId ||
    activity.jobId ||
    activity.gameId ||
    presence?.gameId;

  const directJoinUrl = placeId && gameInstanceId
    ? `https://www.roblox.com/games/start?placeId=${encodeURIComponent(placeId)}&gameInstanceId=${encodeURIComponent(gameInstanceId)}`
    : "";

  return sanitizeUrl(
    activity.joinUrl ||
      activity.joinGameUrl ||
      activity.gameUrl ||
      activity.placeUrl ||
      activity.game?.joinUrl ||
      activity.game?.url ||
      directJoinUrl ||
      (placeId ? `https://www.roblox.com/games/${encodeURIComponent(placeId)}` : ""),
  );
}

function sanitizeVersion(version) {
  const value = String(version || "").trim();
  return /^\d+(?:\.\d+){0,3}(?:[-+][a-z0-9.-]+)?$/i.test(value) ? value : "";
}

function getReadyRpcSessions() {
  return Array.from(rpcClients.values()).filter((session) => session.ready);
}

function clearPresenceForClient(clientId) {
  const session = rpcClients.get(clientId);

  if (!session?.ready) return Promise.resolve(false);

  return session.rpc.clearActivity()
    .then(() => true)
    .catch(() => false);
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

  if (!presenceEnabled) return;

  const readySessions = getReadyRpcSessions();
  if (!readySessions.length) return;

  const gameName = gameDisplayEnabled ? getGameName(lastActivity) : "";
  const joinGameUrl = gameDisplayEnabled ? getJoinGameUrl(lastActivity) : "";
  const gameImageUrl = gameDisplayEnabled ? getGameImageUrl(lastActivity) : "";

  const buttons = [];

  if (joinGameUrl) {
    buttons.push({
      label: "Join game",
      url: joinGameUrl,
    });
  }

  buttons.push({
    label: "Download now",
    url: "https://zefox.zefoq.dev",
  });

  const presence = {
    details: gameName ? `${gameName} - ZeFoX` : "ZeFoX - Roblox Browser Extension",
    startTimestamp: lastStartedAt,
    largeImageKey: gameImageUrl || "zefox_logo",
    largeImageText: gameName || "ZeFoX",
    smallImageKey: accountDisplayEnabled && lastAccount?.thumbnailUrl ? lastAccount.thumbnailUrl : "roblox_logo",
    smallImageText: accountDisplayEnabled ? getAccountLabel(lastAccount) : "Roblox",
    buttons,
    instance: false,
  };

  if (lastExtensionVersion) {
    presence.state = `Version ${lastExtensionVersion}`;
  }

  readySessions.forEach((session) => {
    session.rpc.setActivity(presence).catch((error) => {
      bridgeEvents.emit("error", `Could not update ${getClientName(session.clientId)} presence. ${error.message || error}`);
    });
  });

  bridgeEvents.emit("log", "Presence updated.");
  refreshDiscordClients().catch(() => {});
}

function clearPresence() {
  const readySessions = getReadyRpcSessions();
  if (!readySessions.length) return;

  readySessions.forEach((session) => {
    session.rpc.clearActivity().catch(() => {});
  });

  bridgeEvents.emit("log", "Presence cleared.");
  refreshDiscordClients().catch(() => {});
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
    startDiscordDetectionLoop();
    refreshDiscordClients().catch(() => {});
  });

  server.on("error", (error) => {
    bridgeRunning = false;
    server = null;
    httpApp = null;
    bridgeEvents.emit("error", `Bridge server error: ${error.message || error}`);
    emitStatus();
  });

  startDiscordDetectionLoop();
}

function stopBridge() {
  presenceEnabled = false;
  clearPresence();
  stopDiscordDetectionLoop();

  for (const session of rpcClients.values()) {
    session.ready = false;

    try {
      session.rpc.destroy().catch(() => {});
    } catch {}
  }

  rpcClients.clear();
  updateRpcReady();

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

function setGameDisplayEnabled(enabled) {
  gameDisplayEnabled = Boolean(enabled);

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
  setGameDisplayEnabled,
  selectDiscordClient,
  refreshDiscordClients,
  getStatus,
  bridgeEvents,
};
