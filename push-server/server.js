const fs = require("fs");
const path = require("path");
const express = require("express");
const mqtt = require("mqtt");
const webpush = require("web-push");
require("dotenv").config();

const app = express();
app.use(express.json({ limit: "200kb" }));

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.API_KEY || "";
const SUBS_FILE = process.env.SUBS_FILE || path.join(__dirname, "subscriptions.json");
const APP_URL = process.env.APP_URL || "";

const MQTT_URL = process.env.MQTT_URL || "wss://broker.hivemq.com:8884/mqtt";
const MQTT_TOPIC_STATUS = process.env.MQTT_TOPIC_STATUS || "babu/esp32/status";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.warn("Missing VAPID keys. Push will not work until set.");
}

webpush.setVapidDetails("mailto:admin@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function loadSubscriptions() {
  try {
    const raw = fs.readFileSync(SUBS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function saveSubscriptions(subs) {
  fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2));
}

function isValidSubscription(sub) {
  return sub && typeof sub.endpoint === "string" && sub.keys && sub.keys.p256dh && sub.keys.auth;
}

function authOk(req) {
  if (!API_KEY) return true;
  return req.headers["x-api-key"] === API_KEY;
}

app.post("/subscribe", (req, res) => {
  if (!authOk(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const subscription = req.body && req.body.subscription;
  if (!isValidSubscription(subscription)) {
    return res.status(400).json({ ok: false, error: "invalid subscription" });
  }

  const subs = loadSubscriptions();
  const exists = subs.some((s) => s.endpoint === subscription.endpoint);
  if (!exists) subs.push(subscription);
  saveSubscriptions(subs);

  res.json({ ok: true });
});

app.post("/unsubscribe", (req, res) => {
  if (!authOk(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const subscription = req.body && req.body.subscription;
  if (!isValidSubscription(subscription)) {
    return res.status(400).json({ ok: false, error: "invalid subscription" });
  }
  const subs = loadSubscriptions().filter((s) => s.endpoint !== subscription.endpoint);
  saveSubscriptions(subs);
  res.json({ ok: true });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

const mqttClient = mqtt.connect(MQTT_URL);
const relayStates = Array.from({ length: 16 }, () => "UNKNOWN");

function parseStatusReport(text) {
  const lines = text.split("\n");
  const updates = [];

  lines.forEach((line) => {
    const m = line.match(/^Relay\s+(\d+)\s+\(Pin\s+\d+\)\s+(ON|OFF)\s+Schedule:\s*(.*)$/i);
    if (!m) return;
    const relayNum = Number(m[1]);
    if (relayNum < 1 || relayNum > 16) return;
    updates.push({ relay: relayNum, state: m[2].toUpperCase() });
  });

  return updates;
}

async function sendNotification(changes) {
  if (!changes.length) return;
  const subs = loadSubscriptions();
  if (!subs.length) return;

  const body = changes.map((c) => `Relay ${c.relay}: ${c.state}`).join("; ");
  const payload = JSON.stringify({
    title: "Relay state changed",
    body,
    url: APP_URL || "./",
  });

  const stillValid = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload);
      stillValid.push(sub);
    } catch (err) {
      if (err.statusCode !== 404 && err.statusCode !== 410) {
        stillValid.push(sub);
      }
    }
  }
  saveSubscriptions(stillValid);
}

mqttClient.on("connect", () => {
  console.log("MQTT connected");
  mqttClient.subscribe(MQTT_TOPIC_STATUS);
});

mqttClient.on("message", (topic, payload) => {
  if (topic !== MQTT_TOPIC_STATUS) return;
  const text = payload.toString();
  const updates = parseStatusReport(text);
  const changes = [];

  updates.forEach((u) => {
    const idx = u.relay - 1;
    if (relayStates[idx] !== u.state) {
      relayStates[idx] = u.state;
      changes.push(u);
    }
  });

  if (changes.length) {
    sendNotification(changes).catch(() => {});
  }
});

app.listen(PORT, () => {
  console.log(`Push server listening on ${PORT}`);
});
