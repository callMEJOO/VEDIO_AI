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
app.use(express.static("public"));
app.use(express.json());

const upload = multer({ dest: "/tmp/uploads", limits: { fileSize: 1024 * 1024 * 800 } });
const safeUnlink = p => p && fs.existsSync(p) && fs.unlinkSync(p);

/* ---------- HELPERS ---------- */
const probe = p => new Promise((res, rej) =>
  execFile(ffprobePath, ["-v","error","-print_format","json","-show_streams","-show_format",p],
    (e,o)=> e?rej(e):res(JSON.parse(o)))
);
const parseFPS = s => {
  if(!s) return 30;
  if(String(s).includes("/")) {
    const [n,d]=String(s).split("/").map(Number);
    return d? n/d : 30;
  }
  return Number(s)||30;
};

/* ---------- IMAGE ---------- */
app.post("/enhance/image", upload.single("file"), async(req,res)=>{
  const tmp=req.file?.path;
  try{
    const form=new FormData();
    form.append("image",fs.createReadStream(tmp));
    form.append("model","Standard V2");
    form.append("scale","2x");
    form.append("output_format","jpeg");

    const r=await axios.post(
      "https://api.topazlabs.com/image/v1/enhance",
      form,
      {headers:{...form.getHeaders(),"X-API-Key":process.env.TOPAZ_API_KEY},
       responseType:"arraybuffer"}
    );

    res.set("Content-Type","image/jpeg");
    res.send(r.data);
  }catch(e){
    res.status(400).json({error:"Image failed"});
  }finally{safeUnlink(tmp);}
});

/* ---------- VIDEO (FESH5AAA) ---------- */
app.post("/enhance/video", upload.single("file"), async(req,res)=>{
  const tmp=req.file?.path;
  try{
    const meta=await probe(tmp);
    const v=meta.streams.find(s=>s.codec_type==="video");
    const width=v.width, height=v.height;
    const fps=parseFPS(v.avg_frame_rate||v.r_frame_rate);
    const duration=Number(meta.format.duration);
    const size=Number(meta.format.size);
    const frames=Math.round(duration*fps);

    /* 🧠 AUTO MODEL */
    let model="Proteus", model_option="prob-3";
    if(width<=854){ model="Iris"; model_option="face"; }
    else if(width>=1920 && duration<120){ model="Artemis"; model_option="hq"; }

    /* 📐 AUTO SCALE */
    let outRes={width,height};
    if(width<1280){ outRes={width:width*2,height:height*2}; }
    else if(width<1920){ outRes={width:Math.round(width*1.5),height:Math.round(height*1.5)}; }

    const params={ denoise:12, sharpen:8, recover:10, grain:0 };

    const createBody={
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
        audioTransfer:"Copy",
        audioCodec:"AAC",
        dynamicCompressionLevel:"Low"
      },
      filters:[{ model, model_option, params }]
    };

    const c=await axios.post(
      "https://api.topazlabs.com/video/",
      createBody,
      {headers:{"X-API-Key":process.env.TOPAZ_API_KEY}}
    );

    const id=c.data.requestId;

    const a=await axios.patch(
      `https://api.topazlabs.com/video/${id}/accept`,
      {},
      {headers:{"X-API-Key":process.env.TOPAZ_API_KEY}}
    );

    const {urls}=a.data;
    const part=Math.ceil(size/urls.length);

    await Promise.all(urls.map((u,i)=>{
      const s=i*part, e=Math.min(size,(i+1)*part)-1;
      return axios.put(u,fs.createReadStream(tmp,{start:s,end:e}),
        {headers:{"Content-Length":e-s+1}});
    }));

    await axios.patch(
      `https://api.topazlabs.com/video/${id}/complete-upload/`,
      {},
      {headers:{"X-API-Key":process.env.TOPAZ_API_KEY}}
    );

    res.json({processId:id});
  }catch(e){
    res.status(400).json({error:"Video failed"});
  }finally{safeUnlink(tmp);}
});

/* ---------- STATUS ---------- */
app.get("/status/:id", async(req,res)=>{
  const r=await axios.get(
    `https://api.topazlabs.com/video/${req.params.id}/status`,
    {headers:{"X-API-Key":process.env.TOPAZ_API_KEY}}
  );
  res.json(r.data);
});

app.listen(3000,()=>console.log("🔥 READY ON 3000"));
