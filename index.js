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

/* ========== UPLOAD ========== */
const upload = multer({
  dest: "/tmp/uploads",
  limits: { fileSize: 1024 * 1024 * 500 } // 500MB
});
const safeUnlink = p => p && fs.existsSync(p) && fs.unlinkSync(p);

/* ========== HELPERS ========== */
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

/* ========== IMAGE (ULTRA) ========== */
app.post("/enhance/image", upload.single("file"), async (req,res)=>{
  const tmp = req.file?.path;
  if (!tmp) return res.status(400).send("No image");

  try {
    const form = new FormData();
    form.append("image", fs.createReadStream(tmp));
    form.append("model", "Standard V2");
    form.append("scale", "4x");          // 🔥 أقصى Scale
    form.append("output_format", "png"); // 🔥 أعلى جودة

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

    res.set("Content-Type", "image/png");
    res.send(r.data);

  } catch (e) {
    res.status(500).send("Image enhance failed");
  } finally {
    safeUnlink(tmp);
  }
});

/* ========== VIDEO (ULTRA REAL) ========== */
app.post("/enhance/video", upload.single("file"), async (req,res)=>{
  const tmp = req.file?.path;
  if (!tmp) return res.status(400).json({ error: "No video file" });

  try {
    const meta = await probe(tmp);
    const v = meta.streams.find(s=>s.codec_type==="video");
    if (!v) throw new Error("No video stream");

    const hasAudio = meta.streams.some(s=>s.codec_type==="audio");

    const width = v.width;
    const height = v.height;
    const fpsSrc = parseFPS(v.avg_frame_rate || v.r_frame_rate);
    const duration = Number(meta.format.duration);
    const size = Number(meta.format.size);
    const frames = Math.max(1, Math.round(duration * fpsSrc));

    /* FPS حقيقي من الواجهة */
    const userFps =
      req.body.fps && req.body.fps !== "auto"
        ? Number(req.body.fps)
        : fpsSrc;

    /* ULTRA SCALE */
    let outRes = { width, height };
    if (width < 1280) {
      outRes = { width: width * 3, height: height * 3 };
    } else if (width < 1920) {
      outRes = { width: width * 2, height: height * 2 };
    }

    outRes.width = Math.min(outRes.width, 3840);
    outRes.height = Math.min(outRes.height, 2160);

    const audioTransfer = hasAudio ? "Convert" : "None";
    const audioCodec = hasAudio ? "AAC" : undefined;

    /* CREATE JOB */
    const create = await axios.post(
      "https://api.topazlabs.com/video/",
      {
        source:{
          container:"mp4",
          size,
          duration,
          frameCount: frames,
          frameRate: fpsSrc,
          resolution:{ width, height }
        },
        output:{
          container:"mp4",
          resolution: outRes,
          frameRate: userFps,                 // 🔥 FPS حقيقي
          audioTransfer,
          ...(audioCodec ? { audioCodec } : {}),
          dynamicCompressionLevel:"Low"       // 🔥 أقل ضغط
        },
        filters:[{
          model:"prob-4",
          params:{
            denoise:10,
            sharpen:12,
            recover:15,   // 🔥 أعلى Recover
            grain:0
          }
        }]
      },
      { headers:{ "X-API-Key": process.env.TOPAZ_API_KEY } }
    );

    const requestId = create.data.requestId;

    /* ACCEPT */
    const accept = await axios.patch(
      `https://api.topazlabs.com/video/${requestId}/accept`,
      {},
      { headers:{ "X-API-Key": process.env.TOPAZ_API_KEY } }
    );

    const urls = accept.data.urls;
    const partSize = Math.ceil(size / urls.length);
    const uploadResults = [];

    for (let i=0;i<urls.length;i++){
      const start = i * partSize;
      const end = Math.min(size,(i+1)*partSize)-1;
      const len = end-start+1;

      const r = await axios.put(
        urls[i],
        fs.createReadStream(tmp,{start,end}),
        {
          headers:{ "Content-Length":len },
          validateStatus:s=>s>=200 && s<400
        }
      );

      uploadResults.push({
        partNum:i+1,
        eTag:r.headers.etag.replace(/"/g,"")
      });
    }

    await axios.patch(
      `https://api.topazlabs.com/video/${requestId}/complete-upload/`,
      { uploadResults },
      {
        headers:{
          "X-API-Key": process.env.TOPAZ_API_KEY,
          "Content-Type":"application/json"
        }
      }
    );

    res.json({ processId: requestId });

  } catch (e) {
    res.status(500).json({ error:"Video enhance failed" });
  } finally {
    safeUnlink(tmp);
  }
});

/* ========== STATUS ========== */
app.get("/status/:id", async (req,res)=>{
  const r = await axios.get(
    `https://api.topazlabs.com/video/${req.params.id}/status`,
    { headers:{ "X-API-Key": process.env.TOPAZ_API_KEY } }
  );
  res.json(r.data);
});

/* ========== DOWNLOAD (PROXY) ========== */
app.get("/video/download/:id", async (req,res)=>{
  const st = await axios.get(
    `https://api.topazlabs.com/video/${req.params.id}/status`,
    { headers:{ "X-API-Key": process.env.TOPAZ_API_KEY } }
  );

  const url = st.data?.download?.url;
  if (!url) return res.status(404).send("Not ready");

  const stream = await axios.get(url,{responseType:"stream"});
  res.setHeader("Content-Type","video/mp4");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="enhanced-ultra.mp4"`
  );
  stream.data.pipe(res);
});

/* ========== START ========== */
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log("🔥 ULTRA server running on",PORT));
