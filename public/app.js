let busy = false;
let processId = null;

const fileInput = document.getElementById("file");
const btn = document.getElementById("btn");
const loader = document.getElementById("loader");
const loaderText = document.getElementById("loaderText");
const statusEl = document.getElementById("status");
const downloadBtn = document.getElementById("downloadBtn");

btn.onclick = start;
downloadBtn.onclick = downloadVideo;

function resetUI() {
  processId = null;
  statusEl.innerText = "";
  loader.classList.add("hidden");
  document.getElementById("actions").classList.add("hidden");
}

/* START */
async function start() {
  if (busy) return;
  const file = fileInput.files[0];
  if (!file) return;

  resetUI();
  busy = true;

  const preset = document.getElementById("preset").value;
  const isImage = file.type.startsWith("image");

  loader.classList.remove("hidden");
  loaderText.innerText = "Uploading…";

  const fd = new FormData();
  fd.append("file", file);
  fd.append("preset", preset);

  const r = await fetch(
    isImage ? "/enhance/image" : "/enhance/video",
    { method:"POST", body: fd }
  );

  if (isImage) {
    loader.classList.add("hidden");
    statusEl.innerText = "✅ Image enhanced";
    busy = false;
    return;
  }

  const j = await r.json();

  if (!j.processId) {
    statusEl.innerText = "❌ Failed to start enhancement";
    busy = false;
    return;
  }

  processId = j.processId;
  poll();
}

/* POLL */
async function poll() {
  const r = await fetch(`/status/${processId}`);
  const j = await r.json();

  if (j.status === "complete" || j.status === "completed") {
    loader.classList.add("hidden");
    statusEl.innerText = "✅ Completed";
    document.getElementById("actions").classList.remove("hidden");
    busy = false;
    return;
  }

  statusEl.innerText = `⚙️ ${j.status}...`;
  setTimeout(poll, 4000);
}

/* DOWNLOAD */
async function downloadVideo() {
  const r = await fetch(`/video/download/${processId}`);
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "enhanced-video.mp4";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
