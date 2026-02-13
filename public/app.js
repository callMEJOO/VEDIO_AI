let busy = false;
let processId = null;

const fileInput = document.getElementById("file");
const btn = document.getElementById("btn");
const loader = document.getElementById("loader");
const loaderText = document.getElementById("loaderText");
const statusEl = document.getElementById("status");

btn.onclick = start;

/* RESET UI */
function resetUI() {
  processId = null;
  statusEl.innerText = "";
  loader.classList.add("hidden");
  document.getElementById("actions").classList.add("hidden");

  ["beforeImg","afterImg","beforeVid","afterVid"].forEach(id=>{
    document.getElementById(id).classList.add("hidden");
  });
}

/* START */
async function start() {
  if (busy) return;
  const file = fileInput.files[0];
  if (!file) return;

  resetUI();
  busy = true;

  const isImage = file.type.startsWith("image");

  document.getElementById("preview").classList.remove("hidden");
  loader.classList.remove("hidden");
  loaderText.innerText = "Uploading…";

  if (isImage) showBeforeImage(file);
  else showBeforeVideo(file);

  const fd = new FormData();
  fd.append("file", file);

  try {
    const url = isImage ? "/enhance/image" : "/enhance/video";
    const r = await fetch(url, { method: "POST", body: fd });

    if (isImage) {
      const blob = await r.blob();
      const out = URL.createObjectURL(blob);

      document.getElementById("afterImg").src = out;
      document.getElementById("afterImg").classList.remove("hidden");

      setupDownload(out, "enhanced-image.png");
      loader.classList.add("hidden");
      statusEl.innerText = "✅ Completed";
      busy = false;
      return;
    }

    const j = await r.json();
    processId = j.processId;
    poll();

  } catch {
    loader.classList.add("hidden");
    statusEl.innerText = "❌ Failed";
    busy = false;
  }
}

/* POLL STATUS */
async function poll() {
  loaderText.innerText = "Enhancing (Ultra Quality)…";

  const r = await fetch(`/status/${processId}`);
  const j = await r.json();

  if (j.status === "initializing") {
    statusEl.innerText = "⏳ In queue…";
    setTimeout(poll, 5000);
    return;
  }

  if (j.status === "processing") {
    statusEl.innerText = `⚙️ Enhancing… ${Math.round(j.progress || 0)}%`;
    setTimeout(poll, 3000);
    return;
  }

  if (j.status === "complete" || j.status === "completed") {
    const url = j.download.url;
    document.getElementById("afterVid").src = url;
    document.getElementById("afterVid").classList.remove("hidden");

    setupDownload(url, "enhanced-video.mp4");
    loader.classList.add("hidden");
    statusEl.innerText = "✅ Completed";
    busy = false;
    return;
  }

  loader.classList.add("hidden");
  statusEl.innerText = "❌ Failed";
  busy = false;
}

/* HELPERS */
function setupDownload(url, name) {
  const btn = document.getElementById("downloadBtn");
  btn.href = url;
  btn.download = name;
  document.getElementById("actions").classList.remove("hidden");
}

function showBeforeImage(file) {
  const img = document.getElementById("beforeImg");
  img.src = URL.createObjectURL(file);
  img.classList.remove("hidden");
}

function showBeforeVideo(file) {
  const vid = document.getElementById("beforeVid");
  vid.src = URL.createObjectURL(file);
  vid.classList.remove("hidden");
}
