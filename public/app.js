let processId = null;

async function start() {
  const file = document.getElementById("file").files[0];
  if (!file) return alert("Choose a video");

  document.getElementById("statusBox").classList.remove("hidden");
  document.getElementById("statusText").innerText = "Uploading...";

  const fd = new FormData();
  fd.append("file", file);

  const r = await fetch("/enhance/video", {
    method: "POST",
    body: fd
  });

  const j = await r.json();
  if (!j.processId) {
    document.getElementById("statusText").innerText = "Failed ❌";
    return;
  }

  processId = j.processId;
  poll();
}

async function poll() {
  const r = await fetch(`/status/${processId}`);
  const j = await r.json();

  if (j.status === "processing") {
    const p = j.progress?.percent || 0;
    document.getElementById("statusText").innerText =
      `Enhancing... ${p.toFixed(0)}%`;
    document.getElementById("bar").style.width = `${p}%`;
    setTimeout(poll, 3000);
  }

  if (j.status === "completed") {
    document.getElementById("statusText").innerText = "Completed ✅";
    document.getElementById("bar").style.width = "100%";
    const link = document.getElementById("download");
    link.href = j.download.url;
    link.classList.remove("hidden");
  }

  if (j.status === "failed") {
    document.getElementById("statusText").innerText = "Failed ❌";
  }
}
