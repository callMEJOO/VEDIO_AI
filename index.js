require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
const { execFile } = require("child_process");
const ffprobePath = require("ffprobe-static").path;

const app = express();
app.use(express.static("public"));

/* ================= UPLOAD ================= */
const upload = multer({
  dest: "/tmp/uploads",
  limits: { fileSize: 1024 * 1024 * 300 } // 300MB
});
const safeUnlink = p => p && fs.existsSync(p) && fs.unlinkSync(p);

/* ================= HELPERS ================= */
const probe = p =>
  new Promise((res, rej) =>
    execFile(
      ffprobePath,
      ["-v","error","-print_format","json","-show_streams","-show_format",p],
      (e,o)=> e ? rej(e) : res(JSON.parse(o))
    )
  );

const parseFPS = s => {
  if (!s) return 30;
  if (String(s).includes("/")) {
    const [n,d] = String(s).split("/").map(Number);
    return d ? n/d : 30;
  }
  return Number(s) || 30;
};

/* ================= IMAGE ================= */
app.post("/enhance/image", upload.single("file"), async (req,res)=>{
  const tmp = req.file?.path;
  if (!tmp) return res.status(400).send("No image");

  try {
    const form = new FormData();
    form.append("image", fs.createReadStream(tmp));
    form.append("model", "Standard V2");
    form.append("scale", "2x");
    form.append("output_format", "jpeg");

    const r = await axios.post(
      "https://api.topazlabs.com/image/v1/enhance",
      form,
      {
        headers: {
          ...form.getHeaders(),
          "X-API-Key": process.env.TOPAZ_API_KEY
        },
        responseType: "arraybuffer"
      }
    );

    res.set("Content-Type", "image/jpeg");
    res.send(r.data);

  } catch (e) {
    console.error("IMAGE ERROR:", e.response?.data || e.message);
    res.status(500).send("Image enhance failed");
  } finally {
    safeUnlink(tmp);
  }
});

/* ================= VIDEO ================= */
app.post("/enhance/video", upload.single("file"), async (req,res)=>{
  const tmp = req.file?.path;
  if (!tmp) return res.status(400).json({ error: "No video file" });

  try {
    /* ---------- METADATA ---------- */
    const meta = await probe(tmp);
    const v = meta.streams.find(s=>s.codec_type==="video");
    if (!v) throw new Error("No video stream");

    const hasAudio = meta.streams.some(s=>s.codec_type==="audio");

    const width = v.width;
    const height = v.height;
    const fps = parseFPS(v.avg_frame_rate || v.r_frame_rate);
    const duration = Number(meta.format.duration);
    const size = Number(meta.format.size);
    const frames = Math.max(1, Math.round(duration * fps));

    /* ---------- SCALE ---------- */
    let outRes = { width, height };
    if (width < 1280) {
      outRes = { width: width * 2, height: height * 2 };
    } else if (width < 1920) {
      outRes = {
        width: Math.round(width * 1.5),
        height: Math.round(height * 1.5)
      };
    }

    /* ---------- AUDIO SETTINGS (FIX) ---------- */
    const audioTransfer = hasAudio ? "Convert" : "None";
    const audioCodec = hasAudio ? "AAC" : undefined;

    /* ---------- CREATE ---------- */
    const create = await axios.post(
      "https://api.topazlabs.com/video/",
      {
        source:{
          container: "mp4",
          size,
          duration,
          frameCount: frames,
          frameRate: fps,
          resolution: { width, height }
        },
        output:{
          container: "mp4",
          resolution: outRes,
          frameRate: fps,
          audioTransfer,
          ...(audioCodec ? { audioCodec } : {}),
          dynamicCompressionLevel: "Low"
        },
        filters:[{
          model: "prob-4",
          params: {
            denoise: 10,
            sharpen: 6,
            recover: 8,
            grain: 0
          }
        }]
      },
      { headers:{ "X-API-Key": process.env.TOPAZ_API_KEY } }
    );

    const requestId = create.data.requestId;

    /* ---------- ACCEPT ---------- */
    const accept = await axios.patch(
      `https://api.topazlabs.com/video/${requestId}/accept`,
      {},
      { headers:{ "X-API-Key": process.env.TOPAZ_API_KEY } }
    );

    const urls = accept.data.urls;
    const partSize = Math.ceil(size / urls.length);
    const uploadResults = [];

    /* ---------- MULTIPART UPLOAD ---------- */
    for (let i = 0; i < urls.length; i++) {
      const start = i * partSize;
      const end = Math.min(size, (i + 1) * partSize) - 1;
      const len = end - start + 1;

      const r = await axios.put(
        urls[i],
        fs.createReadStream(tmp, { start, end }),
        {
          headers:{ "Content-Length": len },
          validateStatus: s => s >= 200 && s < 400
        }
      );

      const etag = r.headers.etag;
      if (!etag) throw new Error("Missing ETag");

      uploadResults.push({
        partNum: i + 1,
        eTag: etag.replace(/"/g,"")
      });
    }

    /* ---------- COMPLETE ---------- */
    await axios.patch(
      `https://api.topazlabs.com/video/${requestId}/complete-upload/`,
      { uploadResults },
      {
        headers:{
          "X-API-Key": process.env.TOPAZ_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    res.json({ processId: requestId });

  } catch (e) {
    console.error("VIDEO ERROR:", e.response?.data || e.message);
    res.status(500).json({
      error: "Video enhance failed",
      details: e.response?.data || e.message
    });
  } finally {
    safeUnlink(tmp);
  }
});

/* ================= STATUS ================= */
app.get("/status/:id", async (req,res)=>{
  try {
    const r = await axios.get(
      `https://api.topazlabs.com/video/${req.params.id}/status`,
      { headers:{ "X-API-Key": process.env.TOPAZ_API_KEY } }
    );
    res.json(r.data);
  } catch {
    res.status(500).json({ status: "error" });
  }
});

/* ================= START ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log("🔥 Server running on", PORT));
