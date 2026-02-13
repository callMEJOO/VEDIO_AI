let busy = false;
let processId = null;

const fileInput = document.getElementById("file");
const btn = document.getElementById("btn");
const loader = document.getElementById("loader");
const loaderText = document.getElementById("loaderText");
const statusEl = document.getElementById("status");

btn.onclick = start;

/* RESET */
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
  const fps = document.getElementById("fps").value;

  document.getElementById("preview").classList.remove("hidden");
  loader.classList.remove("hidden");
  loaderText.innerText = "Uploading…";

  if (isImage) showBeforeImage(file);
  else showBeforeVideo(file);

  const fd = new FormData();
  fd.append("file", file);
  fd.append("fps", fps);

  const url = isImage ? "/enhance/image" : "/enhance/video";
  const r = await fetch(url,{method:"POST",body:fd});

  if (isImage) {
    const blob = await r.blob();
    const out = URL.createObjectURL(blob);
    document.getElementById("afterImg").src = out;
    document.getElementById("afterImg").classList.remove("hidden");
    setupDownload(out,"enhanced-image.png");
    loader.classList.add("hidden");
    statusEl.innerText = "✅ Completed";
    busy = false;
    return;
  }

  const j = await r.json();
  processId = j.processId;
  poll();
}

/* POLL */
async function poll() {
  const r = await fetch(`/status/${processId}`);
  const j = await r.json();

  if (j.status === "initializing") {
    const t = j.estimates?.time?.[0] || 300;
    statusEl.innerText = `⏳ In queue… ~${Math.ceil(t/60)} min`;
    setTimeout(poll,5000); return;
  }

  if (j.status === "processing") {
    statusEl.innerText = `⚙️ Enhancing… ${Math.round(j.progress||0)}%`;
    setTimeout(poll,3000); return;
  }

  if (j.status === "postprocessing") {
    statusEl.innerText = "🎞️ Finalizing output…";
    setTimeout(poll,4000); return;
  }

  if (j.status === "complete" || j.status === "completed") {
    document.getElementById("afterVid").src = `/video/download/${processId}`;
    document.getElementById("afterVid").classList.remove("hidden");
    setupDownload(null,"enhanced-ultra.mp4");
    loader.classList.add("hidden");
    statusEl.innerText = "✅ Completed";
    busy = false;
    return;
  }

  setTimeout(poll,5000);
}

/* HELPERS */
function setupDownload(_, name) {
  const btn = document.getElementById("downloadBtn");
  btn.href = `/video/download/${processId}`;
  btn.download = name;
  document.getElementById("actions").classList.remove("hidden");
}

function showBeforeImage(file){
  const img=document.getElementById("beforeImg");
  img.src=URL.createObjectURL(file);
  img.classList.remove("hidden");
}

function showBeforeVideo(file){
  const vid=document.getElementById("beforeVid");
  vid.src=URL.createObjectURL(file);
  vid.classList.remove("hidden");
}
