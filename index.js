require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
const path = require("path");

const app = express();
app.use(express.static("public"));

const upload = multer({ dest: "/tmp/uploads" });

const IMG_CT = {
  jpeg: "image/jpeg",
  jpg:  "image/jpeg",
  png:  "image/png",
  webp: "image/webp",
};

function safeUnlink(p) { if (p && fs.existsSync(p)) fs.unlink(p, ()=>{}); }

/* ---------- IMAGE (sync) ---------- */
app.post("/enhance/image", upload.single("file"), async (req, res) => {
  const tmp = req.file?.path;
  try {
    const { model = "Standard V2", scale = "2x", format = "jpeg" } = req.body;

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

    const ct = IMG_CT[format?.toLowerCase()] || "application/octet-stream";
    res.setHeader("Content-Type", ct);
    res.setHeader("Content-Disposition", `attachment; filename="enhanced.${format}"`);
    res.send(Buffer.from(r.data, "binary"));
  } catch (e) {
    console.error(e?.response?.data || e.message);
    res.status(500).send("Image processing error");
  } finally {
    safeUnlink(tmp);
  }
});

/* ---------- VIDEO (async) ---------- */
app.post("/enhance/video", upload.single("file"), async (req, res) => {
  const tmp = req.file?.path;
  try {
    const { model = "Standard V2", scale = "2x", format = "mp4" } = req.body;

    // 1) Start async job
    const startForm = new FormData();
    startForm.append("model", model);
    startForm.append("scale", scale);
    startForm.append("output_format", format);

    const start = await axios.post(
      "https://api.topazlabs.com/video/v1/enhance/async",
      startForm,
      { headers: { ...startForm.getHeaders(), "X-API-Key": process.env.TOPAZ_API_KEY } }
    );

    const processId = start.data.process_id;

    // 2) Upload source video to that job
    const uploadForm = new FormData();
    uploadForm.append("video", fs.createReadStream(tmp));

    await axios.post(
      `https://api.topazlabs.com/video/v1/enhance/${processId}/upload`,
      uploadForm,
      { headers: { ...uploadForm.getHeaders(), "X-API-Key": process.env.TOPAZ_API_KEY } }
    );

    res.json({ processId });
  } catch (e) {
    console.error(e?.response?.data || e.message);
    res.status(500).send("Video start/upload error");
  } finally {
    safeUnlink(tmp);
  }
});

/* Poll job status (client uses it for progress) */
app.get("/status/:id", async (req, res) => {
  try {
    const st = await axios.get(
      `https://api.topazlabs.com/video/v1/status/${req.params.id}`,
      { headers: { "X-API-Key": process.env.TOPAZ_API_KEY } }
    );
    res.json(st.data);
  } catch (e) {
    res.status(500).json({ status: "error" });
  }
});

/* Server-side download to force “Save As” */
app.get("/video/download/:id", async (req, res) => {
  try {
    const st = await axios.get(
      `https://api.topazlabs.com/video/v1/status/${req.params.id}`,
      { headers: { "X-API-Key": process.env.TOPAZ_API_KEY } }
    );

    if (st.data.status !== "completed" || !st.data.output_url) {
      return res.status(425).send("Not ready");
    }

    const url = st.data.output_url;
    const filename = `enhanced_${req.params.id}.mp4`;

    const streamResp = await axios.get(url, { responseType: "stream" });
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    streamResp.data.pipe(res);
  } catch (e) {
    console.error(e.message);
    res.status(500).send("Download error");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on ${PORT}`));
