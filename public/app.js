let processId = null;

const enhanceBtn = document.getElementById("enhance");
const loader = document.getElementById("loader");
const etaEl = document.getElementById("eta");
const warn = document.getElementById("warn");

enhanceBtn.onclick = async () => {
  const file = document.getElementById("file").files[0];
  if (!file) return;

  warn.classList.remove("hidden");
  loader.classList.remove("hidden");

  const fd = new FormData();
  fd.append("file", file);
  fd.append("model", document.getElementById("model").value);

  if (file.type.startsWith("image")) {
    const r = await fetch("/enhance/image",{ method:"POST", body:fd });
    document.getElementById("afterImg").src = URL.createObjectURL(await r.blob());
    loader.classList.add("hidden");
    return;
  }

  document.getElementById("before").src = URL.createObjectURL(file);

  const r = await fetch("/enhance/video",{ method:"POST", body:fd });
  const j = await r.json();
  processId = j.processId;
  poll();
};

async function poll() {
  const r = await fetch(`/status/${processId}`);
  const j = await r.json();

  if (j.estimates?.time) {
    etaEl.innerText = `~${Math.ceil(j.estimates.time[0]/60)} min`;
  }

  if (j.status === "complete") {
    loader.classList.add("hidden");
    warn.classList.add("hidden");
    document.getElementById("after").src = `/video/download/${processId}`;
    document.getElementById("download").classList.remove("hidden");
    return;
  }
  setTimeout(poll, 4000);
}

document.getElementById("download").onclick = async () => {
  const r = await fetch(`/video/download/${processId}`);
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "enhanced.mp4";
  a.click();
};

document.getElementById("mode").onclick = ()=>{
  document.body.classList.toggle("light");
};
