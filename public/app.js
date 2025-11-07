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

// ---- قوائم الموديلات من التوثيق الرسمي ----
// IMAGE models (standard)  :contentReference[oaicite:5]{index=5}
const IMAGE_MODELS = [
  "Standard V2", "Low Resolution V2", "CGI", "High Fidelity V2", "Text Refine"
];

// VIDEO models & options  :contentReference[oaicite:6]{index=6}
const VIDEO_MODELS = {
  Proteus:   ["prob-4"],                       // General (recommended)
  Artemis:   ["ahq-12","amq-13","alq-13","alqs-2","amqs-2","aaa-9"], // HQ/MQ/LQ + advanced
  Nyx:       ["nyx-3","nxf-1"],                // Denoise
  Rhea:      ["rhea-1"],                       // 4x upscale
  Gaia:      ["ghq-5","gcg-5"],                // GenAI/CG/Animation
  Theia:     ["thd-3","thf-4"],                // Detail/Fidelity
  Dione:     ["ddv-3","dtd-4","dtds-2","dtv-4","dtvs-2"], // Old content
  Iris:      ["Iris-3"],                       // Faces
  Themis:    ["thm-2"],                        // Motion deblur
  // Frame interpolation:
  Apollo:    ["apo-8","apf-2"],                // Slow-mo
  Chronos:   ["chr-2","chf-3"]                 // Framerate conversion
};

function fillSelect(select, arr){ select.innerHTML = arr.map(v => `<option value="${v}">${v}</option>`).join(""); }
function fillModelsFor(type){
  if (type === "image") {
    fillSelect($("#modelSelect"), IMAGE_MODELS);
    $("#optionSelect").innerHTML = `<option value="">(لا يوجد)</option>`;
    $("#formatSelect").value = ($("#formatSelect").value === "mp4") ? "jpeg" : $("#formatSelect").value;
    $("#fpsTarget").value = "";
    $("#fpsTarget").disabled = true;
  } else {
    fillSelect($("#modelSelect"), Object.keys(VIDEO_MODELS));
    const first = $("#modelSelect").value;
    fillSelect($("#optionSelect"), VIDEO_MODELS[first].map(o=>o));
    $("#formatSelect").value = "mp4";
    $("#fpsTarget").disabled = false; // لِـ Apollo/Chronos فقط، بس نسيبه اختياري
  }
}

// تغيير خيارات option حسب الموديل المختار (فيديو)
$("#modelSelect")?.addEventListener("change", () => {
  if (!file || !file.type) return;
  const isVideo = file.type.startsWith("video");
  if (!isVideo) return;
  const model = $("#modelSelect").value;
  const opts = VIDEO_MODELS[model] || [];
  fillSelect($("#optionSelect"), opts);
});

// اختيار ملف
resetUI(true);
$("fileInput").addEventListener("change", e => {
  resetUI(false);
  file = e.target.files[0];
  if (!file) return;

  const isImage = file.type.startsWith("image");
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
  if (!file) return alert("اختر ملف أولاً");

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
    if (file.type.startsWith("image")) {
      // IMAGE
      const res = await fetch("/enhance/image", { method:"POST", body:form });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
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
      // VIDEO
      const res = await fetch("/enhance/video", { method:"POST", body:form });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
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
            setProgress(0, "فشل المعالجة"); alert("Processing failed. جرّب ملف MP4 H.264 أقصر أو خيار موديل مختلف.");
          }
        } catch (err) {
          clearInterval(pollTimer); pollTimer = null;
          setProgress(0, "خطأ في الاستعلام");
        }
      }, 3000);
    }
  } catch (err) {
    console.error(err); setProgress(0, "خطأ");
    alert(err.message || "Unexpected error");
  }
});
