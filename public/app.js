const TEXT = {
  en: {
    before: "Before",
    after: "After",
    uploading: "Uploading...",
    queued: m => `⏳ In queue... Estimated ~${m} min`,
    processing: p => `⚙️ Enhancing... ${p}%`,
    done: "✅ Completed",
    failed: "❌ Failed"
  },
  ar: {
    before: "قبل",
    after: "بعد",
    uploading: "جاري الرفع...",
    queued: m => `⏳ في الانتظار... حوالي ${m} دقيقة`,
    processing: p => `⚙️ جاري التحسين... ${p}%`,
    done: "✅ تم بنجاح",
    failed: "❌ فشل"
  }
};

const lang = localStorage.getItem("lang") || "en";
const theme = localStorage.getItem("theme") || "dark";

document.getElementById("langSelect").value = lang;
document.body.classList.toggle("light", theme === "light");

document.getElementById("langSelect").onchange = e => {
  localStorage.setItem("lang", e.target.value);
  location.reload();
};

document.getElementById("themeToggle").onclick = () => {
  const t = document.body.classList.contains("light") ? "dark" : "light";
  localStorage.setItem("theme", t);
  location.reload();
};

document.getElementById("beforeLabel").innerText = TEXT[lang].before;
document.getElementById("afterLabel").innerText = TEXT[lang].after;

let busy = false;
let processId = null;

document.getElementById("btn").onclick = start;

async function start() {
  if (busy) return;
  const file = document.getElementById("file").files[0];
  if (!file) return;

  const isImage = file.type.startsWith("image");
  busy = true;

  document.getElementById("warning").classList.remove("hidden");
  document.getElementById("status").innerText = TEXT[lang].uploading;
  document.getElementById("preview").classList.remove("hidden");
  document.getElementById("downloadBtn").classList.add("hidden");

  resetPreview();

  if (isImage) showBeforeImage(file);
  else showBeforeVideo(file);

  const fd = new FormData();
  fd.append("file", file);

  try {
    const url = isImage ? "/enhance/image" : "/enhance/video";
    const r = await fetch(url, { method: "POST", body: fd });

    if (isImage) {
      const blob = await r.blob();
      const outUrl = URL.createObjectURL(blob);
      document.getElementById("afterImg").src = outUrl;
      document.getElementById("afterImg").classList.remove("hidden");
      setupDownload(outUrl, "enhanced-image.jpg");
      document.getElementById("status").innerText = TEXT[lang].done;
      busy = false;
      return;
    }

    const j = await r.json();
    processId = j.processId;
    poll();

  } catch {
    document.getElementById("status").innerText = TEXT[lang].failed;
    busy = false;
  }
}

async function poll() {
  const r = await fetch(`/status/${processId}`);
  const j = await r.json();

  if (j.status === "initializing") {
    const min = Math.round((j.estimates?.time?.[0] || 300) / 60);
    document.getElementById("status").innerText = TEXT[lang].queued(min);
    setTimeout(poll, 5000);
    return;
  }

  if (j.status === "processing") {
    document.getElementById("status").innerText =
      TEXT[lang].processing(Math.round(j.progress?.percent || 0));
    setTimeout(poll, 3000);
    return;
  }

  if (j.status === "completed") {
    const url = j.download.url;
    document.getElementById("afterVid").src = url;
    document.getElementById("afterVid").classList.remove("hidden");
    setupDownload(url, "enhanced-video.mp4");
    document.getElementById("status").innerText = TEXT[lang].done;
    busy = false;
    return;
  }

  document.getElementById("status").innerText = TEXT[lang].failed;
  busy = false;
}

/* HELPERS */
function setupDownload(url, name) {
  const btn = document.getElementById("downloadBtn");
  btn.href = url;
  btn.download = name;
  btn.classList.remove("hidden");
}

function resetPreview() {
  ["beforeImg","afterImg","beforeVid","afterVid"].forEach(id=>{
    document.getElementById(id).classList.add("hidden");
  });
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
