const TEXT = {
  en: {
    title: "AI Image & Video Enhancer",
    subtitle: "Enhance images and videos using AI\nBefore / After • High Quality • Automatic",
    before: "Before",
    after: "After",
    warning: "⚠️ Please do not leave or close this page while processing",
    uploading: "Uploading...",
    processing: p => `Enhancing... ${p}%`,
    done: "Done ✅",
    failed: "Failed ❌"
  },
  ar: {
    title: "محسن الصور والفيديو بالذكاء الاصطناعي",
    subtitle: "تحسين الصور والفيديوهات بالذكاء الاصطناعي\nقبل / بعد • جودة عالية • تلقائي",
    before: "قبل",
    after: "بعد",
    warning: "⚠️ برجاء عدم الخروج من الصفحة أثناء المعالجة",
    uploading: "جاري الرفع...",
    processing: p => `جاري التحسين... ${p}%`,
    done: "تم بنجاح ✅",
    failed: "فشل ❌"
  }
};

/* ---------- LANGUAGE ---------- */
const lang = localStorage.getItem("lang") || "en";
const theme = localStorage.getItem("theme") || "dark";

document.getElementById("langSelect").value = lang;
document.body.classList.toggle("light", theme === "light");

applyLang(lang);

document.getElementById("langSelect").onchange = e => {
  localStorage.setItem("lang", e.target.value);
  location.reload();
};

document.getElementById("themeToggle").onclick = () => {
  const newTheme = document.body.classList.contains("light") ? "dark" : "light";
  localStorage.setItem("theme", newTheme);
  location.reload();
};

function applyLang(l) {
  document.getElementById("title").innerText = TEXT[l].title;
  document.getElementById("subtitle").innerText = TEXT[l].subtitle;
  document.getElementById("beforeLabel").innerText = TEXT[l].before;
  document.getElementById("afterLabel").innerText = TEXT[l].after;
  document.getElementById("warning").innerText = TEXT[l].warning;
}

/* ---------- ENHANCE ---------- */
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

  resetPreview();

  if (isImage) {
    showBeforeImage(file);
  } else {
    showBeforeVideo(file);
  }

  const fd = new FormData();
  fd.append("file", file);

  try {
    const url = isImage ? "/enhance/image" : "/enhance/video";
    const r = await fetch(url, { method: "POST", body: fd });

    if (isImage) {
      const blob = await r.blob();
      document.getElementById("afterImg").src = URL.createObjectURL(blob);
      document.getElementById("afterImg").classList.remove("hidden");
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

  if (j.status === "processing") {
    document.getElementById("status").innerText =
      TEXT[lang].processing(Math.round(j.progress?.percent || 0));
    setTimeout(poll, 3000);
    return;
  }

  if (j.status === "completed") {
    document.getElementById("afterVid").src = j.download.url;
    document.getElementById("afterVid").classList.remove("hidden");
    document.getElementById("status").innerText = TEXT[lang].done;
  } else {
    document.getElementById("status").innerText = TEXT[lang].failed;
  }

  busy = false;
}

/* ---------- HELPERS ---------- */
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
