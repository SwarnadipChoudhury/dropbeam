// DropBeam — Production Ready v2.0

const CHUNK_SIZE = 256 * 1024; // 256KB chunks for better throughput
const MAX_BUFFERED_AMOUNT = 4 * 1024 * 1024; // 4MB buffer threshold

let peer = null;
let conn = null;
let myPeerId = null;
let pendingFiles = [];
let currentFileIndex = 0;
let sendOffset = 0;
let incomingMeta = null;
let incomingChunks = [];
let incomingReceived = 0;
let transferStartTime = 0;
let scanInterval = null;
let videoStream = null;
let transferHistory = [];
let deviceName = localStorage.getItem("deviceName") || "My Device";
let deviceEmoji = localStorage.getItem("deviceEmoji") || "💻";
let isSending = false;
let isReceiving = false;
let receivedClipboardText = "";
let peerDeviceName = "Connected Peer";
let peerDeviceEmoji = "💻";
let reconnectAttempts = 0;
const MAX_RECONNECT = 3;
let sendQueue = [];
let isSendingQueue = false;

document.addEventListener("DOMContentLoaded", () => {
  applyTheme();
  updateDeviceDisplay();
  setupDropZone();
  setupFileInput();
  handleUrlRoom();
  initPeer();
});

// ================= PEER =================
function initPeer() {
  if (peer && !peer.destroyed) {
    peer.destroy();
  }

  peer = new Peer(undefined, {
    host: "0.peerjs.com",
    port: 443,
    secure: true,
    debug: 0,
    config: {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:global.stun.twilio.com:3478" },
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject"
        },
        {
          urls: "turn:openrelay.metered.ca:443",
          username: "openrelayproject",
          credential: "openrelayproject"
        },
        {
          urls: "turn:openrelay.metered.ca:443?transport=tcp",
          username: "openrelayproject",
          credential: "openrelayproject"
        }
      ]
    }
  });

  peer.on("open", id => {
    myPeerId = id;
    reconnectAttempts = 0;
    console.log("Peer ID:", id);
    // If we're on the send screen, update the display
    const display = document.getElementById("room-code-display");
    if (display && display.textContent === "Connecting...") {
      goToSend();
    }
  });

  peer.on("connection", incoming => {
    // Only accept if not already connected
    if (conn && conn.open) {
      incoming.on("open", () => {
        incoming.send(JSON.stringify({ type: "busy" }));
        incoming.close();
      });
      return;
    }
    conn = incoming;
    setupConnection();
  });

  peer.on("error", err => {
    console.error("Peer error:", err.type, err);
    if (err.type === "unavailable-id" || err.type === "server-error" || err.type === "network") {
      if (reconnectAttempts < MAX_RECONNECT) {
        reconnectAttempts++;
        setTimeout(initPeer, 2000 * reconnectAttempts);
        showToast("Connection lost, reconnecting...");
      } else {
        showToast("Network error. Please refresh.");
      }
    } else if (err.type === "peer-unavailable") {
      showToast("Peer not found. Check Room ID.");
      goHome();
    } else {
      showToast("Error: " + (err.type || "unknown"));
    }
  });

  peer.on("disconnected", () => {
    if (!peer.destroyed && reconnectAttempts < MAX_RECONNECT) {
      peer.reconnect();
    }
  });
}

function setupConnection() {
  conn.on("open", () => {
    // Exchange device info
    conn.send(JSON.stringify({
      type: "device-info",
      name: deviceName,
      emoji: deviceEmoji
    }));
    showScreen("transfer");
    showToast("✅ Connected!");
    resetTransferState();
  });

  conn.on("data", data => {
    try {
      if (data instanceof ArrayBuffer) {
        handleChunk(data);
        return;
      }
      // Handle both string and object data
      const msg = typeof data === "string" ? JSON.parse(data) : data;
      handleMessage(msg);
    } catch (e) {
      console.error("Data parse error:", e);
    }
  });

  conn.on("close", () => {
    showToast("Peer disconnected.");
    handleDisconnect();
  });

  conn.on("error", err => {
    console.error("Connection error:", err);
    showToast("Connection error.");
    handleDisconnect();
  });
}

function handleMessage(msg) {
  switch (msg.type) {
    case "device-info":
      peerDeviceName = msg.name || "Connected Peer";
      peerDeviceEmoji = msg.emoji || "💻";
      document.getElementById("peer-name-display").textContent = peerDeviceName;
      document.getElementById("peer-avatar").textContent = peerDeviceEmoji;
      break;

    case "file-meta":
      if (isReceiving) {
        // Already receiving, queue it
        showToast("Already receiving a file...");
        return;
      }
      incomingMeta = msg;
      incomingChunks = [];
      incomingReceived = 0;
      isReceiving = true;
      showFileRequest(msg);
      break;

    case "file-accept":
      startSending();
      break;

    case "file-reject":
      showToast("❌ Receiver rejected the file.");
      isSending = false;
      processNextInQueue();
      break;

    case "file-done":
      finishReceive();
      break;

    case "file-cancel":
      isReceiving = false;
      incomingChunks = [];
      incomingMeta = null;
      showToast("Sender cancelled the transfer.");
      hideFileRequest();
      break;

    case "clipboard":
      receivedClipboardText = msg.text || "";
      document.getElementById("received-clipboard").textContent = receivedClipboardText || "(empty)";
      document.getElementById("copy-received-btn").classList.remove("hidden");
      showToast("📋 Text received!");
      break;

    case "busy":
      showToast("Peer is busy with another connection.");
      break;

    case "progress-ack":
      // Flow control acknowledgement
      break;
  }
}

function handleDisconnect() {
  const wasOnTransfer = document.getElementById("screen-transfer").classList.contains("active");
  conn = null;
  isSending = false;
  isReceiving = false;
  sendQueue = [];
  isSendingQueue = false;
  if (wasOnTransfer) {
    setTimeout(() => {
      goHome();
    }, 1500);
  }
}

function resetTransferState() {
  pendingFiles = [];
  currentFileIndex = 0;
  sendOffset = 0;
  isSending = false;
  isReceiving = false;
  sendQueue = [];
  isSendingQueue = false;
  document.getElementById("file-queue").innerHTML = "";
  document.getElementById("active-transfers").innerHTML = "";
  document.getElementById("send-btn").classList.add("hidden");
  document.getElementById("file-input").value = "";
}

// ================= URL ROOM HANDLING =================
function handleUrlRoom() {
  const params = new URLSearchParams(location.search);
  const room = params.get("room");
  if (room) {
    // Clean URL
    history.replaceState({}, "", location.pathname);
    // Wait for peer to be ready then join
    const tryJoin = () => {
      if (myPeerId) {
        joinRoom(room);
      } else {
        setTimeout(tryJoin, 300);
      }
    };
    tryJoin();
  }
}

// ================= NAVIGATION =================
function showScreen(name) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const screen = document.getElementById("screen-" + name);
  if (screen) screen.classList.add("active");
}

function goToSend() {
  if (!myPeerId) {
    showToast("Still connecting, please wait...");
    // Wait for peer
    const wait = () => {
      if (myPeerId) {
        showScreen("send");
        document.getElementById("room-code-display").textContent = myPeerId;
        generateQR(myPeerId);
      } else {
        setTimeout(wait, 300);
      }
    };
    wait();
    return;
  }
  showScreen("send");
  document.getElementById("room-code-display").textContent = myPeerId;
  generateQR(myPeerId);
}

function goToReceive() {
  showScreen("receive");
  switchJoinTab("scan");
  setTimeout(startScan, 400);
}

function goHome() {
  stopCamera();
  showScreen("home");
}

function copyRoomCode() {
  const code = document.getElementById("room-code-display").textContent;
  if (!code || code === "Connecting...") return;
  navigator.clipboard.writeText(code).then(() => showToast("📋 Room ID copied!")).catch(() => {
    // Fallback
    const el = document.createElement("textarea");
    el.value = code;
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
    showToast("📋 Room ID copied!");
  });
}

// ================= FILE SEND =================
function setupDropZone() {
  const dz = document.getElementById("drop-zone");
  if (!dz) return;

  dz.addEventListener("dragover", e => {
    e.preventDefault();
    dz.classList.add("drag-over");
  });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag-over"));
  dz.addEventListener("drop", e => {
    e.preventDefault();
    dz.classList.remove("drag-over");
    const files = Array.from(e.dataTransfer.files);
    if (files.length) addFilesToQueue(files);
  });
}

function setupFileInput() {
  const fi = document.getElementById("file-input");
  if (!fi) return;
  fi.addEventListener("change", () => {
    const files = Array.from(fi.files);
    if (files.length) addFilesToQueue(files);
  });
}

function addFilesToQueue(files) {
  files.forEach(file => {
    sendQueue.push(file);
    renderFileInQueue(file, sendQueue.length - 1);
  });
  document.getElementById("send-btn").classList.remove("hidden");
}

function renderFileInQueue(file, idx) {
  const container = document.getElementById("file-queue");
  const item = document.createElement("div");
  item.className = "file-item";
  item.id = "file-item-" + idx;
  item.innerHTML = `
    <div class="file-icon">${getFileIcon(file.name)}</div>
    <div class="file-info">
      <div class="file-name">${escapeHtml(file.name)}</div>
      <div class="file-size">${formatSize(file.size)}</div>
      <div class="progress-wrap hidden" id="prog-wrap-${idx}">
        <div class="progress-fill" id="prog-fill-${idx}" style="width:0%"></div>
      </div>
      <div class="progress-stats hidden" id="prog-stats-${idx}">
        <span id="prog-pct-${idx}">0%</span>
        <span id="prog-speed-${idx}">-</span>
      </div>
    </div>
    <button class="btn btn-ghost small-btn" onclick="removeFromQueue(${idx})" id="remove-btn-${idx}">✕</button>
  `;
  container.appendChild(item);
}

function removeFromQueue(idx) {
  sendQueue[idx] = null;
  const item = document.getElementById("file-item-" + idx);
  if (item) item.remove();
  if (sendQueue.every(f => f === null)) {
    document.getElementById("send-btn").classList.add("hidden");
  }
}

function sendFiles() {
  if (!conn || !conn.open) {
    showToast("Not connected.");
    return;
  }
  if (isSendingQueue) return;

  const filesToSend = sendQueue.filter(f => f !== null);
  if (!filesToSend.length) return;

  isSendingQueue = true;
  document.getElementById("send-btn").classList.add("hidden");
  sendNextFile(filesToSend, 0);
}

function sendNextFile(files, idx) {
  if (idx >= files.length) {
    isSendingQueue = false;
    showToast("✅ All files sent!");
    return;
  }

  const file = files[idx];
  if (!file) {
    sendNextFile(files, idx + 1);
    return;
  }

  currentFileIndex = idx;
  isSending = true;

  conn.send(JSON.stringify({
    type: "file-meta",
    name: file.name,
    size: file.size,
    mime: file.type || "application/octet-stream",
    index: idx,
    total: files.length
  }));

  // Store reference for startSending
  window._currentSendFile = file;
  window._sendFilesDoneCallback = () => sendNextFile(files, idx + 1);
}

function startSending() {
  const file = window._currentSendFile;
  if (!file) return;
  sendOffset = 0;
  transferStartTime = Date.now();
  sendChunk(file);
}

function sendChunk(file) {
  if (!conn || !conn.open) {
    showToast("Connection lost during send.");
    isSending = false;
    isSendingQueue = false;
    return;
  }

  if (sendOffset >= file.size) {
    conn.send(JSON.stringify({ type: "file-done" }));
    isSending = false;
    updateSendProgress(file, file.size);
    if (window._sendFilesDoneCallback) window._sendFilesDoneCallback();
    return;
  }

  // Flow control - check buffer
  const dc = conn.dataChannel;
  if (dc && dc.bufferedAmount > MAX_BUFFERED_AMOUNT) {
    setTimeout(() => sendChunk(file), 50);
    return;
  }

  const slice = file.slice(sendOffset, sendOffset + CHUNK_SIZE);
  const reader = new FileReader();

  reader.onload = e => {
    if (!conn || !conn.open) return;
    try {
      conn.send(e.target.result);
      sendOffset += e.target.result.byteLength;
      updateSendProgress(file, sendOffset);
      // Use requestAnimationFrame for smoother sending
      if (sendOffset < file.size) {
        if (dc && dc.bufferedAmount > MAX_BUFFERED_AMOUNT) {
          const onDrain = () => {
            if (dc.bufferedAmount <= MAX_BUFFERED_AMOUNT / 2) {
              dc.removeEventListener("bufferedamountlow", onDrain);
              sendChunk(file);
            }
          };
          dc.bufferedAmountLowThreshold = MAX_BUFFERED_AMOUNT / 2;
          dc.addEventListener("bufferedamountlow", onDrain);
        } else {
          setTimeout(() => sendChunk(file), 0);
        }
      } else {
        sendChunk(file); // will hit the >= file.size branch
      }
    } catch (e) {
      console.error("Send error:", e);
      setTimeout(() => sendChunk(file), 100);
    }
  };

  reader.onerror = () => {
    showToast("Error reading file.");
    isSending = false;
    isSendingQueue = false;
  };

  reader.readAsArrayBuffer(slice);
}

function updateSendProgress(file, offset) {
  // Find the queue index
  const idx = currentFileIndex;
  const pct = Math.round((offset / file.size) * 100);
  const elapsed = (Date.now() - transferStartTime) / 1000;
  const speed = elapsed > 0 ? offset / elapsed : 0;

  const wrap = document.getElementById("prog-wrap-" + idx);
  const fill = document.getElementById("prog-fill-" + idx);
  const stats = document.getElementById("prog-stats-" + idx);
  const pctEl = document.getElementById("prog-pct-" + idx);
  const speedEl = document.getElementById("prog-speed-" + idx);

  if (wrap) wrap.classList.remove("hidden");
  if (stats) stats.classList.remove("hidden");
  if (fill) fill.style.width = pct + "%";
  if (pctEl) pctEl.textContent = pct + "%";
  if (speedEl) speedEl.textContent = formatSpeed(speed);

  const removeBtn = document.getElementById("remove-btn-" + idx);
  if (removeBtn) removeBtn.classList.add("hidden");
}

// ================= RECEIVE =================
function showFileRequest(meta) {
  const modal = document.getElementById("file-request-modal");
  const desc = document.getElementById("file-request-desc");
  const totalInfo = meta.total > 1 ? ` (${meta.index + 1} of ${meta.total})` : "";
  desc.textContent = `"${meta.name}"${totalInfo} — ${formatSize(meta.size)}`;
  modal.classList.remove("hidden");
}

function hideFileRequest() {
  document.getElementById("file-request-modal").classList.add("hidden");
}

function acceptFile() {
  hideFileRequest();
  incomingChunks = [];
  incomingReceived = 0;
  transferStartTime = Date.now();
  showReceiveProgress();
  conn.send(JSON.stringify({ type: "file-accept" }));
}

function rejectFile() {
  hideFileRequest();
  isReceiving = false;
  incomingMeta = null;
  conn.send(JSON.stringify({ type: "file-reject" }));
}

function showReceiveProgress() {
  const container = document.getElementById("active-transfers");
  container.innerHTML = `
    <div class="file-item" id="recv-progress-item">
      <div class="file-icon">${getFileIcon(incomingMeta.name)}</div>
      <div class="file-info">
        <div class="file-name">${escapeHtml(incomingMeta.name)}</div>
        <div class="file-size">${formatSize(incomingMeta.size)}</div>
        <div class="progress-wrap">
          <div class="progress-fill" id="recv-prog-fill" style="width:0%"></div>
        </div>
        <div class="progress-stats">
          <span id="recv-prog-pct">0%</span>
          <span id="recv-prog-speed">-</span>
        </div>
      </div>
    </div>
  `;
  // Switch to files tab
  switchTransferTab("files");
}

function handleChunk(chunk) {
  if (!isReceiving || !incomingMeta) return;
  incomingChunks.push(chunk);
  incomingReceived += chunk.byteLength;

  const pct = Math.round((incomingReceived / incomingMeta.size) * 100);
  const elapsed = (Date.now() - transferStartTime) / 1000;
  const speed = elapsed > 0 ? incomingReceived / elapsed : 0;

  const fill = document.getElementById("recv-prog-fill");
  const pctEl = document.getElementById("recv-prog-pct");
  const speedEl = document.getElementById("recv-prog-speed");

  if (fill) fill.style.width = pct + "%";
  if (pctEl) pctEl.textContent = pct + "%";
  if (speedEl) speedEl.textContent = formatSpeed(speed);
}

function finishReceive() {
  if (!incomingMeta) return;
  const blob = new Blob(incomingChunks, { type: incomingMeta.mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);

  // Add to history
  addToHistory({
    name: incomingMeta.name,
    size: incomingMeta.size,
    direction: "received",
    url,
    mime: incomingMeta.mime
  });

  // Download
  const a = document.createElement("a");
  a.href = url;
  a.download = incomingMeta.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // If image, offer preview
  if (incomingMeta.mime && incomingMeta.mime.startsWith("image/")) {
    showImagePreview(url);
  }

  showToast(`✅ "${incomingMeta.name}" received!`);

  // Clean up active transfer UI
  const item = document.getElementById("recv-progress-item");
  if (item) {
    item.style.opacity = "0.5";
    setTimeout(() => item.remove(), 2000);
  }

  incomingChunks = [];
  incomingReceived = 0;
  incomingMeta = null;
  isReceiving = false;
}

// ================= CLIPBOARD =================
function sendClipboard() {
  if (!conn || !conn.open) {
    showToast("Not connected.");
    return;
  }
  const text = document.getElementById("clipboard-text").value.trim();
  if (!text) {
    showToast("Nothing to send.");
    return;
  }
  conn.send(JSON.stringify({ type: "clipboard", text }));
  showToast("📋 Text sent!");
}

function copyReceivedText() {
  if (!receivedClipboardText) return;
  navigator.clipboard.writeText(receivedClipboardText).then(() => {
    showToast("Copied!");
  }).catch(() => {
    const el = document.createElement("textarea");
    el.value = receivedClipboardText;
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
    showToast("Copied!");
  });
}

// ================= HISTORY =================
function addToHistory(item) {
  transferHistory.unshift(item);
  renderHistory();
}

function renderHistory() {
  const container = document.getElementById("transfer-history");
  if (!transferHistory.length) {
    container.innerHTML = '<p class="hint">No transfers yet.</p>';
    return;
  }
  container.innerHTML = transferHistory.map((item, i) => `
    <div class="history-item">
      <div style="font-size:1.5rem">${getFileIcon(item.name)}</div>
      <div style="flex:1;min-width:0">
        <div class="file-name">${escapeHtml(item.name)}</div>
        <div class="file-size">${item.direction === "received" ? "⬇️" : "⬆️"} ${formatSize(item.size)}</div>
      </div>
      ${item.url ? `<a class="btn btn-ghost small-btn" href="${item.url}" download="${escapeHtml(item.name)}">💾</a>` : ""}
    </div>
  `).join("");
}

// ================= QR =================
function generateQR(peerId) {
  const container = document.getElementById("qr-container");
  container.innerHTML = "";
  const url = `${location.origin}${location.pathname}?room=${peerId}`;
  try {
    new QRCode(container, {
      text: url,
      width: 220,
      height: 220,
      correctLevel: QRCode.CorrectLevel.M
    });
  } catch (e) {
    container.textContent = url;
  }
}

async function startScan() {
  stopCamera();

  const video = document.getElementById("scanner-video");
  const canvas = document.getElementById("scanner-canvas");

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast("Camera not supported. Use manual ID.");
    switchJoinTab("code");
    return;
  }

  try {
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
    });
  } catch (e) {
    // Try without constraints
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch (e2) {
      showToast("Camera access denied. Use manual ID.");
      switchJoinTab("code");
      return;
    }
  }

  video.srcObject = videoStream;
  video.setAttribute("playsinline", true);

  try {
    await video.play();
  } catch (e) {
    console.error("Video play failed:", e);
  }

  const ctx = canvas.getContext("2d");

  function scan() {
    if (!videoStream) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "dontInvert"
      });
      if (code && code.data) {
        const match = code.data.match(/room=([A-Za-z0-9_-]+)/);
        if (match) {
          stopCamera();
          joinRoom(match[1]);
          return;
        }
      }
    }
    scanInterval = requestAnimationFrame(scan);
  }

  scanInterval = requestAnimationFrame(scan);
}

function stopCamera() {
  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
    videoStream = null;
  }
  if (scanInterval) {
    cancelAnimationFrame(scanInterval);
    scanInterval = null;
  }
}

// ================= IMAGE PREVIEW =================
function showImagePreview(url) {
  const modal = document.getElementById("img-preview-modal");
  const img = document.getElementById("preview-img");
  img.src = url;
  modal.classList.remove("hidden");
}

function closeImagePreview() {
  document.getElementById("img-preview-modal").classList.add("hidden");
  document.getElementById("preview-img").src = "";
}

// ================= JOIN =================
function joinRoom(id) {
  if (!id || !id.trim()) return;
  const trimmedId = id.trim();

  if (!peer || peer.destroyed) {
    showToast("Reconnecting...");
    initPeer();
    setTimeout(() => joinRoom(trimmedId), 1500);
    return;
  }

  showToast("Connecting...");
  try {
    conn = peer.connect(trimmedId, {
      reliable: true,
      serialization: "binary"
    });
    setupConnection();
  } catch (e) {
    showToast("Failed to connect. Try again.");
  }
}

function joinByCode() {
  const input = document.getElementById("peer-id-input");
  const id = input.value.trim();
  if (!id) {
    showToast("Please enter a Room ID.");
    return;
  }
  joinRoom(id);
}

function disconnect() {
  if (conn) {
    conn.close();
    conn = null;
  }
  handleDisconnect();
  goHome();
  showToast("Disconnected.");
}

// ================= TABS =================
function switchJoinTab(tab) {
  document.getElementById("tab-scan").classList.toggle("active", tab === "scan");
  document.getElementById("tab-code").classList.toggle("active", tab === "code");
  document.getElementById("join-scan").classList.toggle("hidden", tab !== "scan");
  document.getElementById("join-code").classList.toggle("hidden", tab !== "code");

  if (tab !== "scan") stopCamera();
  if (tab === "scan") setTimeout(startScan, 200);
}

function switchTransferTab(tab) {
  ["files", "clip", "hist"].forEach(t => {
    document.getElementById("ttab-" + t).classList.toggle("active", t === tab);
    document.getElementById("tcontent-" + t).classList.toggle("hidden", t !== tab);
  });
  if (tab === "hist") renderHistory();
}

// ================= DEVICE NAMING =================
function updateDeviceDisplay() {
  document.getElementById("device-name-display").textContent = deviceName;
  document.getElementById("device-emoji").textContent = deviceEmoji;
}

function renameDevice() {
  const emojis = ["💻", "📱", "🖥️", "⌚", "📺", "🎮", "🖨️", "📡"];
  const name = prompt("Device name:", deviceName);
  if (name === null) return;
  deviceName = name.trim() || "My Device";
  deviceEmoji = emojis[Math.floor(Math.random() * emojis.length)];
  localStorage.setItem("deviceName", deviceName);
  localStorage.setItem("deviceEmoji", deviceEmoji);
  updateDeviceDisplay();
  if (conn && conn.open) {
    conn.send(JSON.stringify({ type: "device-info", name: deviceName, emoji: deviceEmoji }));
  }
}

// ================= THEME =================
function applyTheme() {
  const saved = localStorage.getItem("theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  document.querySelector(".theme-btn").textContent = saved === "dark" ? "🌙" : "☀️";
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
  document.querySelector(".theme-btn").textContent = next === "dark" ? "🌙" : "☀️";
}

// ================= TOAST =================
function showToast(msg) {
  const tc = document.getElementById("toast-container");
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  tc.appendChild(t);
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transform = "translateY(6px)";
    setTimeout(() => t.remove(), 300);
  }, 2700);
}

// ================= BACKGROUND CANVAS =================
(function initBgCanvas() {
  const canvas = document.getElementById("bg-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let w, h, particles;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }

  function initParticles() {
    particles = Array.from({ length: 40 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 2 + 0.5,
      dx: (Math.random() - 0.5) * 0.4,
      dy: (Math.random() - 0.5) * 0.4,
      opacity: Math.random() * 0.5 + 0.1
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    const isDark = document.documentElement.getAttribute("data-theme") !== "light";
    particles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = isDark
        ? `rgba(108,99,255,${p.opacity})`
        : `rgba(108,99,255,${p.opacity * 0.5})`;
      ctx.fill();
      p.x += p.dx;
      p.y += p.dy;
      if (p.x < 0 || p.x > w) p.dx *= -1;
      if (p.y < 0 || p.y > h) p.dy *= -1;
    });

    // Draw lines between close particles
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = isDark
            ? `rgba(108,99,255,${0.15 * (1 - dist / 120)})`
            : `rgba(108,99,255,${0.08 * (1 - dist / 120)})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }

    requestAnimationFrame(draw);
  }

  resize();
  initParticles();
  draw();
  window.addEventListener("resize", () => { resize(); initParticles(); });
})();

// ================= UTILITIES =================
function formatSize(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatSpeed(bytesPerSec) {
  if (bytesPerSec < 1024) return bytesPerSec.toFixed(0) + " B/s";
  if (bytesPerSec < 1024 * 1024) return (bytesPerSec / 1024).toFixed(1) + " KB/s";
  return (bytesPerSec / (1024 * 1024)).toFixed(1) + " MB/s";
}

function getFileIcon(filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  const icons = {
    pdf: "📄", doc: "📝", docx: "📝", txt: "📃", xls: "📊", xlsx: "📊",
    ppt: "📑", pptx: "📑", zip: "🗜️", rar: "🗜️", "7z": "🗜️",
    jpg: "🖼️", jpeg: "🖼️", png: "🖼️", gif: "🎞️", webp: "🖼️", svg: "🖼️",
    mp4: "🎬", mov: "🎬", avi: "🎬", mkv: "🎬", webm: "🎬",
    mp3: "🎵", wav: "🎵", flac: "🎵", aac: "🎵", ogg: "🎵",
    exe: "⚙️", dmg: "💿", apk: "📦", js: "📜", html: "🌐",
    css: "🎨", json: "📋", py: "🐍", java: "☕", cpp: "💻",
    psd: "🎨", ai: "🎨", fig: "🎨"
  };
  return icons[ext] || "📁";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}