require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
const path = require("path");

const app = express();

// UI static
app.use(express.static("public"));

// صحّة سريعة
app.get("/health", (_req, res) => res.json({ ok: true }));

// لوج بسيط
app.use((req, _res, next) => { console.log(`${req.method} ${req.path}`); next(); });

// تخزين مؤقت على Render
const upload = multer({
  dest: "/tmp/uploads",
  limits: { fileSize: 1024 * 1024 * 512 } // 512MB
});
const safeUnlink = p => { if (p && fs.existsSync(p)) fs.unlink(p, ()=>{}); };

// ---------- IMAGE (Sync) – شغال زي ما هو ----------
const IMG_CT = { jpeg:"image/jpeg", jpg:"image/jpeg", png:"image/png", webp:"image/webp", tiff:"image/tiff", tif:"image/tiff" };

app.post("/enhance/image", upload.single("file"), async (req, res) => {
  const tmp = req.file?.path;
  try {
    const { model="Standard V2", scale="2x", format="jpeg" } = req.body;

    const form = new FormData();
    form.append("image", fs.createReadStream(tmp));
    form.append("model", model);
    form.append("scale", scale);
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

    const ct = IMG_CT[(format||"").toLowerCase()] || "application/octet-stream";
    res.setHeader("Content-Type", ct);
    res.setHeader("Content-Disposition", `attachment; filename="enhanced.${format}"`);
    res.send(Buffer.from(r.data, "binary"));
  } catch (e) {
    console.error("IMAGE ERROR:", e?.response?.data || e.message);
    res.status(400).json({ error: e?.response?.data || e.message });
  } finally {
    safeUnlink(tmp);
  }
});

// ---------- VIDEO (Async) – الفلو الرسمي الجديد ----------
/*
  Flow (Topaz Video API):
  1) POST  /video/                      -> { requestId, estimates }
  2) PATCH /video/{id}/accept           -> { uploadId, urls[] }  (multipart PUT)
  3) PUT   لكل URL في urls[]            -> يرجّع ETag
  4) PATCH /video/{id}/complete-upload/ -> يبدأ المعالجة
  5) GET   /video/{id}/status           -> فيه download.url عند الاكتمال
*/

app.post("/enhance/video", upload.single("file"), async (req, res) => {
  const tmp = req.file?.path;
  try {
    if (!req.file || !req.file.path) {
      return res.status(400).json({ error: "No video file uploaded" });
    }

    const {
      model = "Proteus",      // من الواجهة: Proteus/Artemis/... الخ
      model_option = "prob-4",// خيار الموديل (أسماءهم زي docs)
      // scale, fps_target, format ... (اختياري هنا؛ هنسيبه للـ API يقرر الافضل)
    } = req.body;

    // -- 1) Create request
    // نبعت أقل جسم ممكن صالح (filters فقط). ممكن تزود output لاحقًا.
    const createBody = {
      filters: [{ model: model_option || "prob-4" }]
    };

    const createResp = await axios.post(
      "https://api.topazlabs.com/video/",
      createBody,
      { headers: { "X-API-Key": process.env.TOPAZ_API_KEY } }
    );
    const requestId = createResp.data?.requestId;
    if (!requestId) throw new Error("Topaz did not return requestId");

    // -- 2) Accept: يرجّع multipart URLs
    const acceptResp = await axios.patch(
      `https://api.topazlabs.com/video/${requestId}/accept`,
      {},
      { headers: { "X-API-Key": process.env.TOPAZ_API_KEY } }
    );
    const { uploadId, urls } = acceptResp.data || {};
    if (!uploadId || !Array.isArray(urls) || urls.length === 0) {
      throw new Error("Accept did not return multipart URLs");
    }

    // -- 3) Multipart PUT uploads
    // هنقسم الملف بالتساوي حسب عدد الروابط الراجعة.
    const stat = fs.statSync(tmp);
    const totalSize = stat.size;
    const parts = urls.length;
    const partSize = Math.ceil(totalSize / parts);
    const uploadResults = [];

    for (let i = 0; i < parts; i++) {
      const start = i * partSize;
      const end = Math.min(totalSize, (i + 1) * partSize) - 1; // شامل
      const stream = fs.createReadStream(tmp, { start, end });

      // مهم: Content-Length = حجم الجزء
      const contentLength = end - start + 1;

      const putResp = await axios.put(urls[i], stream, {
        headers: { "Content-Length": contentLength },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: s => s >= 200 && s < 400 // S3 ممكن يرجّع 200/204
      });

      // S3 بيرجع ETag في الهيدر
      const eTag = putResp.headers.etag || putResp.headers.ETag || putResp.headers["etag"];
      if (!eTag) {
        console.warn("WARN: Missing ETag for part", i + 1);
      }
      uploadResults.push({ partNum: i + 1, eTag: (eTag || "").replace(/"/g, "") });
    }

    // -- 4) Complete upload (يبدأ المعالجة)
    await axios.patch(
      `https://api.topazlabs.com/video/${requestId}/complete-upload/`,
      { uploadResults },
      {
        headers: {
          "X-API-Key": process.env.TOPAZ_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    // رجّع الـ id للواجهة عشان الـ polling
    res.json({ processId: requestId });
  } catch (e) {
    const msg = e?.response?.data || e.message || "Video flow error";
    console.error("VIDEO ERROR:", msg);
    res.status(400).json({ error: typeof msg === "string" ? msg : JSON.stringify(msg) });
  } finally {
    safeUnlink(tmp);
  }
});

// ---------- STATUS ----------
app.get("/status/:id", async (req, res) => {
  try {
    const st = await axios.get(
      `https://api.topazlabs.com/video/${req.params.id}/status`,
      { headers: { "X-API-Key": process.env.TOPAZ_API_KEY } }
    );
    res.json(st.data);
  } catch (e) {
    console.error("STATUS ERROR:", e?.response?.data || e.message);
    res.status(500).json({ status: "error" });
  }
});

// ---------- DOWNLOAD (من signed URL) ----------
app.get("/video/download/:id", async (req, res) => {
  try {
    const st = await axios.get(
      `https://api.topazlabs.com/video/${req.params.id}/status`,
      { headers: { "X-API-Key": process.env.TOPAZ_API_KEY } }
    );
    const url = st.data?.download?.url;
    if (!url) return res.status(425).send("Not ready");

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

// 404
app.use((req, res) => res.status(404).send("Not Found"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on ${PORT}`));
