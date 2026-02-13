require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");
const { execFile } = require("child_process");
const ffprobePath = require("ffprobe-static").path;

const app = express();
app.use(express.static("public"));

/* ========= UPLOAD ========= */
const upload = multer({
  dest: "/tmp/uploads",
  limits: { fileSize: 1024 * 1024 * 500 }
});
const safeUnlink = p => p && fs.existsSync(p) && fs.unlinkSync(p);

/* ========= HELPERS ========= */
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

/* ========= MODELS ========= */
const VIDEO_MODELS = {
  "prob-4": { label: "Ultra (Best Overall)", scale: 4, params:{ denoise:6, sharpen:8, recover:10, grain:0 }},
  "rhea-1": { label: "Clean Video", scale: 3 },
  "iris-2": { label: "Faces v2", scale: 2 },
  "iris-3": { label: "Faces v3 HQ", scale: 2 },
  "nyx-3": { label: "Anime / Cartoon", scale: 4 },
  "slf-2": { label: "Strong Denoise", scale: 2 },
  "thf-4": { label: "Stabilize", scale: 2 },
  "wonder-1": { label: "Creative", scale: 2 }
};

/* ========= IMAGE ========= */
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

/* ========= VIDEO ========= */
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
    const fps = parseFPS(v.avg_frame_rate || v.r_frame_rate);
    const duration = Number(meta.format.duration);
    const size = Number(meta.format.size);
    const frameCount = Math.round(duration * fps);

    const outRes = {
      width: Math.min(width * model.scale, 3840),
      height: Math.min(height * model.scale, 2160)
    };

    const body = {
      source:{
        container:"mp4",
        size,
        duration,
        frameCount,
        frameRate: fps,
        resolution:{ width, height }
      },
      output:{
        container:"mp4",
        resolution: outRes,
        frameRate: fps,
        audioTransfer: hasAudio ? "Copy" : "None",
        ...(hasAudio ? { audioCodec:"AAC" } : {}),
        videoEncoder:"H264",
        videoProfile:"High",
        dynamicCompressionLevel:"Low"
      },
      filters:[
        {
          model: modelKey,
          ...(model.params ? { params:model.params } : {})
        }
      ]
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

/* ========= STATUS ========= */
app.get("/status/:id", async (req,res)=>{
  const r = await axios.get(
    `https://api.topazlabs.com/video/${req.params.id}/status`,
    { headers:{ "X-API-Key": process.env.TOPAZ_API_KEY } }
  );
  res.json(r.data);
});

/* ========= DOWNLOAD ========= */
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

app.listen(process.env.PORT || 3000, ()=>console.log("Server running"));
