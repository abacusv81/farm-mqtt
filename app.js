const RELAY_COUNT = 16;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const brokerUrlEl = document.getElementById("brokerUrl");
const environmentEl = document.getElementById("environment");
const clientIdEl = document.getElementById("clientId");
const topicCmdEl = document.getElementById("topicCmd");
const topicScheduleEl = document.getElementById("topicSchedule");
const topicStatusEl = document.getElementById("topicStatus");
const topicStatusReqEl = document.getElementById("topicStatusReq");
const topicTimerEl = document.getElementById("topicTimer");
const topicCyclicEl = document.getElementById("topicCyclic");

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
const currentRelayModeEl = document.getElementById("currentRelayMode");
const currentRelayScheduleEl = document.getElementById("currentRelaySchedule");
const currentRelayTimerRow = document.getElementById("currentRelayTimerRow");
const currentRelayTimerEl = document.getElementById("currentRelayTimer");
const onTimeEl = document.getElementById("onTime");
const offTimeEl = document.getElementById("offTime");
const statusOutputEl = document.getElementById("statusOutput");
const logOutputEl = document.getElementById("logOutput");
const enableNotifBtn = document.getElementById("enableNotifBtn");
const notifStateEl = document.getElementById("notifState");

const timerMinEl = document.getElementById("timerMin");
const timerSecEl = document.getElementById("timerSec");
const startTimerBtn = document.getElementById("startTimerBtn");
const cancelTimerBtn = document.getElementById("cancelTimerBtn");

const cyclicDayChipsEl = document.getElementById("cyclicDayChips");
const cyclicStartEl = document.getElementById("cyclicStart");
const cyclicAddRelayEl = document.getElementById("cyclicAddRelay");
const cyclicAddMinEl = document.getElementById("cyclicAddMin");
const cyclicAddSecEl = document.getElementById("cyclicAddSec");
const cyclicAddBtn = document.getElementById("cyclicAddBtn");
const cyclicSeqListEl = document.getElementById("cyclicSeqList");
const cyclicSaveBtn = document.getElementById("cyclicSaveBtn");
const cyclicClearSeqBtn = document.getElementById("cyclicClearSeqBtn");
const cyclicEnableBtn = document.getElementById("cyclicEnableBtn");
const cyclicDisableBtn = document.getElementById("cyclicDisableBtn");
const cyclicClearBtn = document.getElementById("cyclicClearBtn");
const cyclicDeviceStateEl = document.getElementById("cyclicDeviceState");
const cyclicDeviceSummaryEl = document.getElementById("cyclicDeviceSummary");

let client = null;
let selectedRelay = 1;

const relayData = Array.from({ length: RELAY_COUNT }, () => ({
  state: "UNKNOWN",
  mode: "SCHED",
  scheduleText: "No data",
  timerText: "",
}));

// Editor-local cyclic sequence: [{ relay, minutes, seconds }]
const cyclicSeq = [];
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
  topicTimerEl.value = `${base}/timer`;
  topicCyclicEl.value = `${base}/cyclic`;
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

  // Cyclic day chips (independent from schedule chips)
  DAYS.forEach((day) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "day-chip";
    b.textContent = day;
    b.dataset.day = day;
    b.addEventListener("click", () => b.classList.toggle("active"));
    cyclicDayChipsEl.appendChild(b);
  });

  // Cyclic relay dropdown
  for (let i = 1; i <= RELAY_COUNT; i += 1) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `R${i}`;
    cyclicAddRelayEl.appendChild(opt);
  }

  renderCyclicSeq();
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

function modePillClass(mode) {
  switch ((mode || "").toUpperCase()) {
    case "MANUAL": return "pill mode-manual";
    case "TIMER":  return "pill mode-timer";
    case "CYCLIC": return "pill mode-cyclic";
    default:       return "pill mode-sched";
  }
}

function updateSelectedRelayView() {
  const info = relayData[selectedRelay - 1];
  if (!info) return;

  currentRelayStateEl.textContent = info.state;
  currentRelayStateEl.className = "pill unknown";
  if (info.state === "ON") currentRelayStateEl.className = "pill on";
  if (info.state === "OFF") currentRelayStateEl.className = "pill off";

  currentRelayModeEl.textContent = info.mode || "SCHED";
  currentRelayModeEl.className = modePillClass(info.mode);

  currentRelayScheduleEl.textContent = info.scheduleText;
  reflectScheduleToControls(info.scheduleText);

  if (info.timerText) {
    currentRelayTimerRow.classList.remove("hidden");
    currentRelayTimerEl.textContent = info.timerText;
  } else {
    currentRelayTimerRow.classList.add("hidden");
  }
}

function parseStatusReport(text) {
  const lines = text.split("\n");
  let count = 0;
  let inCyclic = false;
  const cyclicLines = [];

  lines.forEach((line) => {
    if (/^----\s*Cyclic\s*----/i.test(line)) {
      inCyclic = true;
      return;
    }
    if (inCyclic) {
      cyclicLines.push(line);
      return;
    }

    // New format:  Relay N (Pin P) ON  [MODE] Schedule: ...   OR
    //              Relay N (Pin P) ON  [TIMER] Timer: 5m30s (rem 2m10s)
    const m = line.match(
      /^Relay\s+(\d+)\s+\(Pin\s+-?\d+\)\s+(ON|OFF)\s+\[([A-Z]+)\]\s+(.*)$/i
    );
    if (m) {
      const relayNum = Number(m[1]);
      if (relayNum < 1 || relayNum > RELAY_COUNT) return;
      const rest = (m[4] || "").trim();

      let scheduleText = "None";
      let timerText = "";
      const tm = rest.match(/^Timer:\s*(.*)$/i);
      const sm = rest.match(/^Schedule:\s*(.*)$/i);
      if (tm) {
        timerText = (tm[1] || "").trim();
      } else if (sm) {
        scheduleText = (sm[1] || "").trim() || "None";
      }

      relayData[relayNum - 1] = {
        state: m[2].toUpperCase(),
        mode: m[3].toUpperCase(),
        scheduleText,
        timerText,
      };
      count += 1;
      return;
    }

    // Legacy format fallback
    const legacy = line.match(
      /^Relay\s+(\d+)\s+\(Pin\s+-?\d+\)\s+(ON|OFF)\s+Schedule:\s*(.*)$/i
    );
    if (legacy) {
      const relayNum = Number(legacy[1]);
      if (relayNum < 1 || relayNum > RELAY_COUNT) return;
      relayData[relayNum - 1] = {
        state: legacy[2].toUpperCase(),
        mode: "SCHED",
        scheduleText: (legacy[3] || "").trim() || "None",
        timerText: "",
      };
      count += 1;
    }
  });

  if (cyclicLines.length > 0) parseCyclicBlock(cyclicLines);
  if (count > 0) updateSelectedRelayView();
}

function parseCyclicBlock(lines) {
  // Line forms expected:
  //   "Enabled  Days: MonWedFri  Start: 06:00"  OR  "Disabled" (+ optional second line)
  //   "  Seq: R1(5m30s) -> R3(10m0s) -> R5(7m15s)"
  //   "  Running: step 2/3 R3 rem 5m12s"
  //   "  (not configured)"
  const joined = lines.join("\n");
  const enabled = /^Enabled\b/m.test(joined);
  const running = /Running:\s*step\s+(\d+)\/(\d+)\s+R(\d+)\s+rem\s+(.*)/i.exec(joined);
  const notConfigured = /\(not configured\)/i.test(joined);

  let label = enabled ? "ENABLED" : "DISABLED";
  if (running) label = `RUNNING ${running[1]}/${running[2]}`;

  cyclicDeviceStateEl.textContent = label;
  cyclicDeviceStateEl.className =
    running ? "pill on" : (enabled ? "pill mode-cyclic" : "pill off");

  if (notConfigured) {
    cyclicDeviceSummaryEl.textContent = "Not configured on device.";
    return;
  }

  // Compact single-line summary
  const summaryLines = lines
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  cyclicDeviceSummaryEl.textContent = summaryLines.join(" | ");
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

// ---------- Timer ----------
function startTimer() {
  const m = Number(timerMinEl.value);
  const s = Number(timerSecEl.value);
  if (!Number.isFinite(m) || !Number.isFinite(s) || m < 0 || s < 0 || s > 59) {
    log("Timer values out of range (sec 0-59).");
    return;
  }
  if (m === 0 && s === 0) {
    log("Timer must be > 0.");
    return;
  }
  publish(topicTimerEl.value.trim(), `${selectedRelay} ${m} ${s}`);
  setTimeout(fetchStatus, 500);
}

function cancelTimer() {
  publish(topicTimerEl.value.trim(), `${selectedRelay} off`);
  setTimeout(fetchStatus, 500);
}

// ---------- Cyclic ----------
function selectedCyclicDays() {
  const chips = cyclicDayChipsEl.querySelectorAll(".day-chip.active");
  return Array.from(chips).map((c) => c.dataset.day);
}

function renderCyclicSeq() {
  cyclicSeqListEl.innerHTML = "";
  cyclicSeq.forEach((step, idx) => {
    const li = document.createElement("li");
    li.className = "seq-item";

    const info = document.createElement("span");
    info.className = "seq-info";
    info.textContent = `R${step.relay} — ${step.minutes}m ${step.seconds}s`;

    const actions = document.createElement("span");
    actions.className = "seq-actions";

    const up = document.createElement("button");
    up.type = "button";
    up.className = "ghost seq-btn";
    up.textContent = "↑";
    up.disabled = idx === 0;
    up.addEventListener("click", () => moveCyclicStep(idx, -1));

    const down = document.createElement("button");
    down.type = "button";
    down.className = "ghost seq-btn";
    down.textContent = "↓";
    down.disabled = idx === cyclicSeq.length - 1;
    down.addEventListener("click", () => moveCyclicStep(idx, +1));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "secondary seq-btn";
    del.textContent = "×";
    del.addEventListener("click", () => {
      cyclicSeq.splice(idx, 1);
      renderCyclicSeq();
    });

    actions.appendChild(up);
    actions.appendChild(down);
    actions.appendChild(del);

    li.appendChild(info);
    li.appendChild(actions);
    cyclicSeqListEl.appendChild(li);
  });
}

function moveCyclicStep(idx, delta) {
  const j = idx + delta;
  if (j < 0 || j >= cyclicSeq.length) return;
  const tmp = cyclicSeq[idx];
  cyclicSeq[idx] = cyclicSeq[j];
  cyclicSeq[j] = tmp;
  renderCyclicSeq();
}

function addCyclicStep() {
  const r = Number(cyclicAddRelayEl.value);
  const m = Number(cyclicAddMinEl.value);
  const s = Number(cyclicAddSecEl.value);
  if (!Number.isFinite(r) || r < 1 || r > RELAY_COUNT) {
    log("Pick a valid relay.");
    return;
  }
  if (!Number.isFinite(m) || !Number.isFinite(s) || m < 0 || s < 0 || s > 59) {
    log("Cyclic step duration out of range (sec 0-59).");
    return;
  }
  if (m === 0 && s === 0) {
    log("Cyclic step duration must be > 0.");
    return;
  }
  cyclicSeq.push({ relay: r, minutes: m, seconds: s });
  renderCyclicSeq();
}

function saveCyclic() {
  const days = selectedCyclicDays();
  if (days.length === 0) {
    log("Cyclic: pick at least one day.");
    return;
  }
  if (!cyclicStartEl.value) {
    log("Cyclic: start time required.");
    return;
  }
  if (cyclicSeq.length === 0) {
    log("Cyclic: add at least one step.");
    return;
  }
  const list = cyclicSeq
    .map((st) => `${st.relay}:${st.minutes}:${st.seconds}`)
    .join(",");
  const payload = `set ${days.join("")} ${cyclicStartEl.value} ${list}`;
  publish(topicCyclicEl.value.trim(), payload);
  setTimeout(fetchStatus, 500);
}

function enableCyclic()  { publish(topicCyclicEl.value.trim(), "enable");  setTimeout(fetchStatus, 500); }
function disableCyclic() { publish(topicCyclicEl.value.trim(), "disable"); setTimeout(fetchStatus, 500); }
function clearCyclicDevice() {
  if (!confirm("Clear cyclic configuration on the device?")) return;
  publish(topicCyclicEl.value.trim(), "clear");
  setTimeout(fetchStatus, 500);
}
function clearCyclicEditor() {
  cyclicSeq.length = 0;
  renderCyclicSeq();
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

startTimerBtn.addEventListener("click", startTimer);
cancelTimerBtn.addEventListener("click", cancelTimer);

cyclicAddBtn.addEventListener("click", addCyclicStep);
cyclicClearSeqBtn.addEventListener("click", clearCyclicEditor);
cyclicSaveBtn.addEventListener("click", saveCyclic);
cyclicEnableBtn.addEventListener("click", enableCyclic);
cyclicDisableBtn.addEventListener("click", disableCyclic);
cyclicClearBtn.addEventListener("click", clearCyclicDevice);

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
