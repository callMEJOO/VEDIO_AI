require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

const app = express();

// static UI
app.use(express.static("public"));

// quick health
app.get("/health", (_req, res) => res.json({ ok: true }));

// simple log
app.use((req, _res, next) => { console.log(`${req.method} ${req.path}`); next(); });

// temp folder on Render + 512MB cap
const upload = multer({
  dest: "/tmp/uploads",
  limits: { fileSize: 1024 * 1024 * 512 }
});
const safeUnlink = p => { if (p && fs.existsSync(p)) fs.unlink(p, ()=>{}); };

const IMG_CT = { jpeg:"image/jpeg", jpg:"image/jpeg", png:"image/png", webp:"image/webp", tiff:"image/tiff", tif:"image/tiff" };

/* ---------------------- IMAGE (sync) ---------------------- */
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

/* ---------------------- VIDEO (async) - robust upload flow ---------------------- */
app.post("/enhance/video", upload.single("file"), async (req, res) => {
  const tmp = req.file?.path;
  try {
    if (!req.file || !req.file.path) {
      return res.status(400).json({ error: "No video file uploaded" });
    }
    const {
      model = "Proteus",
      model_option,
      scale = "2x",
      format = "mp4",
      fps_target
    } = req.body;

    // 1) start job
    const startForm = new FormData();
    startForm.append("model", model);
    if (model_option) startForm.append("model_option", model_option);
    if (scale) startForm.append("scale", scale);
    if (fps_target) startForm.append("fps_target", fps_target);
    startForm.append("output_format", format);

    const start = await axios.post(
      "https://api.topazlabs.com/video/v1/enhance/async",
      startForm,
      { headers: { ...startForm.getHeaders(), "X-API-Key": process.env.TOPAZ_API_KEY } }
    );

    const { process_id, upload_url } = start.data || {};
    if (!process_id) throw new Error("Topaz did not return process_id");

    // helpers
    const putToUrl = async (url) => {
      console.log("TRY PUT upload_url");
      await axios.put(url, fs.createReadStream(tmp), {
        headers: { "Content-Type": "application/octet-stream" },
        maxBodyLength: Infinity, maxContentLength: Infinity
      });
    };
    const postToUpload = async () => {
      console.log("TRY POST /upload");
      const up = new FormData();
      up.append("video", fs.createReadStream(tmp));
      return axios.post(
        `https://api.topazlabs.com/video/v1/enhance/${process_id}/upload`,
        up,
        { headers: { ...up.getHeaders(), "X-API-Key": process.env.TOPAZ_API_KEY },
          maxBodyLength: Infinity, maxContentLength: Infinity }
      );
    };

    // 2) upload: upload_url -> /upload -> status.upload_url
    let uploaded = false;
    let lastTried = "";

    try {
      if (upload_url) {
        lastTried = `PUT ${upload_url}`;
        await putToUrl(upload_url);
        uploaded = true;
      }
    } catch (e) {
      console.error("UPLOAD PUT (start.upload_url) failed:", e?.response?.status || e.message);
    }

    if (!uploaded) {
      try {
        lastTried = `POST /enhance/${process_id}/upload`;
        await postToUpload();
        uploaded = true;
      } catch (e) {
        console.error("UPLOAD POST /upload failed:", e?.response?.status || e.message);
        if (e?.response?.status === 404) {
          try {
            const st = await axios.get(
              `https://api.topazlabs.com/video/v1/status/${process_id}`,
              { headers: { "X-API-Key": process.env.TOPAZ_API_KEY } }
            );
            if (st.data?.upload_url) {
              lastTried = `PUT ${st.data.upload_url} (from status)`;
              await putToUrl(st.data.upload_url);
              uploaded = true;
            }
          } catch (e2) {
            console.error("STATUS/PUT (status.upload_url) failed:", e2?.response?.status || e2.message);
          }
        }
      }
    }

    if (!uploaded) {
      return res.status(404).json({ error: `Not Found while uploading video (last tried: ${lastTried || "none"})` });
    }

    res.json({ processId: process_id });
  } catch (e) {
    const msg = e?.response?.data || e.message || "Video start/upload error";
    console.error("VIDEO ERROR:", msg);
    res.status(400).json({ error: typeof msg === "string" ? msg : JSON.stringify(msg) });
  } finally {
    safeUnlink(tmp);
  }
});

/* poll status */
app.get("/status/:id", async (req, res) => {
  try {
    const st = await axios.get(
      `https://api.topazlabs.com/video/v1/status/${req.params.id}`,
      { headers: { "X-API-Key": process.env.TOPAZ_API_KEY } }
    );
    res.json(st.data);
  } catch (e) {
    console.error("STATUS ERROR:", e?.response?.data || e.message);
    res.status(500).json({ status: "error" });
  }
});

/* download video with attachment */
app.get("/video/download/:id", async (req, res) => {
  try {
    const st = await axios.get(
      `https://api.topazlabs.com/video/v1/status/${req.params.id}`,
      { headers: { "X-API-Key": process.env.TOPAZ_API_KEY } }
    );
    if (st.data.status !== "completed" || !st.data.output_url) return res.status(425).send("Not ready");

    const url = st.data.output_url;
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
