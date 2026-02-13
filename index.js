require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");
const { execFile } = require("child_process");
const ffprobePath = require("ffprobe-static").path;

const app = express();
app.use(express.static("public"));
app.use(express.json());

/* ================= UPLOAD ================= */
const upload = multer({
  dest: "/tmp/uploads",
  limits: { fileSize: 1024 * 1024 * 800 } // 800MB
});
const safeUnlink = p => p && fs.existsSync(p) && fs.unlinkSync(p);

/* ================= HELPERS ================= */
const probe = p =>
  new Promise((res, rej) =>
    execFile(
      ffprobePath,
      ["-v","error","-print_format","json","-show_streams","-show_format",p],
      (e,o)=> e?rej(e):res(JSON.parse(o))
    )
  );

const parseFPS = s => {
  if(!s) return 30;
  if(String(s).includes("/")){
    const [n,d]=String(s).split("/").map(Number);
    return d ? n/d : 30;
  }
  return Number(s)||30;
};

/* ================= VIDEO ENHANCE ================= */
app.post("/enhance/video", upload.single("file"), async (req,res)=>{
  const tmp = req.file?.path;
  try{
    if(!tmp) return res.status(400).json({error:"No file"});

    /* ---------- METADATA ---------- */
    const meta = await probe(tmp);
    const v = meta.streams.find(s=>s.codec_type==="video");
    if(!v) throw new Error("No video stream");

    const width = v.width;
    const height = v.height;
    const fps = parseFPS(v.avg_frame_rate||v.r_frame_rate);
    const duration = Number(meta.format.duration);
    const size = Number(meta.format.size);
    const frames = Math.max(1, Math.round(duration * fps));
    const hasAudio = meta.streams.some(s=>s.codec_type==="audio");

    /* ---------- AUTO MODEL ---------- */
    let model = "Proteus";
    let model_option = "prob-3";

    if(width <= 854){
      model = "Iris";
      model_option = "face";
    } else if(width >= 1920 && duration < 120){
      model = "Artemis";
      model_option = "hq";
    }

    /* ---------- AUTO SCALE ---------- */
    let outRes = { width, height };
    if(width < 1280){
      outRes = { width: width * 2, height: height * 2 };
    } else if(width < 1920){
      outRes = {
        width: Math.round(width * 1.5),
        height: Math.round(height * 1.5)
      };
    }

    /* ---------- SAFE PARAMS ---------- */
    const params = {
      denoise: 12,
      sharpen: 8,
      recover: 10,
      grain: 0
    };

    /* ---------- CREATE ---------- */
    const createResp = await axios.post(
      "https://api.topazlabs.com/video/",
      {
        source:{
          container:"mp4",
          size,
          duration,
          frameCount:frames,
          frameRate:fps,
          resolution:{width,height}
        },
        output:{
          container:"mp4",
          resolution:outRes,
          frameRate:fps,
          audioTransfer: hasAudio ? "Copy" : "None",
          audioCodec: hasAudio ? "AAC" : undefined,
          dynamicCompressionLevel:"Low"
        },
        filters:[{ model, model_option, params }]
      },
      { headers:{ "X-API-Key": process.env.TOPAZ_API_KEY } }
    );

    const requestId = createResp.data.requestId;

    /* ---------- ACCEPT ---------- */
    const acceptResp = await axios.patch(
      `https://api.topazlabs.com/video/${requestId}/accept`,
      {},
      { headers:{ "X-API-Key": process.env.TOPAZ_API_KEY } }
    );

    const { urls } = acceptResp.data;
    const partSize = Math.ceil(size / urls.length);
    const uploadResults = [];

    /* ---------- MULTIPART UPLOAD ---------- */
    for(let i=0;i<urls.length;i++){
      const start = i * partSize;
      const end = Math.min(size, (i+1)*partSize) - 1;
      const len = end - start + 1;

      const r = await axios.put(
        urls[i],
        fs.createReadStream(tmp,{start,end}),
        {
          headers:{ "Content-Length": len },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          validateStatus:s=>s>=200&&s<400
        }
      );

      const etag =
        r.headers.etag ||
        r.headers.ETag ||
        r.headers["etag"];

      uploadResults.push({
        partNum: i+1,
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
          "Content-Type":"application/json"
        }
      }
    );

    res.json({ processId: requestId });

  }catch(e){
    console.error("VIDEO ERROR:", e?.response?.data || e.message);
    res.status(400).json({ error:"Video enhance failed" });
  }finally{
    safeUnlink(tmp);
  }
});

/* ================= STATUS ================= */
app.get("/status/:id", async(req,res)=>{
  try{
    const r = await axios.get(
      `https://api.topazlabs.com/video/${req.params.id}/status`,
      { headers:{ "X-API-Key": process.env.TOPAZ_API_KEY } }
    );
    res.json(r.data);
  }catch(e){
    res.status(500).json({status:"error"});
  }
});

/* ================= START ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`🔥 Server running on ${PORT}`));
