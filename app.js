// DropBeam — FINAL STABLE VERSION (GitHub Pages Safe)

const CHUNK_SIZE = 64 * 1024;

let peer, conn, myPeerId;
let pendingFiles = [];
let currentFile = null;
let sendOffset = 0;
let incomingMeta = null;
let incomingChunks = [];
let incomingReceived = 0;
let transferStartTime = 0;
let scanInterval = null;
let videoStream = null;

document.addEventListener("DOMContentLoaded", () => {
  initPeer();
});


// ================= PEER =================
function initPeer() {
  peer = new Peer({
    host: "0.peerjs.com",
    port: 443,
    secure: true,
    config: {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    }
  });

  peer.on("open", id => {
    myPeerId = id;
    console.log("My Peer ID:", id);
  });

  peer.on("connection", connection => {
    conn = connection;
    setupConnection();
  });
}

function setupConnection() {
  conn.on("open", () => {
    showScreen("transfer");
    showToast("Connected!");
  });

  conn.on("data", data => {
    if (data instanceof ArrayBuffer) {
      handleChunk(data);
      return;
    }

    const msg = JSON.parse(data);

    if (msg.type === "file-meta") {
      incomingMeta = msg;
      conn.send(JSON.stringify({ type: "file-accept" }));
      incomingChunks = [];
      incomingReceived = 0;
    }

    if (msg.type === "file-accept") {
      startSending();
    }

    if (msg.type === "file-done") {
      finishReceive();
    }
  });
}


// ================= NAVIGATION =================
function showScreen(name) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-" + name).classList.add("active");
}

function goToSend() {
  if (!myPeerId) {
    showToast("Connecting...");
    return;
  }
  showScreen("send");
  document.getElementById("room-code-display").textContent = myPeerId;
  generateQR(myPeerId);
}

function goToReceive() {
  showScreen("receive");
  setTimeout(startScan, 400);
}

function goHome() {
  showScreen("home");
}


// ================= FILE SEND =================
function sendFiles() {
  if (!conn || !conn.open) {
    showToast("Not connected.");
    return;
  }

  const files = document.getElementById("file-input").files;
  if (!files.length) return;

  currentFile = files[0];

  conn.send(JSON.stringify({
    type: "file-meta",
    name: currentFile.name,
    size: currentFile.size,
    mime: currentFile.type
  }));
}

function startSending() {
  sendOffset = 0;
  transferStartTime = Date.now();
  sendChunk();
}

function sendChunk() {
  if (sendOffset >= currentFile.size) {
    conn.send(JSON.stringify({ type: "file-done" }));
    showToast("File Sent!");
    return;
  }

  if (conn.dataChannel.bufferedAmount > CHUNK_SIZE * 8) {
    setTimeout(sendChunk, 50);
    return;
  }

  const slice = currentFile.slice(sendOffset, sendOffset + CHUNK_SIZE);
  const reader = new FileReader();

  reader.onload = e => {
    conn.send(e.target.result);
    sendOffset += e.target.result.byteLength;
    setTimeout(sendChunk, 0);
  };

  reader.readAsArrayBuffer(slice);
}


// ================= RECEIVE =================
function handleChunk(chunk) {
  incomingChunks.push(chunk);
  incomingReceived += chunk.byteLength;
}

function finishReceive() {
  const blob = new Blob(incomingChunks, { type: incomingMeta.mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = incomingMeta.name;
  a.click();
  showToast("File Received!");
}


// ================= QR =================
function generateQR(peerId) {
  const container = document.getElementById("qr-container");
  container.innerHTML = "";

  // FIXED for GitHub Pages path
  const url = `${location.origin}${location.pathname}?room=${peerId}`;

  new QRCode(container, {
    text: url,
    width: 250,
    height: 250
  });
}

async function startScan() {
  stopCamera();

  const video = document.getElementById("scanner-video");
  const canvas = document.getElementById("scanner-canvas");
  const ctx = canvas.getContext("2d");

  videoStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" }
  });

  video.srcObject = videoStream;
  await video.play();

  scanInterval = setInterval(() => {
    if (video.readyState !== video.HAVE_ENOUGH_DATA) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.drawImage(video, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const code = jsQR(imageData.data, imageData.width, imageData.height);

    if (code && code.data) {
      const match = code.data.match(/room=([A-Za-z0-9_-]+)/);
      if (match) {
        clearInterval(scanInterval);
        stopCamera();
        joinRoom(match[1]);
      }
    }
  }, 120);
}

function stopCamera() {
  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
    videoStream = null;
  }
  if (scanInterval) clearInterval(scanInterval);
}


// ================= JOIN =================
function joinRoom(id) {
  conn = peer.connect(id);
  setupConnection();
}


// ================= TOAST =================
function showToast(msg) {
  const tc = document.getElementById("toast-container");
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  tc.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}