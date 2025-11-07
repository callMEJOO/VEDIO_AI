// --- Debug helper: يطبع أي خطأ JS في شريط أحمر فوق ---
window.addEventListener("error", (e) => {
  const d = document.getElementById("debug");
  d.style.display = "block";
  d.textContent = "[JS Error] " + (e.error?.message || e.message || "unknown");
});

let file = null;
let pollTimer = null;
let currentProcessId = null;
let currentObjectURLs = [];

const $ = id => document.getElementById(id);
const revokeAll = () => { currentObjectURLs.forEach(u => URL.revokeObjectURL(u)); currentObjectURLs = []; };

function resetUI(hard=false){
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  currentProcessId = null;
  ["beforeImg","afterImg"].forEach(id => $(id).src = "");
  ["beforeVideo","afterVideo"].forEach(id => { const v=$(id); v.pause(); v.removeAttribute("src"); v.load(); });
  $("beforeImg").style.display = "none"; $("afterImg").style.display  = "none";
  $("beforeVideo").style.display = "none"; $("afterVideo").style.display  = "none";
  $("downloadBtn").style.display = "none";
  $("bar").style.width = "0%"; $("statusText").textContent = "";
  revokeAll();
  if (hard) { $("fileInput").value = ""; file = null; }
}
function setProgress(pct, text){ $("bar").style.width = `${pct}%`; if (text) $("statusText").textContent = text; }

// fallback لتحديد النوع من الامتداد لو type فاضي
function kindFromName(name){
  const ext = (name.split(".").pop() || "").toLowerCase();
  const imgExt = ["jpg","jpeg","png","webp","tif","tiff"];
  const vidExt = ["mp4","mov","m4v","webm","mkv"];
  if (imgExt.includes(ext)) return "image";
  if (vidExt.includes(ext)) return "video";
  return "image";
}

// IMAGE / VIDEO models
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

function fillSelect(sel, arr){
  if (!sel) return;
  if (!arr || !arr.length) return;
  sel.innerHTML = arr.map(v => `<option value="${v}">${v}</option>`).join("");
}
function fillModelsFor(type){
  if (type === "image") {
    fillSelect($("#modelSelect"), IMAGE_MODELS);
    $("#optionSelect").innerHTML = `<option value="">(لا يوجد)</option>`;
    if ($("#formatSelect").value === "mp4") $("#formatSelect").value = "jpeg";
    $("#fpsTarget").value = "";
    $("#fpsTarget").disabled = true;
  } else {
    fillSelect($("#modelSelect"), Object.keys(VIDEO_MODELS));
    const first = $("#modelSelect").value || "Proteus";
    fillSelect($("#optionSelect"), (VIDEO_MODELS[first] || []));
    $("#formatSelect").value = "mp4";
    $("#fpsTarget").disabled = false;
  }
}

// init on load: عرّض موديلات الصور افتراضيًا
document.addEventListener("DOMContentLoaded", () => {
  resetUI(true);
  fillModelsFor("image");

  // زرار Reset
  $("resetBtn").addEventListener("click", () => resetUI(true));

  // تغيير الموديل يُحدّث options في الفيديو
  $("#modelSelect").addEventListener("change", () => {
    if (!file) return;
    const isVideo = file.type?.startsWith("video") || kindFromName(file.name)==="video";
    if (!isVideo) return;
    const model = $("#modelSelect").value;
    fillSelect($("#optionSelect"), VIDEO_MODELS[model] || []);
  });

  // اختيار ملف
  $("fileInput").addEventListener("change", e => {
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

  // Enhance
  $("enhanceBtn").addEventListener("click", async () => {
    if (!file) { alert("اختر ملف أولاً"); return; }

    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    setProgress(5, "جاري الرفع...");

    const model  = $("#modelSelect").value;
    const option = $("#optionSelect").value;
    const scale  = $("#scaleSelect").value;
    const format = $("#formatSelect").value;
    const fpsT   = $("#fpsTarget").value;

    const form = new FormData();
    form.append("file", file);
    form.append("model", model);
    if (option) form.append("model_option", option);
    form.append("scale", scale);
    form.append("format", format);
    if (fpsT) form.append("fps_target", fpsT);

    try {
      if (file.type?.startsWith("image") || kindFromName(file.name)==="image") {
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
      const d = $("debug"); d.style.display="block"; d.textContent="[Fetch Error] " + (err.message || String(err));
      setProgress(0, "خطأ");
    }
  });
});
