const express = require('express');
const { speech_To_Text } = require('./STT');
const { text_To_Speech } = require('./TTS');

let ffmpeg;
let ffmpegStatic;
try {
  ffmpeg = require('fluent-ffmpeg');
  ffmpegStatic = require('ffmpeg-static');
  if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);
} catch (_) {}

const router = express.Router();
router.use(express.json({ limit: '20mb' }));

function inferSttEncodingFromDataUri(dataUri) {
  if (!dataUri || typeof dataUri !== 'string') return undefined;
  if (!dataUri.startsWith('data:')) return undefined;
  const header = dataUri.split(',')[0] || '';
  if (/audio\/webm/i.test(header)) return 'WEBM_OPUS';
  if (/audio\/ogg/i.test(header)) return 'OGG_OPUS';
  if (/audio\/wav|audio\/x-wav/i.test(header)) return 'LINEAR16';
  if (/audio\/mpeg/i.test(header)) return 'MP3';
  return undefined;
}

// Optional: transcode m4a/mp4/aac to ogg/opus for stable STT
async function maybeTranscodeToOggOpus(dataUri) {
  if (!ffmpeg || !dataUri || typeof dataUri !== 'string' || !dataUri.startsWith('data:')) return null;
  const header = dataUri.split(',')[0] || '';
  if (/audio\/(webm|ogg|wav|x-wav|mpeg)/i.test(header)) return null;
  const base64 = dataUri.split(',')[1] || '';
  if (!base64) return null;
  const inputBuffer = Buffer.from(base64, 'base64');
  const path = require('path');
  const fs = require('fs');
  const tmp = require('os').tmpdir();
  const inPath = path.join(tmp, `in_${Date.now()}.bin`);
  const outPath = path.join(tmp, `out_${Date.now()}.ogg`);
  fs.writeFileSync(inPath, inputBuffer);
  await new Promise((resolve, reject) => {
    ffmpeg(inPath)
      .audioCodec('libopus')
      .format('ogg')
      .audioChannels(1)
      .audioFrequency(48000)
      .outputOptions(['-b:a 64k'])
      .on('end', resolve)
      .on('error', reject)
      .save(outPath);
  });
  const outBuffer = fs.readFileSync(outPath);
  try { fs.unlinkSync(inPath); } catch (_) {}
  try { fs.unlinkSync(outPath); } catch (_) {}
  const outBase64 = outBuffer.toString('base64');
  return `data:audio/ogg;base64,${outBase64}`;
}

// POST /api/speech/stt  { data: base64 | dataURI, sttLanguageCode?, audioEncoding? }
router.post('/stt', async (req, res) => {
  try {
    const { data, sttLanguageCode, audioEncoding, sampleRateHertz, model, alternativeLanguageCodes } = req.body || {};
    if (!data) return res.status(400).json({ success: false, message: 'Missing data' });
    const isDataUri = typeof data === 'string' && data.startsWith('data:');
    const finalData = isDataUri ? (await maybeTranscodeToOggOpus(data)) || data : data;
    const encoding = audioEncoding || (isDataUri ? inferSttEncodingFromDataUri(finalData) : undefined);
    const stt = await speech_To_Text(finalData, {
      languageCode: sttLanguageCode || 'en-US',
      audioEncoding: encoding,
      sampleRateHertz,
      model,
      alternativeLanguageCodes: Array.isArray(alternativeLanguageCodes) ? alternativeLanguageCodes : undefined
    });
    return res.json({ success: true, transcript: stt.transcript, detectedLanguageCode: stt.detectedLanguageCode, results: stt.results });
  } catch (e) {
    console.error('[SPEECH_STT] error:', e);
    return res.status(500).json({ success: false, message: 'STT error' });
  }
});

// POST /api/speech/tts  { text, languageCode, ssmlGender?, audioEncoding? }
router.post('/tts', async (req, res) => {
  try {
    const { text, languageCode, ssmlGender = 'NEUTRAL', audioEncoding = 'MP3', voiceName } = req.body || {};
    if (!text || !languageCode) return res.status(400).json({ success: false, message: 'Missing text or languageCode' });
    const buf = await text_To_Speech(text, voiceName, languageCode, ssmlGender, audioEncoding);
    const contentType = audioEncoding === 'MP3' ? 'audio/mpeg' : audioEncoding === 'OGG_OPUS' ? 'audio/ogg' : audioEncoding === 'LINEAR16' ? 'audio/wav' : 'application/octet-stream';
    if (String(req.query.base64 || '') === '1') {
      return res.json({ success: true, base64: buf.toString('base64'), contentType });
    }
    res.set('Content-Type', contentType);
    return res.send(buf);
  } catch (e) {
    console.error('[SPEECH_TTS] error:', e);
    return res.status(500).json({ success: false, message: 'TTS error' });
  }
});

module.exports = { router };


