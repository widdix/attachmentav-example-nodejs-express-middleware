import express from 'express';
import multer from 'multer';
import pLimit from 'p-limit';
import { Readable } from 'stream';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const ATTACHMENTAV_API_KEY = process.env.ATTACHMENTAV_API_KEY;
const ATTACHMENTAV_URL = 'https://eu.developer.attachmentav.com/v1/scan/sync/binary';

if (!ATTACHMENTAV_API_KEY) {
  throw new Error('ATTACHMENTAV_API_KEY environment variable is not set');
}

app.use(express.static('public'));

async function submitFileForMalwareScan(file) {
  const stream = Readable.from(file.buffer);

  return await fetch(ATTACHMENTAV_URL, {
    method: 'POST',
    headers: {
      'x-api-key': ATTACHMENTAV_API_KEY,
      'Content-Type': 'application/octet-stream',
      'Content-Length': file.buffer.length.toString(),
    },
    body: stream,
    duplex: 'half',
  });
}

app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const response = await submitFileForMalwareScan(req.file);

  if (!response.ok) {
    console.error(`AttachmentAV API error: ${response.status} ${response.statusText}`);
    console.error(await response.text());
    return res.status(500).json({ error: 'Failed to scan file' });
  }

  const scanResult = await response.json();

  if (scanResult.status === 'infected') {
    return res.status(400).json({
      error: 'Malware detected',
      details: scanResult,
    });
  } else if (scanResult.status === 'no') {
    console.warn(`File could not be scanned: ${JSON.stringify(scanResult)}`);
  }

  res.json({
    message: 'File uploaded and scanned successfully',
    filename: req.file.originalname,
    scan: scanResult,
  });
});

app.post('/multi-upload', upload.array('files'), async (req, res) => {
  if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // limit concurrent requests to attachmentAV API to avoid throttling
  const limit = pLimit(3);
  const scanRequests = req.files.map(async (file) => limit(() => submitFileForMalwareScan(file)));
  const scanResponses = await Promise.all(scanRequests);

  for (const response of scanResponses) {
    const scanResult = await response.json();

    if (!response.ok) {
      console.error(`AttachmentAV API error: ${response.status} ${response.statusText}`);
      console.error(await response.text());
      return res.status(500).json({ error: 'Failed to scan file' });
    }

    if (scanResult.status === 'infected') {
      return res.status(400).json({
        error: 'Malware detected',
        details: scanResult,
      });
    } else if (scanResult.status === 'no') {
      console.warn(`File could not be scanned: ${JSON.stringify(scanResult)}`);
    }
  }

  res.json({
    message: 'Files uploaded and scanned successfully',
  });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
