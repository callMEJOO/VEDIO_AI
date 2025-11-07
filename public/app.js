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

// === القوائم ===
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
  if (!arr || !arr.length) return;
  sel.innerHTML = arr.map(v => `<option value="${v}">${v}</option>`).join("");
}
function kindFromName(name){
  // fallback لو file.type فاضي
  const ext = (name.split(".").pop() || "").toLowerCase();
  const imgExt = ["jpg","jpeg","png","webp","tif","tiff"];
  const vidExt = ["mp4","mov","m4v","webm","mkv"];
  if (imgExt.includes(ext)) return "image";
  if (vidExt.includes(ext)) return "video";
  return "image"; // افتراضيًا اعتبرها صورة عشان القوائم ما تفضاش
}
function fillModelsFor(type){
  if (type === "image") {
    fillSelect($("#modelSelect"), IMAGE_MODELS);
    $("#optionSelect").innerHTML = `<option value="">(لا يوجد)</option>`;
    // خلي الصيغة مش فيديو
    if ($("#formatSelect").value === "mp4") $("#formatSelect").value = "jpeg";
    $("#fpsTarget").value = "";
    $("#fpsTarget").disabled = true;
  } else {
    fillSelect($("#modelSelect"), Object.keys(VIDEO_MODELS));
    const first = $("#modelSelect").value || "Proteus";
    fillSelect($("#optionSelect"), (VIDEO_MODELS[first]||[]));
    $("#formatSelect").value = "mp4";
    $("#fpsTarget").disabled = false;
  }
}

// تهيئة عند التحميل: املأ موديلات الصور افتراضيًا
document.addEventListener("DOMContentLoaded", () => {
  resetUI(true);
  fillModelsFor("image");
});

// عند تغيير الموديل (للفيديو) حدث خياراته
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

// Reset
$("resetBtn").addEventListener("click", () => resetUI(true));

// Enhance (نفس اللي بعتهولك قبل — غير معدَّل)
