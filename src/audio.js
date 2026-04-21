const CHUNK_MS = 5000;
const TARGET_SAMPLE_RATE = 16000;

function getMimeType() {
  for (const t of ['audio/webm', 'audio/mp4', 'audio/ogg']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

async function decodeToFloat32(arrayBuffer) {
  // Decode at native rate, then resample to 16kHz for Whisper
  const tempCtx = new AudioContext();
  const decoded = await tempCtx.decodeAudioData(arrayBuffer);
  await tempCtx.close();

  const offlineCtx = new OfflineAudioContext(
    1,
    Math.ceil(decoded.duration * TARGET_SAMPLE_RATE),
    TARGET_SAMPLE_RATE,
  );
  const src = offlineCtx.createBufferSource();
  src.buffer = decoded;
  src.connect(offlineCtx.destination);
  src.start();
  const resampled = await offlineCtx.startRendering();
  return resampled.getChannelData(0);
}

export class AudioCapture {
  constructor({ onAudioChunk, onError }) {
    this.onAudioChunk = onAudioChunk;
    this.onError = onError;
    this.recorder = null;
    this.stream = null;
    this.active = false;
  }

  get supported() {
    return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  }

  async start() {
    if (!this.supported) {
      this.onError('Microphone recording is not supported in this browser.');
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      this.onError('Microphone access denied. Please allow microphone and reload.');
      return;
    }

    const mimeType = getMimeType();
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.active = true;

    this.recorder.ondataavailable = async (e) => {
      if (!e.data?.size) return;
      try {
        const arrayBuffer = await e.data.arrayBuffer();
        const float32 = await decodeToFloat32(arrayBuffer);
        this.onAudioChunk(float32);
      } catch (err) {
        // silently drop bad chunks
        console.warn('Audio decode error:', err);
      }
    };

    this.recorder.onerror = () => this.onError('Recording error — please reload.');

    this.recorder.start(CHUNK_MS);
  }

  stop() {
    this.active = false;
    try { this.recorder?.stop(); } catch (_) {}
    this.stream?.getTracks().forEach(t => t.stop());
  }
}
