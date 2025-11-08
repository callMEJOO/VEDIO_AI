require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");
const { execFile } = require("child_process");
const ffprobePath = require("ffprobe-static").path;

const app = express();

/* ------------ STATIC + HEALTH + LOG ------------ */
app.use(express.static("public"));
app.get("/health", (_req, res) => res.json({ ok: true }));
app.use((req, _res, next) => { console.log(`${req.method} ${req.path}`); next(); });

if (!process.env.TOPAZ_API_KEY) {
  console.warn("[WARN] TOPAZ_API_KEY is missing! Image/Video calls will fail.");
}

/* ------------ UPLOAD TMP ------------ */
const upload = multer({
  dest: "/tmp/uploads",
  limits: { fileSize: 1024 * 1024 * 512 } // 512MB
});
const safeUnlink = p => { if (p && fs.existsSync(p)) fs.unlink(p, ()=>{}); };

/* ------------ HELPERS ------------ */
function probe(filePath) {
  return new Promise((resolve, reject) => {
    execFile(
      ffprobePath,
      ["-v","error","-print_format","json","-show_streams","-show_format",filePath],
      (err, stdout) => {
        if (err) return reject(err);
        try { resolve(JSON.parse(stdout)); } catch(e){ reject(e); }
      }
    );
  });
}
function parseFPS(str){
  if(!str) return 30;
  if(String(str).includes("/")){
    const [n,d] = String(str).split("/").map(Number);
    return d ? n/d : Number(n) || 30;
  }
  return Number(str)||30;
}
function scaleOut(w,h,scaleTxt){
  const s = (scaleTxt||"2x").replace("x","");
  const f = Number(s)||2;
  return { width: Math.max(2,Math.round(w*f)), height: Math.max(2,Math.round(h*f)) };
}

/* ------------ IMAGE SYNC API (أخطاء مقروءة) ------------ */
const IMG_CT = { jpeg:"image/jpeg", jpg:"image/jpeg", png:"image/png", webp:"image/webp", tiff:"image/tiff", tif:"image/tiff" };

app.post("/enhance/image", upload.single("file"), async(req,res)=>{
  const tmp = req.file?.path;
  try{
    if(!req.file?.path) return res.status(400).json({ error: "No image uploaded" });

    const {model="Standard V2",scale="2x",format="jpeg"} = req.body;
    const form = new FormData();
    form.append("image", fs.createReadStream(tmp));
    form.append("model", model);
    form.append("scale", scale);
    form.append("output_format", format);

    const r = await axios.post(
      "https://api.topazlabs.com/image/v1/enhance",
      form,
      {
        headers:{...form.getHeaders(),"X-API-Key":process.env.TOPAZ_API_KEY},
        responseType:"arraybuffer",
        maxBodyLength:Infinity, maxContentLength:Infinity,
        validateStatus: s => s >= 200 && s < 300
      }
    );

    const ct = IMG_CT[(format||"").toLowerCase()] || "application/octet-stream";
    res.setHeader("Content-Type",ct);
    res.setHeader("Content-Disposition",`attachment; filename="enhanced.${format}"`);
    res.send(Buffer.from(r.data,"binary"));
  }catch(e){
    const status = e?.response?.status || 400;
    let payload = e?.response?.data;
    if (payload && payload instanceof Buffer) {
      try { payload = JSON.parse(payload.toString("utf8")); }
      catch { payload = payload.toString("utf8"); }
    }
    let message = "Image enhance failed";
    if (typeof payload === "string") message = payload;
    else if (payload?.error) message = payload.error;
    else if (payload?.message) message = payload.message;
    else if (payload) message = JSON.stringify(payload);

    console.error("IMAGE ERROR:", status, message);
    res.status(status).json({ error: message, status });
  }finally{ safeUnlink(tmp); }
});

/* ------------ VIDEO ASYNC API ------------ */
/*
Flow:
1) POST /video/ -> requestId (نرسل source + output + filters)
2) PATCH /video/{id}/accept -> upload URLs (multipart)
3) PUT parts (موازي)
4) PATCH /video/{id}/complete-upload/ -> يبدأ المعالجة
5) GET /video/{id}/status -> download.url عند جاهزية
*/
app.post("/enhance/video", upload.single("file"), async(req,res)=>{
  const tmp = req.file?.path;
  try{
    if(!req.file?.path) return res.status(400).json({error:"No video file uploaded"});

    // FFprobe metadata
    const meta = await probe(tmp);
    const v = (meta.streams||[]).find(s=>s.codec_type==="video")||{};
    const fmt = meta.format||{};
    const sizeBytes   = Number(fmt.size||0);
    const durationSec = Math.max(0.001, Number(fmt.duration||v.duration||0));
    const fps         = parseFPS(v.avg_frame_rate||v.r_frame_rate||fmt.avg_frame_rate);
    const frameCount  = Math.max(1,Math.round(durationSec*fps));
    const width       = Number(v.width||0);
    const height      = Number(v.height||0);
    const container   = (path.extname(req.file.originalname||"").replace(".","")||fmt.format_name||"mp4").split(",")[0];

    // frontend options
    const {
      model="Proteus",
      model_option="prob-4",
      scale="2x",
      format="mp4",
      fps_target,
      // تحكّمات إضافية شبيهة بتوباز
      sharpen,
      denoise,
      recover,
      grain
    } = req.body;

    const outRes  = scaleOut(width,height,scale);
    const outFps  = fps_target? Number(fps_target) : Math.max(1,Math.round(fps));
    const hasAudio = (meta.streams||[]).some(s=>s.codec_type==="audio");

    const audioTransfer = hasAudio ? "Convert" : "None";
    const audioCodec    = hasAudio ? "AAC" : undefined;   // AAC | AC3 | PCM

    // params (clamped 0..100)
    const params = {};
    const clamp = (v)=> Math.max(0, Math.min(100, Number(v)));
    if (sharpen !== undefined && sharpen !== "") params.sharpen = clamp(sharpen);
    if (denoise !== undefined && denoise !== "") params.denoise = clamp(denoise);
    if (recover !== undefined && recover !== "") params.recover = clamp(recover);
    if (grain   !== undefined && grain   !== "") params.grain   = clamp(grain);

    /* ---------- 1) CREATE ---------- */
    const createBody = {
      source:{
        container,
        size:sizeBytes,
        duration:durationSec,
        frameCount,
        frameRate:fps,
        resolution:{width,height}
      },
      output:{
        container:"mp4",
        resolution:{width:outRes.width,height:outRes.height},
        frameRate:outFps,
        audioTransfer,
        ...(audioCodec?{audioCodec}:{}) ,
        dynamicCompressionLevel:"Mid"
      },
      filters:[{
        model: model_option,
        ...(Object.keys(params).length ? { params } : {})
      }]
    };

    const createResp = await axios.post(
      "https://api.topazlabs.com/video/",
      createBody,
      {headers:{"X-API-Key":process.env.TOPAZ_API_KEY,"Content-Type":"application/json"}}
    );
    const requestId = createResp.data?.requestId;
    if(!requestId) throw new Error("Topaz did not return requestId");

    /* ---------- 2) ACCEPT -> URLs ---------- */
    const acceptResp = await axios.patch(
      `https://api.topazlabs.com/video/${requestId}/accept`,
      {},
      {headers:{"X-API-Key":process.env.TOPAZ_API_KEY}}
    );
    const {uploadId,urls} = acceptResp.data||{};
    if(!uploadId || !Array.isArray(urls) || urls.length===0)
      throw new Error("Accept did not return multipart URLs");

    /* ---------- 3) MULTIPART PUT (parallel) ---------- */
    const totalSize = sizeBytes || fs.statSync(tmp).size;
    const parts     = urls.length;
    const partSize  = Math.ceil(totalSize/parts);

    const MAX_CONCURRENCY = Math.min(6, parts); // عدّل لو عندك باقة أعلى
    const uploadResults = new Array(parts);

    let active = 0, nextIndex = 0;
    await new Promise((resolve, reject) => {
      const launch = () => {
        while (active < MAX_CONCURRENCY && nextIndex < parts) {
          const i = nextIndex++;
          active++;
          const start = i * partSize;
          const end   = Math.min(totalSize, (i + 1) * partSize) - 1;
          const contentLength = end - start + 1;
          const stream = fs.createReadStream(tmp, { start, end });

          axios.put(urls[i], stream, {
            headers: { "Content-Length": contentLength },
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            validateStatus: s => s >= 200 && s < 400
          })
          .then(r => {
            const eTag = (r.headers.etag || r.headers.ETag || r.headers["etag"] || "").replace(/"/g, "");
            uploadResults[i] = { partNum: i + 1, eTag };
          })
          .catch(reject)
          .finally(() => {
            active--;
            if (nextIndex < parts) launch();
            else if (active === 0) resolve();
          });
        }
      };
      launch();
    });

    /* ---------- 4) COMPLETE UPLOAD ---------- */
    await axios.patch(
      `https://api.topazlabs.com/video/${requestId}/complete-upload/`,
      {uploadResults},
      {headers:{"X-API-Key":process.env.TOPAZ_API_KEY,"Content-Type":"application/json"}}
    );

    res.json({processId:requestId});
  }catch(e){
    const payload = e?.response?.data;
    const msg = (typeof payload === "string") ? payload
            : (payload?.error || payload?.message || e.message || "Video flow error");
    console.error("VIDEO ERROR:", msg);
    res.status(e?.response?.status || 400).json({error: msg});
  }finally{ safeUnlink(tmp); }
});

/* ------------ STATUS (لوج تقدّم) ------------ */
app.get("/status/:id", async (req, res) => {
  try {
    const st = await axios.get(
      `https://api.topazlabs.com/video/${req.params.id}/status`,
      { headers: { "X-API-Key": process.env.TOPAZ_API_KEY } }
    );
    console.log(
      "STATUS",
      req.params.id,
      "->",
      st.data?.status,
      st.data?.progress ? JSON.stringify(st.data.progress) : "",
      st.data?.download ? "has download" : ""
    );
    res.json(st.data);
  } catch (e) {
    console.error("STATUS ERROR:", e?.response?.data || e.message);
    res.status(500).json({ status: "error", error: e?.response?.data || e.message });
  }
});

/* ------------ DOWNLOAD (fallback) ------------ */
app.get("/video/download/:id", async(req,res)=>{
  try{
    const st = await axios.get(
      `https://api.topazlabs.com/video/${req.params.id}/status`,
      {headers:{"X-API-Key":process.env.TOPAZ_API_KEY}}
    );
    const url = st.data?.download?.url;
    if(!url) return res.status(425).send("Not ready");

    const filename = `enhanced_${req.params.id}.mp4`;
    const streamResp = await axios.get(url,{responseType:"stream"});
    res.setHeader("Content-Type","video/mp4");
    res.setHeader("Content-Disposition",`attachment; filename="${filename}"`);
    streamResp.data.pipe(res);
  }catch(e){
    console.error("DOWNLOAD ERROR:",e?.response?.data||e.message);
    res.status(500).send("Download error");
  }
});

/* ------------ 404 + START ------------ */
app.use((req,res)=>res.status(404).send("Not Found"));
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log(`Listening on ${PORT}`));
