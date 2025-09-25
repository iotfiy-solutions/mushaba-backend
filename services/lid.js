const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
let ffmpeg;
let ffmpegStatic;
try {
  ffmpeg = require('fluent-ffmpeg');
  ffmpegStatic = require('ffmpeg-static');
  if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);
} catch (_) {}

async function dataUriToTempFile(dataUri, maxSeconds = 5) {
  if (!dataUri || typeof dataUri !== 'string' || !dataUri.startsWith('data:')) return null;
  const header = dataUri.split(',')[0] || '';
  const base64 = dataUri.split(',')[1] || '';
  const inputBuffer = Buffer.from(base64, 'base64');
  const tmp = os.tmpdir();
  const inPath = path.join(tmp, `lid_in_${Date.now()}.bin`);
  const outPath = path.join(tmp, `lid_out_${Date.now()}.wav`);
  fs.writeFileSync(inPath, inputBuffer);

  if (!ffmpeg) return null;
  await new Promise((resolve, reject) => {
    ffmpeg(inPath)
      .audioChannels(1)
      .audioFrequency(16000)
      .format('wav')
      .outputOptions([`-t ${Math.max(1, Math.min(10, maxSeconds))}`])
      .on('end', resolve)
      .on('error', reject)
      .save(outPath);
  });
  try { fs.unlinkSync(inPath); } catch (_) {}
  return outPath;
}

async function runLidOnFile(filePath) {
  return await new Promise((resolve) => {
    // Prefer venv Python if available; else fallback to system
    const isWin = process.platform === 'win32';
    // const venvPython = path.join(__dirname, '..', '.venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');
    // const pythonCmd = fs.existsSync(venvPython)
    //   ? venvPython
    //   : (process.env.PYTHON || (isWin ? 'python' : 'python3'));
    const envOverride = process.env.LID_PYTHON;
    const venvCandidates = isWin
      ? [path.join(process.cwd(), '.venv', 'Scripts', 'python.exe'), path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe')]
      : [path.join(process.cwd(), '.venv', 'bin', 'python'), path.join(__dirname, '..', '.venv', 'bin', 'python')];
    let pythonCmd = envOverride && fs.existsSync(envOverride) ? envOverride : null;
    if (!pythonCmd) {
      for (const c of venvCandidates) {
        try { if (fs.existsSync(c)) { pythonCmd = c; break; } } catch (_) {}
      }
    }
    if (!pythonCmd) {
      pythonCmd = process.env.PYTHON || (isWin ? 'python' : 'python3');
    }

    const args = [path.join(__dirname, 'lid.py'), '--input', filePath];
    const modelFromEnv = process.env.LID_MODEL;
    if (modelFromEnv) {
      args.push('--model');
      args.push(modelFromEnv);
    }
    const computeFromEnv = process.env.LID_COMPUTE_TYPE;
    if (computeFromEnv) {
      args.push('--compute_type');
      args.push(computeFromEnv);
    }
    const nsThresh = process.env.LID_NO_SPEECH_THRESHOLD;
    if (nsThresh) {
      args.push('--no_speech_threshold');
      args.push(String(nsThresh));
    }
    const vadMin = process.env.LID_VAD_MIN_MS;
    if (vadMin) { args.push('--vad_min_ms'); args.push(String(vadMin)); }
    const vadMax = process.env.LID_VAD_MAX_S;
    if (vadMax) { args.push('--vad_max_s'); args.push(String(vadMax)); }
    const vadPad = process.env.LID_VAD_PAD_MS;
    if (vadPad) { args.push('--vad_pad_ms'); args.push(String(vadPad)); }
    const py = spawn(pythonCmd, args);
    let stdout = '';
    let stderr = '';
    py.stdout.on('data', (d) => stdout += d.toString());
    py.stderr.on('data', (d) => stderr += d.toString());
    py.on('close', () => {
      try {
        const parsed = JSON.parse(stdout.trim() || '{}');
        resolve(parsed);
      } catch (e) {
        resolve({ error: stderr || e.message });
      }
    });
  });
}

async function detectLanguageFromDataUri(dataUri) {
  // Pass 1: 5s snippet
  const file5 = await dataUriToTempFile(dataUri, 5);
  if (!file5) return { error: 'ffmpeg unavailable or invalid dataUri' };
  let result = await runLidOnFile(file5);
  try { fs.unlinkSync(file5); } catch (_) {}
  const conf = typeof result?.confidence === 'number' ? result.confidence : 0;
  if (conf >= (Number(process.env.LID_CONFIDENCE_MIN || 0.7))) {
    return result;
  }
  // Pass 2: 8s snippet if confidence low
  const file8 = await dataUriToTempFile(dataUri, 8);
  if (!file8) return result;
  const result2 = await runLidOnFile(file8);
  try { fs.unlinkSync(file8); } catch (_) {}
  const conf2 = typeof result2?.confidence === 'number' ? result2.confidence : 0;
  return conf2 > conf ? result2 : result;
}

module.exports = { detectLanguageFromDataUri };


