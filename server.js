const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const { WebSocketServer } = require("ws");

const port = process.env.PORT || 3000;

const rootDir = __dirname;
const publicDir = path.join(rootDir, "public");
const uploadDir = path.join(rootDir, "uploads");
const stateFile = path.join(rootDir, "state.json");

fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });

function createDefaultState() {
  return {
    players: [],
    rooms: [
      { id: "plaza", name: "Public Plaza", subtitle: "A shared square for discovery and events.", mapX: 20, mapY: 50 },
      { id: "myroom", name: "My Room", subtitle: "Your private room to decorate and personalize.", mapX: 65, mapY: 50 },
      { id: "park", name: "Snow Park", subtitle: "A playful zone for missions and snowball fun.", mapX: 50, mapY: 20 }
    ],
    decorations: { plaza: [], myroom: [], park: [] },
    assets: [],
    feed: [],
    chats: { plaza: [], myroom: [], park: [] },
    storyScripts: [],
    qrCodes: [
      { code: "sun-001", rewardName: "Solar Cape", points: 15 },
      { code: "moon-002", rewardName: "Moon Pendant", points: 12 }
    ]
  };
}

function readState() {
  if (!fs.existsSync(stateFile)) {
    const initial = createDefaultState();
    fs.writeFileSync(stateFile, JSON.stringify(initial, null, 2));
    return initial;
  }

  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    const fresh = createDefaultState();
    fs.writeFileSync(stateFile, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

let state = readState();

function saveState() {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function addFeed(text) {
  state.feed.unshift({ id: crypto.randomUUID(), text, ts: new Date().toISOString() });
  state.feed = state.feed.slice(0, 30);
}

function findPlayer(playerId) {
  return state.players.find((p) => p.id === playerId);
}

function createPlayer(name) {
  return {
    id: crypto.randomUUID(),
    name: name.trim() || "Guest",
    roomId: "plaza",
    x: 50,
    y: 68,
    points: 40,
    bio: "New to the world.",
    avatarColor: ["#7dd8ff", "#ffb24f", "#84f28d"][Math.floor(Math.random() * 3)],
    inventory: [
      { id: crypto.randomUUID(), name: "Starter Cape", kind: "wearable", unlocked: true },
      { id: crypto.randomUUID(), name: "Seed Charm", kind: "trinket", unlocked: true }
    ],
    portfolio: [{ id: crypto.randomUUID(), title: "First Story", note: "A calm beginning." }],
    profileFeed: [{ id: crypto.randomUUID(), text: "Hello, world.", ts: new Date().toISOString() }],
    friends: [],
    missions: [
      { id: "visit-plaza", title: "Visit the Public Plaza", reward: 10, done: false },
      { id: "dance", title: "Dance in the room", reward: 8, done: false },
      { id: "emote", title: "Send a friendly emote", reward: 7, done: false },
      { id: "snowball", title: "Throw a snowball", reward: 10, done: false },
      { id: "decorate", title: "Decorate your room", reward: 12, done: false },
      { id: "points", title: "Reach 60 points", reward: 15, done: false }
    ]
  };
}

function completeMission(player, missionId) {
  const mission = player.missions.find((m) => m.id === missionId);
  if (!mission || mission.done) return;
  mission.done = true;
  player.points += mission.reward;
  addFeed(`${player.name} completed ${mission.title}.`);
}

function serializeState() {
  return {
    players: state.players,
    rooms: state.rooms,
    decorations: state.decorations,
    assets: state.assets,
    feed: state.feed,
    chats: state.chats,
    storyScripts: state.storyScripts,
    qrCodes: state.qrCodes
  };
}

function broadcastState() {
  const payload = JSON.stringify({ type: "state", state: serializeState() });
  for (const client of clients) {
    client.send(payload);
  }
}

const app = express();
app.use(express.json());
app.use(express.static(publicDir));
app.use("/uploads", express.static(uploadDir));

app.get("/api/state", (_req, res) => {
  res.json({ state: serializeState() });
});

app.post("/api/join", (req, res) => {
  const name = String(req.body.name || "").trim();
  const existingId = String(req.body.playerId || "").trim();
  let player = existingId ? findPlayer(existingId) : null;

  if (!player) {
    player = createPlayer(name);
    state.players.push(player);
    addFeed(`${player.name} joined the world.`);
  } else if (name) {
    player.name = name;
  }

  saveState();
  broadcastState();
  res.json({ player });
});

app.post("/api/room-change", (req, res) => {
  const player = findPlayer(req.body.playerId);
  if (!player) return res.status(404).json({ error: "player not found" });

  player.roomId = String(req.body.roomId || player.roomId);
  addFeed(`${player.name} entered ${player.roomId}.`);
  saveState();
  broadcastState();
  res.json({ player });
});

app.post("/api/move", (req, res) => {
  const player = findPlayer(req.body.playerId);
  if (!player) return res.status(404).json({ error: "player not found" });

  player.x = Number(req.body.x || player.x);
  player.y = Number(req.body.y || player.y);
  saveState();
  broadcastState();
  res.json({ player });
});

app.post("/api/action", (req, res) => {
  const player = findPlayer(req.body.playerId);
  if (!player) return res.status(404).json({ error: "player not found" });

  const roomId = String(req.body.roomId || player.roomId);
  player.roomId = roomId;

  const action = String(req.body.action || "").toLowerCase();
  let text = "An event happened.";
  let points = 0;

  if (action === "dance") {
    text = `${player.name} dances with the room.`;
    points = 2;
    completeMission(player, "dance");
  } else if (action === "emote") {
    text = `${player.name} waves warmly.`;
    points = 1;
    completeMission(player, "emote");
  } else if (action === "point") {
    text = `${player.name} points toward the horizon.`;
    points = 1;
  } else if (action === "snowball") {
    text = `${player.name} throws a snowball.`;
    points = 2;
    completeMission(player, "snowball");
  } else if (action === "chat") {
    const chatText = String(req.body.text || "").trim();
    if (!chatText) return res.status(400).json({ error: "text required" });

    state.chats[roomId] = state.chats[roomId] || [];
    state.chats[roomId].push({ id: crypto.randomUUID(), author: player.name, text: chatText, ts: new Date().toISOString() });
    state.chats[roomId] = state.chats[roomId].slice(-8);
    text = `${player.name}: ${chatText}`;
    points = 1;
  }

  if (points) player.points += points;
  if (player.points >= 60) completeMission(player, "points");

  addFeed(text);
  saveState();
  broadcastState();
  res.json({ player, text });
});

app.post("/api/decoration", (req, res) => {
  const player = findPlayer(req.body.playerId);
  if (!player) return res.status(404).json({ error: "player not found" });

  const roomId = String(req.body.roomId || "myroom");
  const assetId = String(req.body.assetId || "");
  const x = Number(req.body.x || 50);
  const y = Number(req.body.y || 60);
  const decorId = req.body.decorId || null;

  state.decorations[roomId] = state.decorations[roomId] || [];

  if (decorId) {
    const existing = state.decorations[roomId].find((d) => d.id === decorId);
    if (existing) {
      existing.x = x;
      existing.y = y;
    }
  } else if (assetId) {
    state.decorations[roomId].push({
      id: crypto.randomUUID(),
      assetId,
      x,
      y,
      ownerId: player.id
    });
    completeMission(player, "decorate");
  }

  player.points += 3;
  addFeed(`${player.name} updated decorations.`);
  saveState();
  broadcastState();
  res.json({ player });
});

app.post("/api/profile", (req, res) => {
  const player = findPlayer(req.body.playerId);
  if (!player) return res.status(404).json({ error: "player not found" });

  if (req.body.bio !== undefined) player.bio = String(req.body.bio || "").trim();
  if (req.body.name !== undefined) player.name = String(req.body.name || "").trim();

  addFeed(`${player.name} updated their profile.`);
  saveState();
  broadcastState();
  res.json({ player });
});

app.post("/api/portfolio", (req, res) => {
  const player = findPlayer(req.body.playerId);
  if (!player) return res.status(404).json({ error: "player not found" });

  const title = String(req.body.title || "").trim();
  const note = String(req.body.note || "").trim();
  if (!title) return res.status(400).json({ error: "title required" });

  player.portfolio.unshift({ id: crypto.randomUUID(), title, note });
  player.portfolio = player.portfolio.slice(0, 8);
  addFeed(`${player.name} added a portfolio entry.`);
  saveState();
  broadcastState();
  res.json({ player });
});

app.post("/api/profile-feed", (req, res) => {
  const player = findPlayer(req.body.playerId);
  if (!player) return res.status(404).json({ error: "player not found" });

  const text = String(req.body.text || "").trim();
  if (!text) return res.status(400).json({ error: "text required" });

  player.profileFeed.unshift({ id: crypto.randomUUID(), text, ts: new Date().toISOString() });
  player.profileFeed = player.profileFeed.slice(0, 8);
  addFeed(`${player.name} posted to their profile feed.`);
  saveState();
  broadcastState();
  res.json({ player });
});

app.post("/api/friend", (req, res) => {
  const player = findPlayer(req.body.playerId);
  const target = findPlayer(req.body.targetId);
  if (!player || !target) return res.status(404).json({ error: "player not found" });

  if (!player.friends.includes(target.id)) {
    player.friends.push(target.id);
    addFeed(`${player.name} added ${target.name} as a friend.`);
    saveState();
    broadcastState();
  }

  res.json({ player });
});

app.post("/api/storyscript", (req, res) => {
  const player = findPlayer(req.body.playerId);
  if (!player) return res.status(404).json({ error: "player not found" });

  const title = String(req.body.title || "").trim();
  const text = String(req.body.text || "").trim();
  if (!title || !text) return res.status(400).json({ error: "title and text required" });

  state.storyScripts.unshift({ id: crypto.randomUUID(), title, text, author: player.name, roomId: req.body.roomId || player.roomId });
  state.storyScripts = state.storyScripts.slice(0, 8);
  addFeed(`${player.name} added a story script.`);
  saveState();
  broadcastState();
  res.json({ storyScripts: state.storyScripts });
});

app.post("/api/qr-unlock", (req, res) => {
  const player = findPlayer(req.body.playerId);
  if (!player) return res.status(404).json({ error: "player not found" });

  const code = String(req.body.code || "").trim();
  const match = state.qrCodes.find((entry) => entry.code === code);
  if (!match) return res.status(404).json({ error: "unknown code" });

  const exists = player.inventory.some((item) => item.name === match.rewardName);
  if (!exists) {
    player.inventory.unshift({
      id: crypto.randomUUID(),
      name: match.rewardName,
      kind: "wearable",
      unlocked: true
    });
  }

  player.points += match.points;
  addFeed(`${player.name} unlocked ${match.rewardName} via QR.`);
  saveState();
  broadcastState();
  res.json({ player });
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "file required" });

    const kind = String(req.body.kind || "decor");
    const roomId = String(req.body.roomId || "myroom");
    const ownerId = String(req.body.ownerId || "");

    const ext = path.extname(req.file.originalname || ".bin");
    const safeName = path.basename(req.file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "-");
    const finalPath = path.join(uploadDir, `${safeName}-${Date.now()}${ext}`);
    fs.renameSync(req.file.path, finalPath);

    const asset = {
      id: crypto.randomUUID(),
      name: safeName,
      kind,
      roomId,
      ownerId,
      url: `/uploads/${path.basename(finalPath)}`,
      createdAt: new Date().toISOString()
    };

    state.assets.push(asset);
    addFeed(`New asset uploaded: ${asset.name}.`);
    saveState();
    broadcastState();
    res.json({ asset });
  } catch {
    res.status(500).json({ error: "upload failed" });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const httpServer = http.createServer(app);

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
const clients = new Set();

wss.on("connection", (socket) => {
  clients.add(socket);
  socket.send(JSON.stringify({ type: "state", state: serializeState() }));

  socket.on("message", (buffer) => {
    try {
      const message = JSON.parse(buffer.toString());
      if (message.type === "ping") {
        socket.send(JSON.stringify({ type: "pong" }));
      }
    } catch {}
  });

  socket.on("close", () => clients.delete(socket));
});

httpServer.listen(port, () => {
  console.log(`server ready on http://localhost:${port}`);
});
