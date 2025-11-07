require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 3000;
const TOPAZ_API_KEY = process.env.TOPAZ_API_KEY;

// Serve the HTML upload form
app.use(express.static('public'));

// Enhance video or image endpoint (simplified for image demo)
app.post('/enhance', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send('No file uploaded');

    const form = new FormData();
    form.append('image', fs.createReadStream(req.file.path));
    form.append('model', 'Standard V2');

    const headers = {
      ...form.getHeaders(),
      'X-API-Key': TOPAZ_API_KEY
    };

    const response = await axios.post('https://api.topazlabs.com/image/v1/enhance', form, {
      headers,
      responseType: 'arraybuffer'
    });

    res.set('Content-Type', 'image/jpeg');
    res.send(Buffer.from(response.data, 'binary'));

    fs.unlink(req.file.path, () => {});
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Processing error');
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
