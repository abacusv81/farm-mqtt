const RELAY_COUNT = 16;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const brokerUrlEl = document.getElementById("brokerUrl");
const environmentEl = document.getElementById("environment");
const clientIdEl = document.getElementById("clientId");
const topicCmdEl = document.getElementById("topicCmd");
const topicScheduleEl = document.getElementById("topicSchedule");
const topicStatusEl = document.getElementById("topicStatus");
const topicStatusReqEl = document.getElementById("topicStatusReq");

const TOPIC_BASES = {
  prod: "babu/esp32",
  test: "babu/esp32-test",
};

const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const turnOnBtn = document.getElementById("turnOnBtn");
const turnOffBtn = document.getElementById("turnOffBtn");
const fetchStatusBtn = document.getElementById("fetchStatusBtn");
const setScheduleBtn = document.getElementById("setScheduleBtn");

const connectionStateEl = document.getElementById("connectionState");
const relayGridEl = document.getElementById("relayGrid");
const dayChipsEl = document.getElementById("dayChips");
const selectedRelayLabelEl = document.getElementById("selectedRelayLabel");
const currentRelayStateEl = document.getElementById("currentRelayState");
const currentRelayScheduleEl = document.getElementById("currentRelaySchedule");
const onTimeEl = document.getElementById("onTime");
const offTimeEl = document.getElementById("offTime");
const statusOutputEl = document.getElementById("statusOutput");
const logOutputEl = document.getElementById("logOutput");
const enableNotifBtn = document.getElementById("enableNotifBtn");
const notifStateEl = document.getElementById("notifState");

let client = null;
let selectedRelay = 1;

const relayData = Array.from({ length: RELAY_COUNT }, () => ({
  state: "UNKNOWN",
  scheduleText: "No data",
}));
const MAX_LOG_LINES = 200;
const MAX_LOG_CHARS = 8000;
const logBuffer = [];

const PUSH_SERVER_URL = "https://YOUR_PUSH_SERVER/subscribe";
const PUSH_API_KEY = "";
const VAPID_PUBLIC_KEY = "YOUR_VAPID_PUBLIC_KEY";

function applyEnvironment(env) {
  const base = TOPIC_BASES[env] || TOPIC_BASES.prod;
  topicCmdEl.value = `${base}/cmd`;
  topicScheduleEl.value = `${base}/schedule`;
  topicStatusEl.value = `${base}/status`;
  topicStatusReqEl.value = `${base}/statusreq`;
}

function initUi() {
  clientIdEl.value = `mobile-${Math.random().toString(16).slice(2, 10)}`;

  const savedEnv = localStorage.getItem("relayEnv") || "prod";
  environmentEl.value = savedEnv;
  applyEnvironment(savedEnv);

  environmentEl.addEventListener("change", () => {
    const env = environmentEl.value;
    localStorage.setItem("relayEnv", env);
    applyEnvironment(env);
    log(`Environment switched to ${env.toUpperCase()} (${TOPIC_BASES[env]}). Reconnect to apply.`);
  });

  for (let i = 1; i <= RELAY_COUNT; i += 1) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "relay-btn";
    b.textContent = `R${i}`;
    b.dataset.relay = String(i);
    b.addEventListener("click", () => selectRelay(i));
    relayGridEl.appendChild(b);
  }

  DAYS.forEach((day) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "day-chip";
    b.textContent = day;
    b.dataset.day = day;
    if (["Mon", "Tue", "Wed", "Thu", "Fri"].includes(day)) {
      b.classList.add("active");
    }
    b.addEventListener("click", () => {
      b.classList.toggle("active");
    });
    dayChipsEl.appendChild(b);
  });

  selectRelay(1);
}

function setConnState(text, ok) {
  connectionStateEl.textContent = text;
  connectionStateEl.className = ok ? "state good" : "state bad";
}

function setNotifState(text, ok) {
  if (!notifStateEl) return;
  notifStateEl.textContent = text;
  notifStateEl.className = ok ? "state good" : "state bad";
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function enableNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    setNotifState("Push not supported", false);
    return;
  }
  if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.includes("YOUR_")) {
    setNotifState("Set VAPID public key first", false);
    return;
  }
  if (!PUSH_SERVER_URL || PUSH_SERVER_URL.includes("YOUR_")) {
    setNotifState("Set push server URL first", false);
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    setNotifState("Permission denied", false);
    return;
  }

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const headers = { "Content-Type": "application/json" };
  if (PUSH_API_KEY) headers["x-api-key"] = PUSH_API_KEY;

  const res = await fetch(PUSH_SERVER_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ subscription: sub }),
  });

  if (!res.ok) {
    setNotifState("Server rejected subscription", false);
    return;
  }

  setNotifState("Notifications enabled", true);
  log("Push subscription registered.");
}

async function checkNotificationStatus() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  if (Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) setNotifState("Notifications enabled", true);
}
function log(msg) {
  const ts = new Date().toLocaleTimeString();
  logBuffer.push(`[${ts}] ${msg}`);
  if (logBuffer.length > MAX_LOG_LINES) {
    logBuffer.splice(0, logBuffer.length - MAX_LOG_LINES);
  }
  let joined = logBuffer.join("\n");
  if (joined.length > MAX_LOG_CHARS) {
    joined = joined.slice(joined.length - MAX_LOG_CHARS);
  }
  logOutputEl.textContent = joined;
}

function ensureConnected() {
  if (!client || !client.connected) {
    log("Not connected.");
    return false;
  }
  return true;
}

function publish(topic, payload) {
  if (!ensureConnected()) return;
  client.publish(topic, payload, { qos: 0, retain: false }, (err) => {
    if (err) {
      log(`Publish failed: ${err.message}`);
      return;
    }
    log(`Published ${topic}: ${payload}`);
  });
}

function selectRelay(relayNum) {
  selectedRelay = relayNum;
  selectedRelayLabelEl.textContent = `Relay ${relayNum}`;

  const buttons = relayGridEl.querySelectorAll(".relay-btn");
  buttons.forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.relay) === relayNum);
  });

  updateSelectedRelayView();
}

function selectedDays() {
  const chips = dayChipsEl.querySelectorAll(".day-chip.active");
  return Array.from(chips).map((c) => c.dataset.day);
}

function parseScheduleText(text) {
  const clean = (text || "").trim();
  const m = clean.match(/^([A-Za-z,]+)\s+(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (!m) return null;
  return {
    days: m[1].split(",").map((x) => x.trim()).filter(Boolean),
    onTime: m[2],
    offTime: m[3],
  };
}

function reflectScheduleToControls(scheduleText) {
  const parsed = parseScheduleText(scheduleText);
  const chips = dayChipsEl.querySelectorAll(".day-chip");

  chips.forEach((c) => c.classList.remove("active"));

  if (!parsed) {
    onTimeEl.value = "";
    offTimeEl.value = "";
    return;
  }

  chips.forEach((c) => {
    if (parsed.days.includes(c.dataset.day)) {
      c.classList.add("active");
    }
  });
  onTimeEl.value = parsed.onTime;
  offTimeEl.value = parsed.offTime;
}

function updateSelectedRelayView() {
  const info = relayData[selectedRelay - 1];
  if (!info) return;

  currentRelayStateEl.textContent = info.state;
  currentRelayStateEl.className = "pill unknown";
  if (info.state === "ON") currentRelayStateEl.className = "pill on";
  if (info.state === "OFF") currentRelayStateEl.className = "pill off";

  currentRelayScheduleEl.textContent = info.scheduleText;
  reflectScheduleToControls(info.scheduleText);
}

function parseStatusReport(text) {
  const lines = text.split("\n");
  let count = 0;

  lines.forEach((line) => {
    const m = line.match(/^Relay\s+(\d+)\s+\(Pin\s+\d+\)\s+(ON|OFF)\s+Schedule:\s*(.*)$/i);
    if (!m) return;
    const relayNum = Number(m[1]);
    if (relayNum < 1 || relayNum > RELAY_COUNT) return;

    relayData[relayNum - 1] = {
      state: m[2].toUpperCase(),
      scheduleText: (m[3] || "").trim() || "None",
    };
    count += 1;
  });

  if (count > 0) updateSelectedRelayView();
}

function connectMqtt() {
  if (client && client.connected) {
    log("Already connected.");
    return;
  }

  client = mqtt.connect(brokerUrlEl.value.trim(), {
    clientId: clientIdEl.value.trim() || `mobile-${Math.random().toString(16).slice(2, 10)}`,
    clean: true,
    keepalive: 30,
    reconnectPeriod: 2500,
    connectTimeout: 10000,
    resubscribe: true,
  });

  setConnState("Connecting...", false);

  client.on("connect", () => {
    setConnState("Connected", true);
    connectBtn.disabled = true;
    disconnectBtn.disabled = false;

    client.subscribe(topicStatusEl.value.trim(), (err) => {
      if (err) {
        log(`Subscribe error: ${err.message}`);
        return;
      }
      log(`Subscribed ${topicStatusEl.value.trim()}`);
      fetchStatus();
    });
  });

  client.on("message", (topic, payload) => {
    const msg = payload.toString();
    log(`Incoming ${topic}`);
    if (topic === topicStatusEl.value.trim()) {
      statusOutputEl.textContent = msg;
      parseStatusReport(msg);
    }
  });

  client.on("reconnect", () => setConnState("Reconnecting...", false));
  client.on("offline", () => setConnState("Offline", false));
  client.on("error", (err) => {
    setConnState("Error/Disconnected", false);
    log(`MQTT error: ${err.message}`);
  });
  client.on("close", () => {
    setConnState("Disconnected", false);
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
  });
}

function disconnectMqtt() {
  if (!client) return;
  client.end(true);
}

function turnRelay(on) {
  publish(topicCmdEl.value.trim(), `${selectedRelay} ${on ? "on" : "off"}`);
  setTimeout(fetchStatus, 500);
}

function saveSchedule() {
  const days = selectedDays();
  if (days.length === 0) {
    log("Pick at least one day.");
    return;
  }

  if (!onTimeEl.value || !offTimeEl.value) {
    log("ON/OFF times are required.");
    return;
  }

  const payload = `${selectedRelay} ${days.join(",")} ${onTimeEl.value}-${offTimeEl.value}`;
  publish(topicScheduleEl.value.trim(), payload);
  setTimeout(fetchStatus, 500);
}

function fetchStatus() {
  publish(topicStatusReqEl.value.trim(), "get");
}

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("service-worker.js").catch(() => {});
}

connectBtn.addEventListener("click", connectMqtt);
disconnectBtn.addEventListener("click", disconnectMqtt);
turnOnBtn.addEventListener("click", () => turnRelay(true));
turnOffBtn.addEventListener("click", () => turnRelay(false));
fetchStatusBtn.addEventListener("click", fetchStatus);
setScheduleBtn.addEventListener("click", saveSchedule);
if (enableNotifBtn) enableNotifBtn.addEventListener("click", enableNotifications);

initUi();
checkNotificationStatus().catch(() => {});

window.addEventListener("online", () => {
  log("Network online");
  if (client && !client.connected) {
    client.reconnect();
  }
});

window.addEventListener("offline", () => {
  log("Network offline");
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    log("App visible");
    if (client && !client.connected) {
      client.reconnect();
    }
  }
});
