/* ---------------------- VIDEO (async) — Create/Accept/Multipart/Complete ---------------------- */
const path = require("path");
const { execFile } = require("child_process");
const ffprobePath = require("ffprobe-static").path;

function probe(filePath) {
  return new Promise((resolve, reject) => {
    execFile(
      ffprobePath,
      ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath],
      (err, stdout) => {
        if (err) return reject(err);
        try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
      }
    );
  });
}

function parseFPS(str) {
  // "24000/1001" أو "30" -> رقم
  if (!str) return 30;
  if (String(str).includes("/")) {
    const [n, d] = String(str).split("/").map(Number);
    return d ? n / d : Number(n) || 30;
  }
  return Number(str) || 30;
}

function scaleOut(w, h, scaleTxt) {
  const s = (scaleTxt || "2x").replace("x", "");
  const f = Number(s) || 2;
  return { width: Math.max(2, Math.round(w * f)), height: Math.max(2, Math.round(h * f)) };
}

app.post("/enhance/video", upload.single("file"), async (req, res) => {
  const tmp = req.file?.path;
  try {
    if (!req.file || !req.file.path) {
      return res.status(400).json({ error: "No video file uploaded" });
    }

    // 0) استخرج الميتاداتا
    const meta = await probe(tmp);
    const vStream = (meta.streams || []).find(s => s.codec_type === "video") || {};
    const fmt = meta.format || {};
    const sizeBytes = Number(fmt.size || 0);
    const durationSec = Math.max(0.001, Number(fmt.duration || vStream.duration || 0));
    const fps = parseFPS(vStream.avg_frame_rate || vStream.r_frame_rate || fmt.avg_frame_rate);
    const frameCount = Math.max(1, Math.round(durationSec * fps));
    const width = Number(vStream.width || 0);
    const height = Number(vStream.height || 0);
    // امتداد الملف كـ container تقريبي
    const container = (path.extname(req.file.originalname || "").replace(".", "") || fmt.format_name || "mp4").split(",")[0];

    // اختيارات من الواجهة
    const {
      model = "Proteus",
      model_option = "prob-4",
      scale = "2x",
      format = "mp4",
      fps_target
    } = req.body;

    const outRes = scaleOut(width, height, scale);
    const outContainer = (format && format.toLowerCase() === "mp4") ? "mp4" : "mp4";

    // 1) Create
    const createBody = {
      source: {
        container,
        size: sizeBytes,
        duration: durationSec,        // ثواني
        frameCount,
        frameRate: fps,
        resolution: { width, height }
      },
      output: {
        container: outContainer,
        resolution: { width: outRes.width, height: outRes.height }
      },
      // فلتر واحد كافٍ كبداية؛ لو عايز سلسلة فلاتر زود هنا
      filters: [{ model: model_option }]
    };
    // fps_target (لـ Apollo/Chronos) اختياري
    if (fps_target) createBody.output.frameRate = Number(fps_target);

    const createResp = await axios.post(
      "https://api.topazlabs.com/video/",
      createBody,
      { headers: { "X-API-Key": process.env.TOPAZ_API_KEY, "Content-Type": "application/json" } }
    );
    const requestId = createResp.data?.requestId;
    if (!requestId) throw new Error("Topaz did not return requestId");

    // 2) Accept -> multipart urls
    const acceptResp = await axios.patch(
      `https://api.topazlabs.com/video/${requestId}/accept`,
      {},
      { headers: { "X-API-Key": process.env.TOPAZ_API_KEY } }
    );
    const { uploadId, urls } = acceptResp.data || {};
    if (!uploadId || !Array.isArray(urls) || urls.length === 0) {
      throw new Error("Accept did not return multipart URLs");
    }

    // 3) Multipart PUT
    const totalSize = sizeBytes || fs.statSync(tmp).size;
    const parts = urls.length;
    const partSize = Math.ceil(totalSize / parts);
    const uploadResults = [];

    for (let i = 0; i < parts; i++) {
      const start = i * partSize;
      const end = Math.min(totalSize, (i + 1) * partSize) - 1;
      const contentLength = end - start + 1;
      const stream = fs.createReadStream(tmp, { start, end });

      const putResp = await axios.put(urls[i], stream, {
        headers: { "Content-Length": contentLength },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: s => s >= 200 && s < 400
      });

      const eTag = putResp.headers.etag || putResp.headers.ETag || putResp.headers["etag"];
      uploadResults.push({ partNum: i + 1, eTag: (eTag || "").replace(/"/g, "") });
    }

    // 4) Complete upload => يبدأ المعالجة
    await axios.patch(
      `https://api.topazlabs.com/video/${requestId}/complete-upload/`,
      { uploadResults },
      { headers: { "X-API-Key": process.env.TOPAZ_API_KEY, "Content-Type": "application/json" } }
    );

    // 5) رجّع الـ id للـ frontend
    res.json({ processId: requestId });
  } catch (e) {
    const msg = e?.response?.data || e.message || "Video flow error";
    console.error("VIDEO ERROR:", msg);
    res.status(400).json({ error: typeof msg === "string" ? msg : JSON.stringify(msg) });
  } finally {
    if (tmp) fs.unlink(tmp, ()=>{});
  }
});
