require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");
const { execFile } = require("child_process");
const ffprobePath = require("ffprobe-static").path;

const app = express();
app.use(express.static("public"));

/* ================= UPLOAD ================= */
const upload = multer({
  dest: "/tmp/uploads",
  limits: { fileSize: 1024 * 1024 * 600 }
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

/* ================= MODELS ================= */
const VIDEO_MODELS = {
  "prob-4":       { type:"normal", scale:2 },
  "prob-4-4k":    { type:"normal", scale:4 },
  "rhea-1":       { type:"normal", scale:3 },
  "iris-2":       { type:"normal", scale:2 },
  "iris-3":       { type:"normal", scale:2 },
  "nyx-3":        { type:"normal", scale:4 },
  "thf-4":        { type:"normal", scale:2 },

  // 🚀 ASTRA FPS
  "astra-60": {
    type:"astra",
    scale:2,
    fps:60
  }
};

/* ================= IMAGE ================= */
app.post("/enhance/image", upload.single("file"), async (req,res)=>{
  const tmp = req.file?.path;
  if (!tmp) return res.status(400).send("No image");

  try {
    const FormData = require("form-data");
    const form = new FormData();
    form.append("image", fs.createReadStream(tmp));
    form.append("model", "Standard V2");
    form.append("scale", "2x");
    form.append("output_format", "png");

    const r = await axios.post(
      "https://api.topazlabs.com/image/v1/enhance",
      form,
      {
        headers:{ ...form.getHeaders(), "X-API-Key": process.env.TOPAZ_API_KEY },
        responseType:"arraybuffer"
      }
    );

    res.set("Content-Type","image/png");
    res.send(r.data);

  } catch {
    res.status(500).send("Image enhance failed");
  } finally {
    safeUnlink(tmp);
  }
});

/* ================= VIDEO ================= */
app.post("/enhance/video", upload.single("file"), async (req,res)=>{
  const tmp = req.file?.path;
  if (!tmp) return res.status(400).json({ error:"No video" });

  try {
    const modelKey = req.body.model || "prob-4";
    const model = VIDEO_MODELS[modelKey];
    if (!model) return res.status(400).json({ error:"Unsupported model" });

    const meta = await probe(tmp);
    const v = meta.streams.find(s=>s.codec_type==="video");
    if (!v) throw new Error("No video stream");

    const hasAudio = meta.streams.some(s=>s.codec_type==="audio");
    const width = v.width;
    const height = v.height;
    const fpsSrc = parseFPS(v.avg_frame_rate || v.r_frame_rate);
    const duration = Number(meta.format.duration);
    const size = Number(meta.format.size);
    const frameCount = Math.round(duration * fpsSrc);

    const outRes = {
      width: Math.min(width * model.scale, 3840),
      height: Math.min(height * model.scale, 2160)
    };

    let filters = [];
    let outputFPS = fpsSrc;

    if (model.type === "astra") {
      filters = [
        { model:"slf-2" },
        { model:"apo-8", fps:60, slowmo:1 }
      ];
      outputFPS = 60;
    } else {
      filters = [{ model: modelKey }];
    }

    const body = {
      source:{
        container:"mp4",
        size,
        duration,
        frameCount,
        frameRate: fpsSrc,
        resolution:{ width, height }
      },
      output:{
        container:"mp4",
        resolution: outRes,
        frameRate: outputFPS,
        audioTransfer: hasAudio ? "Copy" : "None",
        ...(hasAudio ? { audioCodec:"AAC" } : {}),
        videoEncoder:"H264",
        videoProfile:"High",
        dynamicCompressionLevel:"High",
        videoBitrate: model.type==="astra" ? 540540 : undefined
      },
      ...(model.type==="astra" ? {
        overrides:{ isPaidDiffusion:true },
        notifications:{
          webhookUrl:"https://astra.app/api/hooks/video-status"
        }
      } : {}),
      filters
    };

    const create = await axios.post(
      "https://api.topazlabs.com/video/",
      body,
      { headers:{ "X-API-Key": process.env.TOPAZ_API_KEY } }
    );

    const processId = create.data.requestId || create.data.id;
    if (!processId) throw new Error("No processId");

    const accept = await axios.patch(
      `https://api.topazlabs.com/video/${processId}/accept`,
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
        { headers:{ "Content-Length":len } }
      );

      uploadResults.push({ partNum:i+1, eTag:r.headers.etag.replace(/"/g,"") });
    }

    await axios.patch(
      `https://api.topazlabs.com/video/${processId}/complete-upload/`,
      { uploadResults },
      { headers:{ "X-API-Key": process.env.TOPAZ_API_KEY } }
    );

    res.json({ processId });

  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error:"Video enhance failed" });
  } finally {
    safeUnlink(tmp);
  }
});

/* ================= STATUS ================= */
app.get("/status/:id", async (req,res)=>{
  const r = await axios.get(
    `https://api.topazlabs.com/video/${req.params.id}/status`,
    { headers:{ "X-API-Key": process.env.TOPAZ_API_KEY } }
  );
  res.json(r.data);
});

/* ================= DOWNLOAD ================= */
app.get("/video/download/:id", async (req,res)=>{
  const st = await axios.get(
    `https://api.topazlabs.com/video/${req.params.id}/status`,
    { headers:{ "X-API-Key": process.env.TOPAZ_API_KEY } }
  );
  const url = st.data?.download?.url;
  if (!url) return res.status(404).send("Not ready");

  const stream = await axios.get(url,{responseType:"stream"});
  res.setHeader("Content-Type","video/mp4");
  res.setHeader("Content-Disposition","attachment; filename=enhanced.mp4");
  stream.data.pipe(res);
});

app.listen(process.env.PORT || 3000, ()=>console.log("🚀 Server running"));
