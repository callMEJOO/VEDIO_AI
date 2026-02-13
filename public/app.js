let busy = false;
let processId = null;

function estimateTime(file) {
  const mb = file.size / (1024 * 1024);
  if (file.type.startsWith("image")) return "~5–10 seconds";
  if (mb < 100) return "~1–2 minutes";
  if (mb < 300) return "~3–5 minutes";
  return "~6–10 minutes";
}

async function start() {
  if (busy) return;

  const file = document.getElementById("file").files[0];
  if (!file) return alert("اختار ملف");

  const isImage = file.type.startsWith("image");

  busy = true;
  document.getElementById("btn").disabled = true;
  document.getElementById("warning").classList.remove("hidden");
  document.getElementById("eta").innerText =
    "⏱ Estimated time: " + estimateTime(file);

  document.getElementById("preview").classList.remove("hidden");
  document.getElementById("status").innerText = "Uploading...";

  // reset
  ["beforeImg","afterImg","beforeVid","afterVid"].forEach(id=>{
    document.getElementById(id).classList.add("hidden");
  });

  // before preview
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
  fd.append("file", file); // ❗ upload مرة واحدة بس

  try {
    const url = isImage ? "/enhance/image" : "/enhance/video";
    const r = await fetch(url, { method: "POST", body: fd });

    /* IMAGE FLOW */
    if (isImage) {
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("image")) throw new Error("Image failed");
      const blob = await r.blob();
      const out = document.getElementById("afterImg");
      out.src = URL.createObjectURL(blob);
      out.classList.remove("hidden");
      document.getElementById("status").innerText = "Done ✅";
      finish();
      return;
    }

    /* VIDEO FLOW */
    if (!r.ok) {
      const t = await r.text();
      console.error(t);
      throw new Error("Video failed");
    }

    const j = await r.json();
    processId = j.processId;
    poll();

  } catch (e) {
    console.error(e);
    document.getElementById("status").innerText = "Failed ❌";
    finish();
  }
}

async function poll() {
  try {
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
  } catch (e) {
    console.error(e);
    document.getElementById("status").innerText = "Connection error";
  }

  finish();
}

function finish() {
  busy = false;
  document.getElementById("btn").disabled = false;
}
