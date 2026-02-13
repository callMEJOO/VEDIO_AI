let mode = "image";
let processId = null;

function setMode(m) {
  mode = m;
  document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
  event.target.classList.add("active");
  document.getElementById("imageBox").classList.add("hidden");
  document.getElementById("videoBox").classList.add("hidden");
}

document.getElementById("slider").addEventListener("input", e => {
  document.querySelector(".after-wrap").style.width = e.target.value + "%";
});

async function start() {
  const file = document.getElementById("file").files[0];
  if (!file) return alert("Choose a file");

  document.getElementById("status").innerText = "Uploading...";

  const url = mode === "image" ? "/enhance/image" : "/enhance/video";
  const fd = new FormData();
  fd.append("file", file);

  /* BEFORE PREVIEW */
  if (mode === "image") {
    document.getElementById("beforeImg").src = URL.createObjectURL(file);
    document.getElementById("imageBox").classList.remove("hidden");
  } else {
    document.getElementById("beforeVid").src = URL.createObjectURL(file);
    document.getElementById("videoBox").classList.remove("hidden");
  }

  const r = await fetch(url, { method: "POST", body: fd });
  const res = await r.json();

  if (mode === "image") {
    const blob = await fetch(url, { method: "POST", body: fd }).then(r => r.blob());
    const outURL = URL.createObjectURL(blob);
    document.getElementById("afterImg").src = outURL;
    document.getElementById("downloadImg").href = outURL;
    document.getElementById("downloadImg").classList.remove("hidden");
    document.getElementById("status").innerText = "Done ✅";
  } else {
    processId = res.processId;
    poll();
  }
}

async function poll() {
  const r = await fetch(`/status/${processId}`);
  const j = await r.json();

  if (j.status === "processing") {
    document.getElementById("status").innerText =
      `Enhancing... ${j.progress?.percent || 0}%`;
    setTimeout(poll, 3000);
  }

  if (j.status === "completed") {
    document.getElementById("afterVid").src = j.download.url;
    document.getElementById("downloadVid").href = j.download.url;
    document.getElementById("downloadVid").classList.remove("hidden");
    document.getElementById("status").innerText = "Completed ✅";
  }

  if (j.status === "failed") {
    document.getElementById("status").innerText = "Failed ❌";
  }
}
