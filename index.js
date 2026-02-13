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
  limits: { fileSize: 1024 * 1024 * 600 } // 600MB
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

/* ================= PRESETS ================= */
const PRESETS = {
  ultra: {
    output: {
      dynamicCompressionLevel: "Low"
    },
    filters: [
      {
        model: "prob-4",
        params: {
          denoise: 8,
          sharpen: 14,
          recover: 18,
          grain: 0
        }
      }
    ]
  },

  astra: {
    output: {
      dynamicCompressionLevel: "High",
      videoBitrate: 540540
    },
    overrides: {
      isPaidDiffusion: true
    },
    filters: [
      { model: "slf-2" },
      {
        model: "apo-8",
        fps: 60,
        slowmo: 1
      }
    ]
  }
};

/* ================= IMAGE ================= */
app.post("/enhance/image", upload.single("file"), async (req,res)=>{
  const tmp = req.file?.path;
  if (!tmp) return res.status(400).send("No image");

  try {
    const form = new (require("form-data"))();
    form.append("image", fs.createReadStream(tmp));
    form.append("model", "Standard V2");
    form.append("scale", "4x");
    form.append("output_format", "png");

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
  if (!tmp) return res.status(400).json({ error: "No video file" });

  try {
    const presetKey = req.body.preset || "ultra";
    const preset = PRESETS[presetKey];

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

    let outRes;
    let outFPS = fpsSrc;

    if (presetKey === "astra") {
      outRes = { width: 1080, height: 1080 };
      outFPS = 60;
    } else {
      outRes = {
        width: Math.min(width * 4, 3840),
        height: Math.min(height * 4, 2160)
      };
    }

    const audioTransfer = hasAudio ? "Copy" : "None";
    const audioCodec = hasAudio ? "AAC" : undefined;

    const body = {
      source: {
        container: "mp4",
        size,
        duration,
        frameCount: frames,
        frameRate: fpsSrc,
        resolution: { width, height }
      },
      output: {
        container: "mp4",
        resolution: outRes,
        frameRate: outFPS,
        audioTransfer,
        ...(audioCodec ? { audioCodec } : {}),
        videoEncoder: "H264",
        videoProfile: "High",
        ...preset.output
      },
      ...(preset.overrides ? { overrides: preset.overrides } : {}),
      filters: preset.filters
    };

    const create = await axios.post(
      "https://api.topazlabs.com/video/",
      body,
      { headers:{ "X-API-Key": process.env.TOPAZ_API_KEY } }
    );

    const requestId = create.data.requestId;

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
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="enhanced-${req.params.id}.mp4"`
  );
  stream.data.pipe(res);
});

/* ================= START ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log("🔥 Server running on",PORT));
