let busy = false;
let processId = null;
let currentLang = "en";

const TEXT = {
  en: {
    uploading: "⏳ Uploading file...",
    processing: p => `⚙️ Enhancing... ${p}%`,
    done: "✅ Enhancement completed",
    failed: "❌ Processing failed. Please try another file.",
    warning: "⚠️ Please do not leave or close this page while processing",
    eta: t => `⏱ Estimated time: ${t}`
  },
  ar: {
    uploading: "⏳ جاري رفع الملف...",
    processing: p => `⚙️ جاري التحسين... ${p}%`,
    done: "✅ تم التحسين بنجاح",
    failed: "❌ حدث خطأ، برجاء تجربة ملف آخر",
    warning: "⚠️ برجاء عدم إغلاق الصفحة أثناء المعالجة",
    eta: t => `⏱ الوقت المتوقع: ${t}`
  }
};

function setLang(l) {
  currentLang = l;
  document.getElementById("warning").innerText = TEXT[l].warning;
}

function estimateTime(file) {
  const mb = file.size / (1024 * 1024);
  if (file.type.startsWith("image")) return "5–10 sec";
  if (mb < 100) return "1–2 min";
  if (mb < 300) return "3–5 min";
  return "6–10 min";
}

async function start() {
  if (busy) return;

  const file = document.getElementById("file").files[0];
  if (!file) return alert("Choose a file");

  const isImage = file.type.startsWith("image");

  busy = true;
  document.getElementById("btn").disabled = true;

  document.getElementById("warning").classList.remove("hidden");
  document.getElementById("eta").innerText =
    TEXT[currentLang].eta(estimateTime(file));

  document.getElementById("preview").classList.remove("hidden");
  document.getElementById("status").innerText =
    TEXT[currentLang].uploading;

  ["beforeImg","afterImg","beforeVid","afterVid"].forEach(id=>{
    document.getElementById(id).classList.add("hidden");
  });

  if (isImage) {
    const img = document.getElementById("beforeImg");
    img.src = URL.createObjectURL(file);
    img.classList.remove("hidden");
  } else {
    const vid = document.getElementById("beforeVid");
    vid.src = URL.createObjectURL(file);
    vid.classList.remove("hidden");
  }

  const fd = new FormData();
  fd.append("file", file);

  try {
    const url = isImage ? "/enhance/image" : "/enhance/video";
    const r = await fetch(url, { method: "POST", body: fd });

    if (isImage) {
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("image")) throw new Error();
      const blob = await r.blob();
      const out = document.getElementById("afterImg");
      out.src = URL.createObjectURL(blob);
      out.classList.remove("hidden");
      document.getElementById("status").innerText =
        TEXT[currentLang].done;
      finish();
      return;
    }

    if (!r.ok) throw new Error();
    const j = await r.json();
    processId = j.processId;
    poll();

  } catch {
    document.getElementById("status").innerText =
      TEXT[currentLang].failed;
    finish();
  }
}

async function poll() {
  try {
    const r = await fetch(`/status/${processId}`);
    const j = await r.json();

    if (j.status === "processing") {
      document.getElementById("status").innerText =
        TEXT[currentLang].processing(
          Math.round(j.progress?.percent || 0)
        );
      setTimeout(poll, 3000);
      return;
    }

    if (j.status === "completed") {
      const vid = document.getElementById("afterVid");
      vid.src = j.download.url;
      vid.classList.remove("hidden");
      document.getElementById("status").innerText =
        TEXT[currentLang].done;
    } else {
      document.getElementById("status").innerText =
        TEXT[currentLang].failed;
    }
  } catch {
    document.getElementById("status").innerText =
      TEXT[currentLang].failed;
  }

  finish();
}

function finish() {
  busy = false;
  document.getElementById("btn").disabled = false;
}
