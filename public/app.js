// =================== UltraVision App (with session resume) ===================
const dbg = (msg) => { const d = document.getElementById("debug"); if (!d) return; d.style.display="block"; d.textContent = msg; };
window.addEventListener("error", (e)=>dbg("[JS Error] " + (e.error?.message || e.message || "unknown")));

let file=null, currentProcessId=null, currentObjectURLs=[];
const $ = id => document.getElementById(id);
const STORAGE_KEY = "uv_current_process_v1";

const revokeAll = () => { currentObjectURLs.forEach(URL.revokeObjectURL); currentObjectURLs=[]; };

// Toasts
function toast(msg, type="ok"){
  const t=$("toast"); if(!t) return;
  t.textContent=msg; t.className="toast "+type; t.hidden=false;
  setTimeout(()=>{ t.hidden=true; }, 3800);
}

// Progress & overlay
function setProgress(p,t){ const bar=$("bar"); if(bar) bar.style.width=`${p}%`; const s=$("statusText"); if(s&&t) s.textContent=t; }
function showOverlay(show=true){
  const o = $("loaderOverlay"); if (!o) return;
  if (show) o.classList.add("show"); else o.classList.remove("show");
}

// Reset UI
function resetUI(hard=false){
  ["beforeImg","afterImg"].forEach(i=>{ const el=$(i); if(el){ el.src=""; el.style.display="none"; } });
  ["beforeVideo","afterVideo"].forEach(i=>{ const v=$(i); if(!v) return; v.pause(); v.removeAttribute("src"); v.load(); v.style.display="none"; });
  const dl=$("downloadBtn"); if(dl) dl.style.display="none";
  setProgress(0,""); revokeAll(); showOverlay(false);
  if(hard){ const fi=$("fileInput"); if(fi) fi.value=""; file=null; currentProcessId=null; localStorage.removeItem(STORAGE_KEY); }
}

// Helpers
function kindFromName(name){ const ext=(name.split(".").pop()||"").toLowerCase(); const imgs=["jpg","jpeg","png","webp","tif","tiff"]; const vids=["mp4","mov","m4v","webm","mkv"]; if(imgs.includes(ext))return"image"; if(vids.includes(ext))return"video"; return"image"; }

// Models
const IMAGE_MODELS=["Standard V2","Low Resolution V2","CGI","High Fidelity V2","Text Refine"];
const VIDEO_MODELS={
  Proteus:["prob-4"],
  Artemis:["ahq-12","amq-13","alq-13","alqs-2","amqs-2","aaa-9"],
  Nyx:["nyx-3","nxf-1"], Rhea:["rhea-1"], Gaia:["ghq-5","gcg-5"],
  Theia:["thd-3","thf-4"], Dione:["ddv-3","dtd-4","dtds-2","dtv-4","dtvs-2"],
  Iris:["Iris-3"], Themis:["thm-2"], Apollo:["apo-8","apf-2"], Chronos:["chr-2","chf-3"]
};
function fillSelect(sel, arr){ if(!sel||!arr?.length)return; sel.innerHTML = arr.map(v=>`<option value="${v}">${v}</option>`).join(""); }
function fillModelsFor(type){
  const ms=$("modelSelect"), os=$("optionSelect"), fs=$("formatSelect"), fps=$("fpsTarget");
  if(!ms||!os||!fs||!fps){ dbg("[UI] عناصر ناقصة"); return; }
  if(type==="image"){ fillSelect(ms, IMAGE_MODELS); os.innerHTML=`<option value="">(لا يوجد)</option>`; if(fs.value==="mp4") fs.value="jpeg"; fps.value=""; fps.disabled=true; }
  else { fillSelect(ms, Object.keys(VIDEO_MODELS)); const first=ms.value||"Proteus"; fillSelect(os, VIDEO_MODELS[first]||[]); fs.value="mp4"; fps.disabled=false; }
}

// Friendly errors
function friendly(msg) {
  const s = String(msg||"").toLowerCase();
  if (s.includes("insufficient credits")) return "رصيد الـ API خلص. اشحن الكريديت من حساب Topaz ثم جرّب تاني.";
  if (s.includes("unauthorized") || s.includes("401")) return "مفتاح الـ API غير صحيح أو انتهى.";
  if (s.includes("429") || s.includes("rate")) return "السيرفر مشغول/محدودية المعدل — حاول بعد لحظات.";
  if (s.includes("file") && s.includes("size")) return "حجم الملف كبير. جرّب مقطع أقصر.";
  return "";
}

// =================== Polling (shared) ===================
async function startPolling(processId, resume=false){
  currentProcessId = processId;
  if (resume) {
    setProgress(35, "استرجاع الحالة...");
  } else {
    setProgress(25, "تم الرفع. جاري المعالجة على السحابة...");
  }

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
        setProgress(barPct, "يتم المعالجة..." + (pct ? ` (${barPct}%)` : ""));
      } else {
        const stxt = (s?.status || "processing").toLowerCase();
        if (stxt === "queued") setProgress(35, "في قائمة الانتظار...");
        if (stxt === "processing") setProgress(55, "يتم المعالجة...");
      }

      // ===== انتهت المعالجة =====
      if ((s?.status || "").toLowerCase() === "completed" || s?.download?.url) {
        setProgress(95, "جاري تجهيز الفيديو للعرض...");
        showOverlay(true);
        try {
          // استخدم رابط Topaz المباشر أولاً
          if (s?.download?.url) {
            const direct = s.download.url;
            const v = $("afterVideo");
            v.crossOrigin = "anonymous";
            v.src = direct;
            v.style.display = "block";
            v.load();

            const a = $("downloadBtn");
            a.href = direct;
            a.removeAttribute("download");
            a.style.display = "inline-block";

            setProgress(100,"جاهز ✅");
            toast("تم معالجة الفيديو — تم فتحه مباشرة من السحابة");
          } else {
            // Fallback: عبر السيرفر
            const dlUrl = `/video/download/${currentProcessId}`;
            const resp = await fetch(dlUrl);
            if (!resp.ok) throw new Error(`download proxy failed: ${resp.status}`);
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            currentObjectURLs.push(url);
            $("afterVideo").src = url;
            $("afterVideo").style.display = "block";
            $("afterVideo").load();
            const a = $("downloadBtn");
            a.href = dlUrl;
            a.setAttribute("download", `enhanced_${currentProcessId}.mp4`);
            a.style.display = "inline-block";
            setProgress(100,"جاهز ✅");
            toast("تم معالجة الفيديو بنجاح");
          }
        } catch(err){
          toast("تعذر عرض الفيديو تلقائيًا: " + (err?.message || "unknown"), "error");
        } finally {
          showOverlay(false);
          // نظّف الجلسة المحفوظة
          localStorage.removeItem(STORAGE_KEY);
          currentProcessId = null;
        }
        return;
      }

      // فشل
      const stLower = (s?.status || "").toLowerCase();
      if (stLower === "failed" || stLower === "error" || s?.error) {
        setProgress(0, "فشل المعالجة");
        toast("فشل المعالجة: " + (s?.error || stLower), "error");
        showOverlay(false);
        localStorage.removeItem(STORAGE_KEY);
        currentProcessId = null;
        return;
      }

      // مهلة قصوى (أمان)
      if (Date.now() - startedAt > hardTimeoutMs) {
        setProgress(0, "انتهت المهلة");
        toast("المعالجة تأخرت جدًا. جرّب فيديو أقصر أو أعد المحاولة لاحقًا.","error");
        showOverlay(false);
        // لا نمسح التخزين؛ المستخدم ممكن يعاود الاسترجاع يدويًا
        return;
      }

      // backoff تدريجي
      pollDelay = Math.min(pollDelay * 1.5, pollMaxDelay);
      setTimeout(tick, pollDelay);
    }catch(err){
      // خطأ مؤقت في الشبكة — استمر
      setTimeout(tick, Math.min(pollDelay * 2, pollMaxDelay));
    }
  }

  // خزّن الجلسة للاسترجاع بعد الغلق
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: processId, t: Date.now() }));
  tick();
}

// =================== Init ===================
document.addEventListener("DOMContentLoaded", ()=>{
  // تأكيد إطفاء الأوفرلاي عند الدخول
  showOverlay(false);
  resetUI(true);
  fillModelsFor("image");

  // لو خرج ورجع، اقفل الأوفرلاي إن مفيش عملية شغالة
  window.addEventListener("pageshow", () => { if (!currentProcessId) showOverlay(false); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !currentProcessId) showOverlay(false);
  });

  // استرجاع تلقائي لو في processId محفوظ
  try{
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved?.id) {
      // ابدأ الاسترجاع فورًا بدون ما تلمس الأوفرلاي
      startPolling(saved.id, true);
    }
  }catch{}

  $("modelSelect").addEventListener("change", ()=>{
    if(!file) return;
    const isVideo = file.type?.startsWith("video") || kindFromName(file.name)==="video";
    if(!isVideo) return;
    const model = $("modelSelect").value;
    fillSelect($("optionSelect"), VIDEO_MODELS[model]||[]);
  });

  $("fileInput").addEventListener("change", (e)=>{
    resetUI(false);
    file = e.target.files[0];
    if(!file) return;
    const isImage = file.type?.startsWith("image") || kindFromName(file.name)==="image";
    fillModelsFor(isImage?"image":"video");
    const url=URL.createObjectURL(file); currentObjectURLs.push(url);
    if(isImage){ $("beforeImg").src=url; $("beforeImg").style.display="block"; }
    else { $("beforeVideo").src=url; $("beforeVideo").style.display="block"; $("beforeVideo").load(); }
  });

  $("resetBtn").addEventListener("click", ()=>resetUI(true));

  $("enhanceBtn").addEventListener("click", async ()=>{
    if(!file){ toast("اختر ملف أولاً","error"); return; }
    setProgress(5,"جاري الرفع...");

    const model=$("modelSelect").value, option=$("optionSelect").value, scale=$("scaleSelect").value, format=$("formatSelect").value, fpsT=$("fpsTarget").value;
    const form=new FormData();
    form.append("file",file);
    form.append("model",model);
    if(option) form.append("model_option",option);
    form.append("scale",scale);
    form.append("format",format);
    if(fpsT) form.append("fps_target",fpsT);

    try{
      const isImage = file.type?.startsWith("image") || kindFromName(file.name)==="image";

      if(isImage){
        const res = await fetch("/enhance/image",{method:"POST",body:form});
        if(!res.ok){
          let msg=`HTTP ${res.status}`;
          try{
            const ct = res.headers.get("content-type") || "";
            if(ct.includes("application/json")){
              const j = await res.json();
              msg = (typeof j?.error === "string") ? j.error : (j?.error ? JSON.stringify(j.error) : JSON.stringify(j));
            } else {
              const t = await res.text();
              msg = t || msg;
            }
          }catch{}
          toast("فشل الصورة: "+msg+"\n"+(friendly(msg)||""), "error");
          setProgress(0,"خطأ"); return;
        }
        setProgress(70,"جاري التحويل...");
        const blob=await res.blob(), url=URL.createObjectURL(blob); currentObjectURLs.push(url);
        $("afterImg").src=url; $("afterImg").style.display="block"; setProgress(100,"تم ✅");
        const a=$("downloadBtn"); a.href=url; a.download=`enhanced.${format}`; a.style.display="inline-block";
        toast("تم معالجة الصورة بنجاح");
      } else {
        const res = await fetch("/enhance/video",{method:"POST",body:form});
        if(!res.ok){ let raw=`HTTP ${res.status}`; try{const j=await res.json(); if(j.error) raw=j.error;}catch{} toast("فشل الفيديو: "+raw+"\n"+(friendly(raw)||""),"error"); setProgress(0,"خطأ"); return; }
        const {processId}=await res.json();
        startPolling(processId);
      }
    }catch(err){
      dbg("[Fetch Error] "+(err.message||String(err)));
      setProgress(0,"خطأ");
      showOverlay(false);
    }
  });
});
