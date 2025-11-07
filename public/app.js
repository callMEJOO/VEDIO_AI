// debug bar
const dbg = (msg) => { const d = document.getElementById("debug"); if (!d) return; d.style.display="block"; d.textContent = msg; };
window.addEventListener("error", (e)=>dbg("[JS Error] " + (e.error?.message || e.message || "unknown")));

let file=null, pollTimer=null, currentProcessId=null, currentObjectURLs=[];
const $ = id => document.getElementById(id);
const revokeAll = () => { currentObjectURLs.forEach(URL.revokeObjectURL); currentObjectURLs=[]; };

function setProgress(p,t){ const b=$("bar"); if(b) b.style.width=`${p}%`; const s=$("statusText"); if(s&&t) s.textContent=t; }
function resetUI(hard=false){
  if (pollTimer){ clearInterval(pollTimer); pollTimer=null; }
  currentProcessId=null;
  ["beforeImg","afterImg"].forEach(i=>{ const el=$(i); if(el) el.src=""; });
  ["beforeVideo","afterVideo"].forEach(i=>{ const v=$(i); if(!v) return; v.pause(); v.removeAttribute("src"); v.load(); });
  ["beforeImg","afterImg","beforeVideo","afterVideo","downloadBtn"].forEach(i=>{ const el=$(i); if(el) el.style.display = i==="downloadBtn"?"none":"none"; });
  setProgress(0,""); revokeAll(); if(hard){ const fi=$("fileInput"); if(fi) fi.value=""; file=null; }
}
function kindFromName(name){ const ext=(name.split(".").pop()||"").toLowerCase(); const imgs=["jpg","jpeg","png","webp","tif","tiff"]; const vids=["mp4","mov","m4v","webm","mkv"]; if(imgs.includes(ext))return"image"; if(vids.includes(ext))return"video"; return"image"; }

// models
const IMAGE_MODELS=["Standard V2","Low Resolution V2","CGI","High Fidelity V2","Text Refine"];
const VIDEO_MODELS={
  Proteus:["prob-4"],
  Artemis:["ahq-12","amq-13","alq-13","alqs-2","amqs-2","aaa-9"],
  Nyx:["nyx-3","nxf-1"],
  Rhea:["rhea-1"], Gaia:["ghq-5","gcg-5"],
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

document.addEventListener("DOMContentLoaded", ()=>{
  resetUI(true); fillModelsFor("image");

  $("modelSelect").addEventListener("change", ()=>{
    if(!file) return;
    const isVideo = file.type?.startsWith("video") || kindFromName(file.name)==="video";
    if(!isVideo) return;
    const model = $("modelSelect").value;
    fillSelect($("optionSelect"), VIDEO_MODELS[model]||[]);
  });

  $("fileInput").addEventListener("change", (e)=>{
    resetUI(false); file=e.target.files[0]; if(!file) return;
    const isImage = file.type?.startsWith("image") || kindFromName(file.name)==="image";
    fillModelsFor(isImage?"image":"video");
    const url=URL.createObjectURL(file); currentObjectURLs.push(url);
    if(isImage){ $("beforeImg").src=url; $("beforeImg").style.display="block"; }
    else { $("beforeVideo").src=url; $("beforeVideo").style.display="block"; $("beforeVideo").load(); }
  });

  $("resetBtn").addEventListener("click", ()=>resetUI(true));

  $("enhanceBtn").addEventListener("click", async ()=>{
    if(!file){ alert("اختر ملف أولاً"); return; }
    if(pollTimer){ clearInterval(pollTimer); pollTimer=null; }
    setProgress(5,"جاري الرفع...");

    const model=$("modelSelect").value, option=$("optionSelect").value, scale=$("scaleSelect").value, format=$("formatSelect").value, fpsT=$("fpsTarget").value;
    const form=new FormData(); form.append("file",file); form.append("model",model); if(option) form.append("model_option",option); form.append("scale",scale); form.append("format",format); if(fpsT) form.append("fps_target",fpsT);

    try{
      const isImage = file.type?.startsWith("image") || kindFromName(file.name)==="image";

      if(isImage){
        const res = await fetch("/enhance/image",{method:"POST",body:form});
        if(!res.ok){ let msg=`HTTP ${res.status}`; try{const j=await res.json(); if(j.error) msg=j.error;}catch{} alert("Image failed: "+msg); setProgress(0,"خطأ"); return; }
        setProgress(70,"جاري التحويل...");
        const blob=await res.blob(), url=URL.createObjectURL(blob); currentObjectURLs.push(url);
        $("afterImg").src=url; $("afterImg").style.display="block"; setProgress(100,"تم");
        const a=$("downloadBtn"); a.href=url; a.download=`enhanced.${format}`; a.style.display="inline-block";
      } else {
        const res = await fetch("/enhance/video",{method:"POST",body:form});
        if(!res.ok){ let msg=`HTTP ${res.status}`; try{const j=await res.json(); if(j.error) msg=j.error;}catch{} alert("Video failed: "+msg); setProgress(0,"خطأ"); return; }
        const {processId}=await res.json(); currentProcessId=processId; setProgress(25,"تم الرفع. جاري المعالجة على السحابة...");

        pollTimer=setInterval(async()=>{
          try{
            const s=await fetch(`/status/${currentProcessId}`).then(r=>r.json()); const st=(s.status||"").toLowerCase();
            if(st==="queued") setProgress(35,"في قائمة الانتظار...");
            if(st==="processing") setProgress(55,"يتم المعالجة...");
            if(st==="completed"){
              clearInterval(pollTimer); pollTimer=null; setProgress(100,"تم المعالجة ✅");
              const dlUrl=`/video/download/${currentProcessId}`;
              const blob=await fetch(dlUrl).then(r=>r.blob()); const url=URL.createObjectURL(blob); currentObjectURLs.push(url);
              $("afterVideo").src=url; $("afterVideo").style.display="block"; $("afterVideo").load();
              const a=$("downloadBtn"); a.href=dlUrl; a.setAttribute("download",`enhanced_${currentProcessId}.mp4`); a.style.display="inline-block";
            }
            if(st==="failed" || st==="error"){ clearInterval(pollTimer); pollTimer=null; setProgress(0,"فشل المعالجة"); alert("Processing failed. جرّب MP4 H.264 قصير أو موديل آخر."); }
          }catch{ clearInterval(pollTimer); pollTimer=null; setProgress(0,"خطأ في الاستعلام"); }
        },3000);
      }
    }catch(err){ dbg("[Fetch Error] "+(err.message||String(err))); setProgress(0,"خطأ"); }
  });
});
