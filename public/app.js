let file = null;
let pollTimer = null;
let currentProcessId = null;
let currentObjectURLs = [];

const $ = (id) => document.getElementById(id);

function resetUI(hard=false){
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  currentProcessId = null;

  ["beforeImg","afterImg"].forEach(id => $(id).src = "");
  ["beforeVideo","afterVideo"].forEach(id => {
    const v = $(id);
    v.pause();
    v.removeAttribute("src");
    v.load();
  });

  $("beforeImg").style.display = "none";
  $("afterImg").style.display  = "none";
  $("beforeVideo").style.display = "none";
  $("afterVideo").style.display  = "none";
  $("downloadBtn").style.display = "none";

  $("bar").style.width = "0%";
  $("statusText").textContent = "";

  currentObjectURLs.forEach(u => URL.revokeObjectURL(u));
  currentObjectURLs = [];

  if (hard) {
    $("fileInput").value = "";
    file = null;
  }
}

function setProgress(pct, text){
  $("bar").style.width = `${pct}%`;
  if (text) $("statusText").textContent = text;
}

// بداية نظيفة
resetUI(true);

/* اختيار ملف */
$("fileInput").addEventListener("change", e => {
  resetUI(false);
  file = e.target.files[0];
  if (!file) return;

  const isImage = file.type.startsWith("image");
  const url = URL.createObjectURL(file);
  currentObjectURLs.push(url);

  if (isImage) {
    $("beforeImg").src = url;
    $("beforeImg").style.display = "block";
  } else {
    $("beforeVideo").src = url;
    $("beforeVideo").style.display = "block";
    $("beforeVideo").load();
  }
});

/* Reset */
$("resetBtn").addEventListener("click", () => resetUI(true));

/* Enhance */
$("enhanceBtn").addEventListener("click", async () => {
  if (!file) return alert("اختر ملف أولاً");

  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  setProgress(5, "جاري الرفع...");

  const model  = $("modelSelect").value;
  const scale  = $("scaleSelect").value;
  const format = $("formatSelect").value;

  const form = new FormData();
  form.append("file", file);
  form.append("model", model);
  form.append("scale", scale);
  form.append("format", format);

  try {
    if (file.type.startsWith("image")) {
      const res = await fetch("/enhance/image", { method:"POST", body:form });
      if (!res.ok) throw new Error("Image request failed");
      setProgress(70, "جاري التحويل...");

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      currentObjectURLs.push(url);

      $("afterImg").src = url;
      $("afterImg").style.display = "block";
      setProgress(100, "تم");

      const a = $("downloadBtn");
      a.href = url;
      a.download = `enhanced.${format}`;
      a.style.display = "inline-block";

    } else {
      const res = await fetch("/enhance/video", { method:"POST", body:form });
      if (!res.ok) {
        let errTxt = "Video request failed";
        try { const j = await res.json(); errTxt = j.error || errTxt; } catch {}
        alert(errTxt);
        setProgress(0, "خطأ");
        return;
      }
      const { processId } = await res.json();
      currentProcessId = processId;

      setProgress(25, "تم الرفع. جاري المعالجة على السحابة...");

      pollTimer = setInterval(async () => {
        try {
          const s = await fetch(`/status/${currentProcessId}`).then(r => r.json());
          const st = (s.status || "").toLowerCase();

          if (st === "queued")     setProgress(35, "في قائمة الانتظار...");
          if (st === "processing") setProgress(55, "يتم المعالجة...");
          if (st === "completed") {
            clearInterval(pollTimer); pollTimer = null;
            setProgress(100, "تم المعالجة ✅");

            const dlUrl = `/video/download/${currentProcessId}`;
            const blob  = await fetch(dlUrl).then(r => r.blob());
            const url   = URL.createObjectURL(blob);
            currentObjectURLs.push(url);

            $("afterVideo").src = url;
            $("afterVideo").style.display = "block";
            $("afterVideo").load();

            const a = $("downloadBtn");
            a.href = dlUrl; // تنزيل حقيقي
            a.setAttribute("download", `enhanced_${currentProcessId}.mp4`);
            a.style.display = "inline-block";
          }

          if (st === "failed" || st === "error") {
            clearInterval(pollTimer); pollTimer = null;
            setProgress(0, "فشل المعالجة");
            alert("حدث خطأ أثناء المعالجة.");
          }
        } catch (err) {
          clearInterval(pollTimer); pollTimer = null;
          setProgress(0, "خطأ في الاستعلام");
        }
      }, 3000);
    }
  } catch (err) {
    console.error(err);
    setProgress(0, "خطأ");
    alert(err.message || "Unexpected error");
  }
});
