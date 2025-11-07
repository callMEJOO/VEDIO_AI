require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

const app = express();
app.use(express.static("public"));

// لوج تشخيصي بسيط
app.use((req, _res, next) => { console.log(`${req.method} ${req.path}`); next(); });

// تمبوراري سريع على Render + حد حجم مناسب
const upload = multer({
  dest: "/tmp/uploads",
  limits: { fileSize: 1024 * 1024 * 512 } // 512MB
});

const IMG_CT = { jpeg:"image/jpeg", jpg:"image/jpeg", png:"image/png", webp:"image/webp", tiff:"image/tiff", tif:"image/tiff" };
const safeUnlink = p => { if (p && fs.existsSync(p)) fs.unlink(p, ()=>{}); };

/* ---------------------- IMAGE (sync) ---------------------- */
// doc: Enhance image (sync/async) + params (model, output_format, ...) :contentReference[oaicite:3]{index=3}
app.post("/enhance/image", upload.single("file"), async (req, res) => {
  const tmp = req.file?.path;
  try {
    const {
      model = "Standard V2",
      scale = "2x", // لبعض الموديلات بيستنتج من output_*، بس بنبعته لو مدعوم
      format = "jpeg",
      output_width,
      output_height,
      face_enhancement,
      face_enhancement_strength,
      face_enhancement_creativity,
      subject_detection,
      crop_to_fill
    } = req.body;

    const form = new FormData();
    form.append("image", fs.createReadStream(tmp));
    form.append("model", model);
    if (output_width) form.append("output_width", output_width);
    if (output_height) form.append("output_height", output_height);
    if (subject_detection) form.append("subject_detection", subject_detection);
    if (face_enhancement) form.append("face_enhancement", face_enhancement);
    if (face_enhancement_strength) form.append("face_enhancement_strength", face_enhancement_strength);
    if (face_enhancement_creativity) form.append("face_enhancement_creativity", face_enhancement_creativity);
    if (crop_to_fill) form.append("crop_to_fill", crop_to_fill);
    if (scale) form.append("scale", scale); // يُتجاهل إن لم يكن مدعومًا
    form.append("output_format", format);

    const r = await axios.post(
      "https://api.topazlabs.com/image/v1/enhance",
      form,
      {
        headers: { ...form.getHeaders(), "X-API-Key": process.env.TOPAZ_API_KEY },
        responseType: "arraybuffer",
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      }
    );

    const ct = IMG_CT[(format || "").toLowerCase()] || "application/octet-stream";
    res.setHeader("Content-Type", ct);
    res.setHeader("Content-Disposition", `attachment; filename="enhanced.${format}"`);
    res.send(Buffer.from(r.data, "binary"));
  } catch (e) {
    const msg = e?.response?.data || e.message;
    console.error("IMAGE ERROR:", msg);
    res.status(400).json({ error: typeof msg === "string" ? msg : JSON.stringify(msg) });
  } finally {
    safeUnlink(tmp);
  }
});

/* ---------------------- VIDEO (async) ---------------------- */
// doc: Video API walkthrough + models/options + async flow (process_id, status, output_url) :contentReference[oaicite:4]{index=4}
app.post("/enhance/video", upload.single("file"), async (req, res) => {
  const tmp = req.file?.path;
  try {
    const {
      model = "Proteus",           // أمثلة: Proteus / Artemis / Nyx / Rhea / Gaia / Apollo / Chronos / Dione / Theia / Iris / Themis
      model_option,                // أمثلة: prob-4, ahq-12, amq-13, ... حسب الصفحة الرسمية للموديل
      scale = "2x",                // upscaling (إن كان مدعومًا لنوع الموديل)
      format = "mp4",              // مخرج الفيديو
      fps_target,                  // لِـ Apollo/Chronos (interpolation)
      denoise, sharpen,            // لبعض الموديلات (Artemis/Nyx/Proteus) — إن زادت، الـ API يتجاهل غير المدعوم
      artifact_correction
    } = req.body;

    // 1) ابدأ المهمة
    const startForm = new FormData();
    startForm.append("model", model);
    if (model_option) startForm.append("model_option", model_option);
    if (scale) startForm.append("scale", scale);
    if (fps_target) startForm.append("fps_target", fps_target);
    if (denoise) startForm.append("denoise", denoise);
    if (sharpen) startForm.append("sharpen", sharpen);
    if (artifact_correction) startForm.append("artifact_correction", artifact_correction);
    startForm.append("output_format", format);

    const start = await axios.post(
      "https://api.topazlabs.com/video/v1/enhance/async",
      startForm,
      {
        headers: { ...startForm.getHeaders(), "X-API-Key": process.env.TOPAZ_API_KEY },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      }
    );

    const { process_id, upload_url } = start.data || {};

    // 2) ارفع الفيديو — إمّا عبر upload_url (لو متاح) أو endpoint مباشر
    if (upload_url) {
      await axios.put(upload_url, fs.createReadStream(tmp), {
        headers: { "Content-Type": "application/octet-stream" },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });
    } else {
      const up = new FormData();
      up.append("video", fs.createReadStream(tmp));
      await axios.post(
        `https://api.topazlabs.com/video/v1/enhance/${process_id}/upload`,
        up,
        {
          headers: { ...up.getHeaders(), "X-API-Key": process.env.TOPAZ_API_KEY },
          maxBodyLength: Infinity,
          maxContentLength: Infinity
        }
      );
    }

    res.json({ processId: process_id });
  } catch (e) {
    const msg = e?.response?.data || e.message;
    console.error("VIDEO ERROR:", msg);
    res.status(400).json({ error: typeof msg === "string" ? msg : JSON.stringify(msg) });
  } finally {
    safeUnlink(tmp);
  }
});

// حالة المهمة (polling)
app.get("/status/:id", async (req, res) => {
  try {
    const st = await axios.get(
      `https://api.topazlabs.com/video/v1/status/${req.params.id}`,
      { headers: { "X-API-Key": process.env.TOPAZ_API_KEY } }
    );
    res.json(st.data);
  } catch (e) {
    console.error("STATUS ERROR:", e?.response?.data || e.message);
    res.status(500).json({ status: "error" });
  }
});

// تنزيل الفيديو من السيرفر (تنزيل حقيقي بملف)
app.get("/video/download/:id", async (req, res) => {
  try {
    const st = await axios.get(
      `https://api.topazlabs.com/video/v1/status/${req.params.id}`,
      { headers: { "X-API-Key": process.env.TOPAZ_API_KEY } }
    );
    if (st.data.status !== "completed" || !st.data.output_url) {
      return res.status(425).send("Not ready");
    }
    const url = st.data.output_url;
    const filename = `enhanced_${req.params.id}.mp4`;
    const streamResp = await axios.get(url, { responseType: "stream" });
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    streamResp.data.pipe(res);
  } catch (e) {
    console.error("DOWNLOAD ERROR:", e?.response?.data || e.message);
    res.status(500).send("Download error");
  }
});

// 404 واضح
app.use((req, res) => {
  console.warn("404 for", req.method, req.originalUrl);
  res.status(404).send("Not Found");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on ${PORT}`));
