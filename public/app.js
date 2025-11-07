/************ Debug helpers ************/
const dbg = (msg) => {
  const d = document.getElementById("debug");
  if (!d) return;
  d.style.display = "block";
  d.textContent = msg;
};
window.addEventListener("error", (e) => {
  dbg("[JS Error] " + (e.error?.message || e.message || "unknown"));
});

/************ DOM helpers ************/
const $ = (id) => document.getElementById(id);
const need = (id) => {
  const el = $(id);
  if (!el) dbg(`[UI] عنصر مفقود بالـ ID: ${id}`);
  return el;
};

/************ State ************/
let file = null;
let pollTimer = null;
let currentProcessId = null;
let currentObjectURLs = [];

/************ UI utils ************/
const revokeAll = () => { currentObjectURLs.forEach(u => URL.revokeObjectURL(u)); currentObjectURLs = []; };
const setProgress = (pct, text) => {
  const bar = $("bar"); if (bar) bar.style.width = `${pct}%`;
  const st  = $("statusText"); if (st && text) st.textContent = text;
};
const resetUI = (hard=false) => {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  currentProcessId = null;

  const beforeImg  = $("beforeImg");
  const afterImg   = $("afterImg");
  const beforeVid  = $("beforeVideo");
  const afterVid   = $("afterVideo");
  const dl         = $("downloadBtn");

  if (beforeImg) beforeImg.src = "";
  if (afterImg)  afterImg.src  = "";
  if (beforeVid) { beforeVid.pause(); beforeVid.removeAttribute("src"); beforeVid.load(); }
  if (afterVid)  { afterVid.pause();  afterVid.removeAttribute("src");  afterVid.load(); }

  if (beforeImg) beforeImg.style.display = "none";
  if (afterImg)  afterImg.style.display  = "none";
  if (beforeVid) beforeVid.style.display = "none";
  if (afterVid)  afterVid.style.display  = "none";
  if (dl)        dl.style.display        = "none";

  setProgress(0, "");
  revokeAll();
  if (hard) {
    const fi = $("fileInput");
    if (fi) { fi.value = ""; }
    file = null;
  }
};

/************ Model lists ************/
const IMAGE_MODELS = ["Standard V2","Low Resolution V2","CGI","High Fidelity V2","Text Refine"];
const VIDEO_MODELS = {
  Proteus:["prob-4"],
  Artemis:["ahq-12","amq-13","alq-13","alqs-2","amqs-2","aaa-9"],
  Nyx:["nyx-3","nxf-1"],
  Rhea:["rhea-1"],
  Gaia:["ghq-5","gcg-5"],
  Theia:["thd-3","thf-4"],
  Dione:["ddv-3","dtd-4","dtds-2","dtv-4","dtvs-2"],
  Iris:["Iris-3"],
  Themis:["thm-2"],
  Apollo:["apo-8","apf-2"],
  Chronos:["chr-2","chf-3"]
};

/************ Safe fill/select ************/
function fillSelect(sel, arr){
  if (!sel) { dbg("[UI] select عنصر ناقص"); return; }
  if (!Array.isArray(arr) || arr.length === 0) return;
  // لو sel مش موجود سيوصلنا هنا بالفعل
  sel.innerHTML = arr.map(v => `<option value="${v}">${v}</option>`).join("");
}
function kindFromName(name){
  const ext = (name.split(".").pop() || "").toLowerCase();
  const imgExt = ["jpg","jpeg","png","webp","tif","tiff"];
  const vidExt = ["mp4","mov","m4v","webm","mkv"];
  if (imgExt.includes(ext)) return "image";
  if (vidExt.includes(ext)) return "video";
  return "image";
}
function fillModelsFor(type){
  const modelSel  = need("modelSelect");
  const optionSel = need("optionSelect");
  const formatSel = need("formatSelect");
  const fpsTarget = need("fpsTarget");
  if (!modelSel || !optionSel || !formatSel || !fpsTarget) return;

  if (type === "image") {
    fillSelect(modelSel, IMAGE_MODELS);
    optionSel.innerHTML = `<option value="">(لا يوجد)</option>`;
    if (formatSel.value === "mp4") formatSel.value = "jpeg";
    fpsTarget.value = "";
    fpsTarget.disabled = true;
  } else {
    fillSelect(modelSel, Object.keys(VIDEO_MODELS));
    const first = modelSel.value || "Proteus";
    fillSelect(optionSel, VIDEO_MODELS[first] || []);
    formatSel.value = "mp4";
    fpsTarget.disabled = false;
  }
}

/************ Init after DOM ready ************/
document.addEventListener("DOMContentLoaded", () => {
  // تأكد من وجود كل العناصر مرة واحدة
  const must = ["fileInput","modelSelect","optionSelect","scaleSelect","formatSelect","fpsTarget","enhanceBtn","resetBtn","beforeImg","afterImg","beforeVideo","afterVideo","downloadBtn","bar","statusText"];
  let missing = must.filter(id => !$(id));
  if (missing.length) { dbg("[UI] عناصر ناقصة: " + missing.join(", ")); return; }

  resetUI(true);
  fillModelsFor("image"); // افتراضيًا

  // عند تغيير الموديل (فيديو) عدّل الخيارات
  $("modelSelect").addEventListener("change", () => {
    if (!file) return;
    const isVideo = file.type?.startsWith("video") || kindFromName(file.name)==="video";
    if (!isVideo) return;
    const model = $("modelSelect").value;
    fillSelect($("optionSelect"), VIDEO_MODELS[model] || []);
  });

  // اختيار ملف
  $("fileInput").addEventListener("change", (e) => {
    resetUI(false);
    file = e.target.files[0];
    if (!file) return;

    const isImage = file.type?.startsWith("image") || kindFromName(file.name)==="image";
    fillModelsFor(isImage ? "image" : "video");

    const url = URL.createObjectURL(file);
    currentObjectURLs.push(url);
    if (isImage) { $("beforeImg").src = url; $("beforeImg").style.display = "block"; }
    else { $("beforeVideo").src = url; $("beforeVideo").style.display = "block"; $("beforeVideo").load(); }
  });

  // Reset
  $("resetBtn").addEventListener("click", () => resetUI(true));

  // Enhance
  $("enhanceBtn").addEventListener("click", async () => {
    if (!file) { alert("اختر ملف أولاً"); return; }

    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    setProgress(5, "جاري الرفع...");

    const model  = $("modelSelect").value;
    const option = $("optionSelect").value;
    const scale  = $("scaleSelect").value;
    const format = $("formatSelect").value;
    const fpsT   = $("fpsTarget").value;

    const form = new FormData();
    form.append("file", file);
    form.append("model", model);
    if (option) form.append("model_option", option);
    form.append("scale", scale);
    form.append("format", format);
    if (fpsT) form.append("fps_target", fpsT);

    try {
      const isImage = file.type?.startsWith("image") || kindFromName(file.name)==="image";

      if (isImage) {
        const res = await fetch("/enhance/image", { method:"POST", body:form });
        if (!res.ok) {
          let msg = `HTTP ${res.status}`; try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
          alert("Image failed: " + msg); setProgress(0, "خطأ"); return;
        }
        setProgress(70, "جاري التحويل...");
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        currentObjectURLs.push(url);
        $("afterImg").src = url; $("afterImg").style.display = "block";
        setProgress(100, "تم");
        const a = $("downloadBtn"); a.href = url; a.download = `enhanced.${format}`; a.style.display = "inline-block";
      } else {
        const res = await fetch("/enhance/video", { method:"POST", body:form });
        if (!res.ok) {
          let msg = `HTTP ${res.status}`; try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
          alert("Video failed: " + msg); setProgress(0, "خطأ"); return;
        }
        const { processId } = await res.json();
        currentProcessId = processId;
        setProgress(25, "تم الرفع. جاري المعالجة على السحابة...");

        pollTimer = setInterval(async () => {
          try {
            const s = await fetch(`/status/${currentProcessId}`).then(r => r.json());
            const st = (s.status || "").toLowerCase();
            if (st === "queued")     setProgress(35, "في قائمة الانتظار...");
            if (st === "processing") setProgress(55, "يتم المعالجة...");
            if (st === "completed") {
              clearInterval(pollTimer); pollTimer = null;
              setProgress(100, "تم المعالجة ✅");
              const dlUrl = `/video/download/${currentProcessId}`;
              const blob  = await fetch(dlUrl).then(r => r.blob());
              const url   = URL.createObjectURL(blob);
              currentObjectURLs.push(url);
              $("afterVideo").src = url; $("afterVideo").style.display = "block"; $("afterVideo").load();
              const a = $("downloadBtn"); a.href = dlUrl; a.setAttribute("download", `enhanced_${currentProcessId}.mp4`); a.style.display = "inline-block";
            }
            if (st === "failed" || st === "error") {
              clearInterval(pollTimer); pollTimer = null;
              setProgress(0, "فشل المعالجة");
              alert("Processing failed. جرّب MP4 H.264 قصير أو موديل آخر.");
            }
          } catch (err) {
            clearInterval(pollTimer); pollTimer = null;
            setProgress(0, "خطأ في الاستعلام");
          }
        }, 3000);
      }
    } catch (err) {
      dbg("[Fetch Error] " + (err.message || String(err)));
      setProgress(0, "خطأ");
    }
  });
});
