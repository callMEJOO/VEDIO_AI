let busy = false;
let processId = null;

async function start() {
  if (busy) return;
  const file = document.getElementById("file").files[0];
  const mode = document.getElementById("mode").value;
  if (!file) return alert("اختار ملف");

  busy = true;
  document.getElementById("btn").disabled = true;
  document.getElementById("status").innerText = "Uploading...";

  const preview = document.getElementById("preview");
  preview.classList.remove("hidden");

  // Reset
  ["beforeImg","afterImg","beforeVid","afterVid"].forEach(id=>{
    document.getElementById(id).classList.add("hidden");
  });

  // BEFORE
  if (mode === "image") {
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

  try {
    const url = mode === "image" ? "/enhance/image" : "/enhance/video";
    const r = await fetch(url, { method: "POST", body: fd });
    if (!r.ok) throw new Error("failed");

    // IMAGE
    if (mode === "image") {
      const blob = await r.blob();
      const out = document.getElementById("afterImg");
      out.src = URL.createObjectURL(blob);
      out.classList.remove("hidden");
      document.getElementById("status").innerText = "Done ✅";
      busy = false;
      document.getElementById("btn").disabled = false;
      return;
    }

    // VIDEO
    const j = await r.json();
    processId = j.processId;
    poll();

  } catch {
    document.getElementById("status").innerText = "Failed ❌";
    busy = false;
    document.getElementById("btn").disabled = false;
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

  busy = false;
  document.getElementById("btn").disabled = false;
}
