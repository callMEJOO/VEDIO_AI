let busy = false;
let processId = null;

function estimateTime(file) {
  const mb = file.size / (1024 * 1024);
  if (file.type.startsWith("image")) return "~5-10 seconds";
  if (mb < 100) return "~1-2 minutes";
  if (mb < 300) return "~3-5 minutes";
  return "~6-10 minutes";
}

async function start() {
  if (busy) return;

  const file = document.getElementById("file").files[0];
  if (!file) return alert("اختار ملف");

  const isImage = file.type.startsWith("image");
  const quality = document.getElementById("quality").value;
  const model = document.getElementById("model").value;

  busy = true;
  document.getElementById("btn").disabled = true;
  document.getElementById("warning").classList.remove("hidden");
  document.getElementById("eta").innerText =
    "⏱ Estimated time: " + estimateTime(file);

  document.getElementById("preview").classList.remove("hidden");
  document.getElementById("status").innerText = "Uploading...";

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
  fd.append("quality", quality);
  fd.append("model", model);

  try {
    const url = isImage ? "/enhance/image" : "/enhance/video";
    const r = await fetch(url, { method: "POST", body: fd });
    if (!r.ok) throw new Error();

    if (isImage) {
      const blob = await r.blob();
      const out = document.getElementById("afterImg");
      out.src = URL.createObjectURL(blob);
      out.classList.remove("hidden");
      document.getElementById("status").innerText = "Done ✅";
      finish();
      return;
    }

    const j = await r.json();
    processId = j.processId;
    poll();

  } catch {
    document.getElementById("status").innerText = "Failed ❌";
    finish();
  }
}

async function poll() {
  const r = await fetch(`/status/${processId}`);
  const j = await r.json();

  if (j.status === "processing") {
    document.getElementById("status").innerText =
      `Enhancing... ${Math.round(j.progress?.percent || 0)}%`;
    setTimeout(poll, 3000);
    return;
  }

  if (j.status === "completed") {
    const vid = document.getElementById("afterVid");
    vid.src = j.download.url;
    vid.classList.remove("hidden");
    document.getElementById("status").innerText = "Completed ✅";
  } else {
    document.getElementById("status").innerText = "Failed ❌";
  }

  finish();
}

function finish() {
  busy = false;
  document.getElementById("btn").disabled = false;
}
