// DropBeam — app.js (FULL FIXED VERSION WITH STABLE QR SCANNER)

const CHUNK_SIZE = 64 * 1024;

let peer = null;
let conn = null;
let myPeerId = null;

let pendingFiles = [];
let currentFile = null;
let sendOffset = 0;
let isPaused = false;
let isCancelled = false;
let transferStartTime = 0;

let incomingMeta = null;
let incomingChunks = [];
let incomingReceived = 0;

let transferHistory = [];
let lastReceivedText = "";
let activeTransferEl = null;

let deviceName = localStorage.getItem("dropbeam-name") || guessDeviceName();
let scanInterval = null;
let videoStream = null;

// ================= START =================
document.addEventListener("DOMContentLoaded", () => {
  localStorage.setItem("dropbeam-name", deviceName);
  document.getElementById("device-name-display").textContent = deviceName;
  updateDeviceEmoji();
  initPeer();
  initBackground();

  document.getElementById("file-input").addEventListener("change", (e) => {
    addFilesToQueue([...e.target.files]);
  });

  const params = new URLSearchParams(location.search);
  const roomFromUrl = params.get("room");
  if (roomFromUrl) {
    history.replaceState({}, "", location.pathname);
    setTimeout(() => joinRoom(roomFromUrl), 1000);
  }
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

  peer.on("open", (id) => {
    myPeerId = id;
    console.log("Peer ID:", id);
  });

  peer.on("connection", (connection) => {
    conn = connection;
    setupConnection(conn);
  });

  peer.on("error", (err) => {
    console.error("Peer error:", err);
    showToast("Connection error.");
  });
}

function setupConnection(connection) {
  connection.on("open", () => {
    stopCamera();
    showScreen("transfer");
    connection.send(JSON.stringify({ type: "hello", name: deviceName }));
    showToast("Connected!");
  });

  connection.on("data", handleData);

  connection.on("close", () => {
    showToast("Peer disconnected.");
    goHome();
  });
}

// ================= QR GENERATE =================
function generateQR(peerId) {
  const container = document.getElementById("qr-container");
  container.innerHTML = "";

  const url = `${location.origin}${location.pathname}?room=${peerId}`;

  new QRCode(container, {
    text: url,
    width: 260,
    height: 260,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });

  console.log("QR URL:", url);
}

// ================= QR SCANNER FIXED =================
async function startScan() {
  stopCamera();

  const video = document.getElementById("scanner-video");
  const canvas = document.getElementById("scanner-canvas");
  const ctx = canvas.getContext("2d");

  try {
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" }
    });

    video.srcObject = videoStream;
    video.setAttribute("playsinline", true);
    await video.play();

    scanInterval = setInterval(() => {
      if (video.readyState !== video.HAVE_ENOUGH_DATA) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      ctx.drawImage(video, 0, 0);

      const imageData = ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

      const code = jsQR(
        imageData.data,
        imageData.width,
        imageData.height
      );

      if (code && code.data) {
        const match = code.data.match(/room=([A-Za-z0-9_-]+)/);
        if (match) {
          clearInterval(scanInterval);
          stopCamera();
          showToast("QR Scanned!");
          joinRoom(match[1]);
        }
      }
    }, 120);

  } catch (err) {
    console.error(err);
    showToast("Camera failed. Use Enter ID.");
    switchJoinTab("code");
  }
}

function stopCamera() {
  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
    videoStream = null;
  }
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
}

// ================= NAVIGATION =================
function showScreen(name) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-" + name).classList.add("active");
}

function goHome() {
  stopCamera();
  showScreen("home");
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
  setTimeout(startScan, 500);
}

// ================= JOIN =================
function joinRoom(peerId) {
  if (!peer) return;

  conn = peer.connect(peerId);
  setupConnection(conn);
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

// ================= UTIL =================
function guessDeviceName() {
  if (/Android/i.test(navigator.userAgent)) return "Android Device";
  if (/iPhone/i.test(navigator.userAgent)) return "iPhone";
  if (/Windows/i.test(navigator.userAgent)) return "Windows PC";
  if (/Mac/i.test(navigator.userAgent)) return "MacBook";
  return "My Device";
}

function updateDeviceEmoji() {
  const isMobile = /Android|iPhone/i.test(navigator.userAgent);
  document.getElementById("device-emoji").textContent = isMobile ? "📱" : "💻";
}