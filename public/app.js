// =================== UltraVision App (i18n + % UI + polling + uploader/drag&drop) ===================
const dbg = (msg) => { const d = document.getElementById("debug"); if (!d) return; d.style.display="block"; d.textContent = msg; };
window.addEventListener("error", (e)=>dbg("[JS Error] " + (e.error?.message || e.message || "unknown")));

let file=null, currentProcessId=null, currentObjectURLs=[];
const $ = id => document.getElementById(id);
const STORAGE_KEY = "uv_current_process_v1";

const revokeAll = () => { currentObjectURLs.forEach(URL.revokeObjectURL); currentObjectURLs=[]; };

// ---------------- i18n ----------------
const I18N = {
  ar: {
    subtitle: "تحسين وتكبير — صور / فيديو",
    download: "⬇ تنزيل النتيجة",
    reset: "إعادة ضبط",
    pick_file: "اختيار ملف",
    none: "(لا يوجد)",
    run_enhance: "تشغيل التحسين",
    before: "قبل",
    after: "بعد",
    overlay_preparing: "جاري تجهيز الفيديو...",
    uploading: "جاري الرفع...",
    queued: "في قائمة الانتظار...",
    processing: "يتم المعالجة...",
    ready: "جاهز ✅",
    image_failed: "فشل الصورة",
    video_failed: "فشل الفيديو",
    processed_direct: "تم معالجة الفيديو — تم فتحه مباشرة",
    processed_ok: "تم معالجة الفيديو بنجاح",
    slow_processing: "المعالجة تأخرت جدًا. جرّب فيديو أقصر أو أعد المحاولة لاحقًا.",
    pick_first: "اختر ملف أولاً",
    error: "خطأ",
    converting: "جاري التحويل..."
  },
  en: {
    subtitle: "Upscale & Enhance — Image / Video",
    download: "⬇ Download Result",
    reset: "Reset",
    pick_file: "Choose file",
    none: "(None)",
    run_enhance: "Run Enhance",
    before: "Before",
    after: "After",
    overlay_preparing: "Preparing video...",
    uploading: "Uploading...",
    queued: "Queued...",
    processing: "Processing...",
    ready: "Ready ✅",
    image_failed: "Image failed",
    video_failed: "Video failed",
    processed_direct: "Processed — playing directly",
    processed_ok: "Video processed successfully",
    slow_processing: "Processing took too long. Try a shorter clip or retry later.",
    pick_first: "Pick a file first",
    error: "Error",
    converting: "Converting..."
  }
};
let LANG = "ar";

function applyLang(){
  const dict = I18N[LANG];
  document.querySelectorAll("[data-i18n]").forEach(el=>{
    const key = el.getAttribute("data-i18n");
    if (dict[key]) el.textContent = dict[key];
  });
  document.documentElement.setAttribute("lang", LANG);
  document.documentElement.setAttribute("dir", LANG === "ar" ? "rtl" : "ltr");
}
function setLang(l){ LANG = (l==="en"?"en":"ar"); applyLang(); }

// -------------- Toasts --------------
function toast(msg, type="ok"){
  const t=$("toast"); if(!t) return;
  t.textContent=msg; t.className="toast "+type; t.hidden=false;
  setTimeout(()=>{ t.hidden=true; }, 3800);
}

// -------------- Progress & overlay --------------
function setProgress(p,t){
  const pNum = Math.max(0,Math.min(100,Math.round(p||0)));
  const bar=$("bar"); if(bar) bar.style.width=`${pNum}%`;
  const s=$("statusText"); if(s&&t) s.textContent=t;
  const pct=$("pctLabel"); if(pct) pct.textContent = `${pNum}%`;
  const op=$("overlayPct"); const over = $("loaderOverlay");
  if(op && over && over.classList.contains("show")) op.textContent = `${pNum}%`;
}
function showOverlay(show=true){
  const o = $("loaderOverlay"); if (!o) return;
  if (show) { o.removeAttribute("hidden"); o.style.display="flex"; o.setAttribute("aria-hidden","false"); o.classList.add("show"); }
  else { o.classList.remove("show"); o.setAttribute("aria-hidden","true"); o.style.display="none"; o.setAttribute("hidden","hidden"); }
}

// -------------- Reset UI --------------
function resetUI(hard=false){
  ["beforeImg","afterImg"].forEach(i=>{ const el=$(i); if(el){ el.src=""; el.style.display="none"; } });
  ["beforeVideo","afterVideo"].forEach(i=>{ const v=$(i); if(!v) return; v.pause(); v.removeAttribute("src"); v.load(); v.style.display="none"; });
  const dl1=$("downloadBtn"), dl2=$("downloadBtn2");
  if(dl1) dl1.style.display="none"; if(dl2) dl2.style.display="none";
  setProgress(0,""); revokeAll(); showOverlay(false);
  if(hard){ const fi=$("fileInput"); if(fi) fi.value=""; file=null; currentProcessId=null; localStorage.removeItem(STORAGE_KEY); }
}

// -------------- Helpers --------------
function kindFromName(name){ const ext=(name.split(".").pop()||"").toLowerCase(); const imgs=["jpg","jpeg","png","webp","tif","tiff"]; const vids=["mp4","mov","m4v","webm","mkv"]; if(imgs.includes(ext))return"image"; if(vids.includes(ext))return"video"; return"image"; }

// -------------- Models --------------
const IMAGE_MODELS=["Standard V2","Low Resolution V2","CGI","High Fidelity V2","Text Refine"];
const VIDEO_MODELS={
  Proteus:["prob-4"],
  Artemis:["ahq-12","amq-13","alq-13","alqs-2","amqs-2","aaa-9"],
  Nyx:["nyx-3","nxf-1"], Rhea:["rhea-1"], Gaia:["ghq-5","gcg-5"],
  Theia:["thd-3","thf-4"], Dione:["ddv-3","dtd-4","dtds-2","dtv-4","dtvs-2"],
  Iris:["Iris-3"], Themis:["thm-2"], Apollo:["apo-8","apf-2"], Chronos:["chr-2","chf-3"]
};
function fillSelect(sel, arr){ if(!sel||!arr?.length){ if(sel) sel.innerHTML=""; return; } sel.innerHTML = arr.map(v=>`<option value="${v}">${v}</option>`).join(""); }
function fillModelsFor(type){
  const ms=$("modelSelect"), os=$("optionSelect"), fs=$("formatSelect"), fps=$("fpsTarget");
  if(!ms||!os||!fs||!fps){ dbg("[UI] عناصر ناقصة"); return; }
  if(type==="image"){ fillSelect(ms, IMAGE_MODELS); os.innerHTML=`<option value="">${I18N[LANG].none}</option>`; if(fs.value==="mp4") fs.value="jpeg"; fps.value=""; fps.disabled=true; }
  else { fillSelect(ms, Object.keys(VIDEO_MODELS)); const first=ms.value||"Proteus"; fillSelect(os, VIDEO_MODELS[first]||[]); fs.value="mp4"; fps.disabled=false; }
}

// -------------- Friendly errors --------------
function friendly(msg) {
  const s = String(msg||"").toLowerCase();
  if (s.includes("insufficient credits")) return LANG==="ar" ? "رصيد الـ API خلص. اشحن الكريديت من حساب Topaz ثم جرّب تاني." : "Insufficient API credits. Top up and retry.";
  if (s.includes("unauthorized") || s.includes("401")) return LANG==="ar" ? "مفتاح الـ API غير صحيح أو انتهى." : "API key invalid or expired.";
  if (s.includes("429") || s.includes("rate")) return LANG==="ar" ? "السيرفر مشغول/محدودية المعدل — حاول بعد لحظات." : "Server busy / rate limited — try again.";
  if (s.includes("file") && s.includes("size")) return LANG==="ar" ? "حجم الملف كبير. جرّب مقطع أقصر." : "File too large. Try a shorter clip.";
  return "";
}

// -------------- Polling (shared) --------------
async function startPolling(processId, resume=false){
  currentProcessId = processId;
  setProgress(resume?35:25, resume?I18N[LANG].queued:I18N[LANG].uploading);

  let pollDelay = 2000;
  const pollMaxDelay = 15000;
  const hardTimeoutMs = 15 * 60 * 1000;
  const startedAt = Date.now();

  async function tick(){
    try{
      const s = await fetch(`/status/${currentProcessId}`).then(r=>r.json());

      const pct = Number(s?.progress?.percent || s?.progress || 0);
      if (!isNaN(pct) && pct > 0 && pct <= 100) {
        const barPct = Math.max(30, Math.min(95, Math.floor(pct)));
        setProgress(barPct, I18N[LANG].processing + (pct ? ` (${barPct}%)` : ""));
      } else {
        const stxt = (s?.status || "processing").toLowerCase();
        if (stxt === "queued") setProgress(35, I18N[LANG].queued);
        if (stxt === "processing") setProgress(55, I18N[LANG].processing);
      }

      if ((s?.status || "").toLowerCase() === "completed" || s?.download?.url) {
        setProgress(95, I18N[LANG].overlay_preparing);
        const ovText = $("overlayText"); if (ovText) ovText.textContent = I18N[LANG].overlay_preparing;
        showOverlay(true);
        try {
          const v = $("afterVideo");
          const a1 = $("downloadBtn"), a2=$("downloadBtn2");
          const showDL = (href, dlName=null)=>{
            [a1,a2].forEach(a=>{
              if(!a) return;
              a.href = href;
              if (dlName) a.setAttribute("download", dlName); else a.removeAttribute("download");
              a.style.display="inline-block";
            });
          };

          if (s?.download?.url) {
            const direct = s.download.url;
            let played = false;
            v.src = direct; v.style.display="block"; v.load();
            const ok = await new Promise(res=>{
              const t=setTimeout(()=>res(false),3000);
              v.onloadeddata=()=>{clearTimeout(t);res(true)};
              v.onerror=()=>{clearTimeout(t);res(false)};
            });
            played = ok;
            if (!played) {
              const resp = await fetch(direct);
              const blob = await resp.blob();
              const url  = URL.createObjectURL(blob);
              currentObjectURLs.push(url);
              v.src = url; v.load();
            }
            showDL(direct,null);
            setProgress(100, I18N[LANG].ready);
            toast(I18N[LANG].processed_direct);
          } else {
            const dlUrl = `/video/download/${currentProcessId}`;
            const resp = await fetch(dlUrl);
            if (!resp.ok) throw new Error(`download proxy failed: ${resp.status}`);
            const blob = await resp.blob();
            const url  = URL.createObjectURL(blob);
            currentObjectURLs.push(url);
            v.src = url; v.style.display = "block"; v.load();
            showDL(dlUrl, `enhanced_${currentProcessId}.mp4`);
            setProgress(100, I18N[LANG].ready);
            toast(I18N[LANG].processed_ok);
          }
        } catch(err){
          toast((LANG==="ar"?"تعذر عرض الفيديو تلقائيًا: ":"Auto-play failed: ") + (err?.message || "unknown"), "error");
        } finally {
          showOverlay(false);
          localStorage.removeItem(STORAGE_KEY);
          currentProcessId = null;
        }
        return;
      }

      const stLower = (s?.status || "").toLowerCase();
      if (stLower === "failed" || stLower === "error" || s?.error) {
        setProgress(0, LANG==="ar"?"فشل المعالجة":"Processing failed");
        toast((LANG==="ar"?"فشل المعالجة: ":"Failed: ") + (s?.error || stLower), "error");
        showOverlay(false);
        localStorage.removeItem(STORAGE_KEY);
        currentProcessId = null;
        return;
      }

      if (Date.now() - startedAt > hardTimeoutMs) {
        setProgress(0, LANG==="ar"?"انتهت المهلة":"Timed out");
        toast(I18N[LANG].slow_processing,"error");
        showOverlay(false);
        return;
      }

      pollDelay = Math.min(pollDelay * 1.5, pollMaxDelay);
      setTimeout(tick, pollDelay);
    }catch(_err){
      setTimeout(tick, Math.min(pollDelay * 2, pollMaxDelay));
    }
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: processId, t: Date.now() }));
  tick();
}

// =================== Init ===================
document.addEventListener("DOMContentLoaded", ()=>{
  const savedLang = localStorage.getItem("uv_lang");
  if (savedLang) { LANG = savedLang; }
  applyLang();
  const selLangEl = $("langSelect"); if (selLangEl) selLangEl.value = LANG;

  const o = $("loaderOverlay");
  if (o){ o.classList.remove("show"); o.setAttribute("aria-hidden","true"); o.style.display="none"; o.setAttribute("hidden","hidden"); }

  resetUI(true);
  fillModelsFor("image");

  const on = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); };

  on("langSelect", "change", (e)=>{ setLang(e.target.value); localStorage.setItem("uv_lang", LANG); });

  // ====== Uploader: button + drag&drop ======
  const fi = $("fileInput"), dz = $("dropzone");
  const pick = ()=>{ if (fi) fi.click(); };
  on("pickBtn","click", pick);

  function handlePicked(f){
    if(!f) return;
    resetUI(false);
    file = f;
    const isImage = f.type?.startsWith("image") || (f.name||"").match(/\.(png|jpe?g|webp|tiff?)$/i);
    fillModelsFor(isImage?"image":"video");
    const url = URL.createObjectURL(f);
    currentObjectURLs.push(url);
    if(isImage){ $("beforeImg").src=url; $("beforeImg").style.display="block"; }
    else { $("beforeVideo").src=url; $("beforeVideo").style.display="block"; $("beforeVideo").load(); }
  }

  on("fileInput","change",(e)=>handlePicked(e.target.files?.[0]));

  if (dz){
    ["dragenter","dragover"].forEach(ev=>dz.addEventListener(ev,(e)=>{e.preventDefault();e.stopPropagation();dz.classList.add("dragover");}));
    ["dragleave","drop"].forEach(ev=>dz.addEventListener(ev,(e)=>{e.preventDefault();e.stopPropagation();dz.classList.remove("dragover");}));
    dz.addEventListener("drop",(e)=>{ handlePicked(e.dataTransfer?.files?.[0]); });
    dz.addEventListener("click", pick);
  }

  // sliders live
  [["ctlSharpen","valSharpen"],["ctlDenoise","valDenoise"],["ctlRecover","valRecover"],["ctlGrain","valGrain"]]
  .forEach(([i,v])=>{
    const input=$(i), label=$(v); if(input&&label){ const sync=()=>label.textContent=`${input.value}%`; input.addEventListener("input",sync); sync(); }
  });

  // visibility / session restore
  window.addEventListener("pageshow", () => { if (!currentProcessId) showOverlay(false); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !currentProcessId) showOverlay(false); });

  try{ const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); if (saved?.id) startPolling(saved.id, true); }catch{}

  // change model options for video
  on("modelSelect","change", ()=>{
    if(!file) return;
    const isVideo = file.type?.startsWith("video") || kindFromName(file.name)==="video";
    if(!isVideo) return;
    const model = $("modelSelect").value;
    fillSelect($("optionSelect"), VIDEO_MODELS[model]||[]);
  });

  // reset
  on("resetBtn","click", ()=>resetUI(true));

  // enhance
  on("enhanceBtn","click", async ()=>{
    if(!file){ toast(I18N[LANG].pick_first,"error"); return; }
    setProgress(5, I18N[LANG].uploading);

    const model=$("modelSelect")?.value, option=$("optionSelect")?.value, scale=$("scaleSelect")?.value, format=$("formatSelect")?.value, fpsT=$("fpsTarget")?.value;
    const sharpen = $("ctlSharpen")?.value ?? "", denoise = $("ctlDenoise")?.value ?? "", recover = $("ctlRecover")?.value ?? "", grain = $("ctlGrain")?.value ?? "";

    const form=new FormData();
    form.append("file",file);
    if(model)  form.append("model",model);
    if(option) form.append("model_option",option);
    if(scale)  form.append("scale",scale);
    if(format) form.append("format",format);
    if(fpsT)   form.append("fps_target",fpsT);
    if(sharpen) form.append("sharpen",sharpen);
    if(denoise) form.append("denoise",denoise);
    if(recover) form.append("recover",recover);
    if(grain)   form.append("grain",grain);

    try{
      const isImage = file.type?.startsWith("image") || kindFromName(file.name)==="image";

      if(isImage){
        const res = await fetch("/enhance/image",{method:"POST",body:form});
        if(!res.ok){
          let msg=`HTTP ${res.status}`; try{const j=await res.json(); msg=j?.error||msg;}catch{msg=await res.text()||msg}
          toast((I18N[LANG].image_failed)+": "+msg+"\n"+(friendly(msg)||""), "error");
          setProgress(0, I18N[LANG].error); return;
        }
        setProgress(70, I18N[LANG].converting);
        const blob=await res.blob(), url=URL.createObjectURL(blob); currentObjectURLs.push(url);
        $("afterImg").src=url; $("afterImg").style.display="block"; setProgress(100, I18N[LANG].ready);
        const a1=$("downloadBtn"), a2=$("downloadBtn2"); [a1,a2].forEach(a=>{ if(a){ a.href=url; a.download=`enhanced.${format||"jpg"}`; a.style.display="inline-block"; }});
        toast(LANG==="ar"?"تم معالجة الصورة بنجاح":"Image processed");
      } else {
        const res = await fetch("/enhance/video",{method:"POST",body:form});
        if(!res.ok){ let raw=`HTTP ${res.status}`; try{const j=await res.json(); if(j.error) raw=j.error;}catch{} toast((I18N[LANG].video_failed)+": "+raw+"\n"+(friendly(raw)||""),"error"); setProgress(0, I18N[LANG].error); return; }
        const {processId}=await res.json();
        startPolling(processId);
      }
    }catch(err){
      dbg("[Fetch Error] "+(err.message||String(err)));
      setProgress(0, I18N[LANG].error);
      showOverlay(false);
    }
  });
});
