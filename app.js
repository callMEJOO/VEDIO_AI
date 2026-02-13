let processId = null;
let originalFileName = "";
let selectedModel = "";

const enhanceBtn = document.getElementById("enhanceBtn");
const loading = document.getElementById("loading");
const etaEl = document.getElementById("eta");
const warn = document.getElementById("leaveWarn");
const downloadBtn = document.getElementById("downloadBtn");

const beforeVid = document.getElementById("beforeVid");
const afterVid = document.getElementById("afterVid");
const beforeImg = document.getElementById("beforeImg");
const afterImg = document.getElementById("afterImg");

/* ================= RESET UI ================= */
function resetUI() {
  processId = null;
  loading.classList.add("hidden");
  warn.classList.add("hidden");
  downloadBtn.classList.add("hidden");
  etaEl.innerText = "";

  [beforeVid, afterVid].forEach(v => {
    v.pause();
    v.src = "";
    v.classList.add("hidden");
  });

  [beforeImg, afterImg].forEach(i => {
    i.src = "";
    i.classList.add("hidden");
  });
}

/* ================= ENHANCE ================= */
enhanceBtn.onclick = async () => {
  const fileInput = document.getElementById("file");
  const file = fileInput.files[0];
  if (!file) return;

  resetUI();

  originalFileName = file.name.replace(/\.[^/.]+$/, "");
  selectedModel = document.getElementById("model").value;

  warn.classList.remove("hidden");
  loading.classList.remove("hidden");

  const isImage = file.type.startsWith("image");

  /* ===== BEFORE PREVIEW ===== */
  if (isImage) {
    beforeImg.src = URL.createObjectURL(file);
    beforeImg.classList.remove("hidden");
  } else {
    beforeVid.src = URL.createObjectURL(file);
    beforeVid.classList.remove("hidden");
  }

  const fd = new FormData();
  fd.append("file", file);
  fd.append("model", selectedModel);

  /* ================= IMAGE ================= */
  if (isImage) {
    try {
      const r = await fetch("/enhance/image", {
        method: "POST",
        body: fd
      });

      if (!r.ok) {
        const t = await r.text();
        throw new Error(t);
      }

      const blob = await r.blob();
      afterImg.src = URL.createObjectURL(blob);
      afterImg.classList.remove("hidden");

    } catch (e) {
      alert("❌ Image enhance failed\n\n" + e.message);
    } finally {
      loading.classList.add("hidden");
      warn.classList.add("hidden");
    }
    return;
  }

  /* ================= VIDEO ================= */
  try {
    const r = await fetch("/enhance/video", {
      method: "POST",
      body: fd
    });

    const j = await r.json();

    if (!r.ok || !j.processId) {
      console.error("TOPAZ VIDEO ERROR:", j);
      loading.classList.add("hidden");
      warn.classList.add("hidden");

      alert(
        "❌ Video enhance failed\n\n" +
        JSON.stringify(j.topazResponse || j.error || j, null, 2)
      );
      return;
    }

    processId = j.processId;
    pollStatus();

  } catch (e) {
    loading.classList.add("hidden");
    warn.classList.add("hidden");
    alert("❌ Network error\n\n" + e.message);
  }
};

/* ================= POLL STATUS ================= */
async function pollStatus() {
  if (!processId) return;

  try {
    const r = await fetch(`/status/${processId}`);
    const j = await r.json();

    if (j.estimates?.time) {
      etaEl.innerText =
        "Estimated time: ~" +
        Math.ceil(j.estimates.time[0] / 60) +
        " min";
    }

    if (j.status === "complete") {
      loading.classList.add("hidden");
      warn.classList.add("hidden");

      afterVid.src = `/video/download/${processId}`;
      afterVid.classList.remove("hidden");
      downloadBtn.classList.remove("hidden");
      return;
    }

    if (j.status === "error") {
      loading.classList.add("hidden");
      warn.classList.add("hidden");
      alert("❌ Processing failed");
      return;
    }

    setTimeout(pollStatus, 4000);

  } catch (e) {
    console.error("STATUS POLL ERROR:", e);
    setTimeout(pollStatus, 5000);
  }
}

/* ================= DOWNLOAD ================= */
downloadBtn.onclick = async () => {
  if (!processId) return;

  try {
    const r = await fetch(`/video/download/${processId}`);
    const blob = await r.blob();

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${originalFileName}_${selectedModel}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();

  } catch (e) {
    alert("❌ Download failed\n\n" + e.message);
  }
};
