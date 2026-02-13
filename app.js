let processId=null, originalFileName="", selectedModel="";

const enhanceBtn=document.getElementById("enhanceBtn");
const loading=document.getElementById("loading");
const etaEl=document.getElementById("eta");
const warn=document.getElementById("leaveWarn");
const downloadBtn=document.getElementById("downloadBtn");
const beforeVid=document.getElementById("beforeVid");
const afterVid=document.getElementById("afterVid");
const beforeImg=document.getElementById("beforeImg");
const afterImg=document.getElementById("afterImg");

function resetUI(){
  processId=null; loading.classList.add("hidden"); warn.classList.add("hidden");
  downloadBtn.classList.add("hidden"); etaEl.innerText="";
  [beforeVid,afterVid].forEach(v=>{v.pause();v.src="";v.classList.add("hidden")});
  [beforeImg,afterImg].forEach(i=>{i.src="";i.classList.add("hidden")});
}

enhanceBtn.onclick=async()=>{
  const file=document.getElementById("file").files[0]; if(!file)return;
  resetUI();
  originalFileName=file.name.replace(/\.[^/.]+$/,"");
  selectedModel=document.getElementById("model").value;
  warn.classList.remove("hidden"); loading.classList.remove("hidden");

  const isImage=file.type.startsWith("image");
  if(isImage){ beforeImg.src=URL.createObjectURL(file); beforeImg.classList.remove("hidden"); }
  else{ beforeVid.src=URL.createObjectURL(file); beforeVid.classList.remove("hidden"); }

  const fd=new FormData(); fd.append("file",file); fd.append("model",selectedModel);

  if(isImage){
    const r=await fetch("/enhance/image",{method:"POST",body:fd});
    afterImg.src=URL.createObjectURL(await r.blob());
    afterImg.classList.remove("hidden");
    loading.classList.add("hidden"); warn.classList.add("hidden"); return;
  }

  const r=await fetch("/enhance/video",{method:"POST",body:fd});
  const j=await r.json(); if(!j.processId){alert("Failed"); return;}
  processId=j.processId; poll();
};

async function poll(){
  const r=await fetch(`/status/${processId}`); const j=await r.json();
  if(j.estimates?.time) etaEl.innerText=`~${Math.ceil(j.estimates.time[0]/60)} min`;
  if(j.status==="complete"){
    loading.classList.add("hidden"); warn.classList.add("hidden");
    afterVid.src=`/video/download/${processId}`; afterVid.classList.remove("hidden");
    downloadBtn.classList.remove("hidden"); return;
  }
  setTimeout(poll,4000);
}

downloadBtn.onclick=async()=>{
  const r=await fetch(`/video/download/${processId}`); const blob=await r.blob();
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=`${originalFileName}_${selectedModel}.mp4`;
  a.click();
};
