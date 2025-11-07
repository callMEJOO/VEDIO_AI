let file = null;
let pollTimer = null;
let currentProcessId = null;
let currentObjectURLs = [];

const $ = (id) => document.getElementById(id);

function resetUI(hard=false){
  // إيقاف polling القديم
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  currentProcessId = null;

  // مسح المصادر القديمة
  ["beforeImg","afterImg"].forEach(id => $(id).src = "");
  ["beforeVideo","afterVideo"].forEach(id => {
    const v = $(id);
    v.pause();
    v.removeAttribute("src");
    v.load();
  });

  // إخفاء/إظهار المناسب
  $("beforeImg").style.display = "none";
  $("afterImg").style.display  = "none";
  $("beforeVideo").style.display = "none";
  $("afterVideo").style.display  = "none";
  $("downloadBtn").style.display = "none";

  // تقدم/نص
  $("bar").style.width = "0%";
  $("statusText").textContent = "";

  // إلغاء Blob URLs القديمة
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

/* Reset يدوي */
$("resetBtn").addEventListener("click", () => resetUI(true));

/* تشغيل التحسين */
$("enhanceBtn").addEventListener("click", async () => {
  if (!file) return alert("اختر ملف أولاً");

  // إلغاء أي عملية قديمة
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
      // صورة → endpoint الصورة (يرجع attachment)
      const res = await fetch("/enhance/image", { method:"POST", body:form });
      if (!res.ok) throw new Error("Image request failed");
      setProgress(70, "جاري التحويل...");

      // خُد Blob واعرضه ونزّل مباشرة لو حابب
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      currentObjectURLs.push(url);

      $("afterImg").src = url;
      $("afterImg").style.display = "block";
      setProgress(100, "تم");

      // زر تنزيل حقيقي (نفس البيانات)
      const a = $("downloadBtn");
      a.href = url;
      a.download = `enhanced.${format}`;
      a.style.display = "inline-block";

    } else {
      // فيديو → async job
      const res = await fetch("/enhance/video", { method:"POST", body:form });
      if (!res.ok) throw new Error("Video request failed");
      const { processId } = await res.json();
      currentProcessId = processId;

      setProgress(25, "تم الرفع. جاري المعالجة على السحابة...");

      // Polling كل 3 ثواني
      pollTimer = setInterval(async () => {
        try {
          const s = await fetch(`/status/${currentProcessId}`).then(r => r.json());
          // تحديث نص التقدم (لو API بيرجع نسبة—هنا بنستدل بالحالة)
          const st = (s.status || "").toLowerCase();

          if (st === "queued")  setProgress(35, "في قائمة الانتظار...");
          if (st === "processing") setProgress(55, "يتم المعالجة...");
          if (st === "completed") {
            clearInterval(pollTimer); pollTimer = null;
            setProgress(100, "تم المعالجة ✅");

            // تنزيل/عرض من السيرفر علشان Content-Disposition يشتغل
            const dlUrl = `/video/download/${currentProcessId}`;
            // للعرض داخل الموقع: جلب Blob أولاً
            const blob = await fetch(dlUrl).then(r => r.blob());
            const url  = URL.createObjectURL(blob);
            currentObjectURLs.push(url);

            $("afterVideo").src = url;
            $("afterVideo").style.display = "block";
            $("afterVideo").load();

            const a = $("downloadBtn");
            a.href = dlUrl; // التحميل المباشر ملف حقيقي
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
    alert(err.message || "خطأ غير متوقع");
  }
});
