require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

const app = express();
app.use(express.static("public"));

// Multer temp folder
const upload = multer({ dest: "/tmp/uploads" });

// *** IMAGE ENHANCE ***
app.post("/enhance/image", upload.single("file"), async (req, res) => {
  try {
    const form = new FormData();
    form.append("image", fs.createReadStream(req.file.path));
    form.append("model", req.body.model);
    form.append("scale", req.body.scale);
    form.append("output_format", req.body.format);

    const r = await axios.post("https://api.topazlabs.com/image/v1/enhance", form, {
      headers: { ...form.getHeaders(), "X-API-Key": process.env.TOPAZ_API_KEY },
      responseType: "arraybuffer"
    });

    res.set("Content-Type", "image/jpeg");
    res.send(Buffer.from(r.data, "binary"));
  } catch (err) {
    res.status(500).send("Error");
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

// *** VIDEO ENHANCE (ASYNC) ***
app.post("/enhance/video", upload.single("file"), async (req, res) => {
  try {
    const startForm = new FormData();
    startForm.append("model", req.body.model);
    startForm.append("scale", req.body.scale);
    startForm.append("output_format", req.body.format);

    const start = await axios.post(
      "https://api.topazlabs.com/video/v1/enhance/async",
      startForm,
      { headers: { ...startForm.getHeaders(), "X-API-Key": process.env.TOPAZ_API_KEY } }
    );

    const processId = start.data.process_id;

    const uploadForm = new FormData();
    uploadForm.append("video", fs.createReadStream(req.file.path));

    await axios.post(
      `https://api.topazlabs.com/video/v1/enhance/${processId}/upload`,
      uploadForm,
      { headers: { ...uploadForm.getHeaders(), "X-API-Key": process.env.TOPAZ_API_KEY } }
    );

    fs.unlink(req.file.path, () => {});
    res.json({ processId });
  } catch (e) {
    res.status(500).send("Video Error");
  }
});

// POLL STATUS
app.get("/status/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const st = await axios.get(
      `https://api.topazlabs.com/video/v1/status/${id}`,
      { headers: { "X-API-Key": process.env.TOPAZ_API_KEY } }
    );
    res.json(st.data);
  } catch {
    res.json({ status: "error" });
  }
});

app.listen(process.env.PORT || 3000);
