import { MoodHistory } from './mood.js';
import { AudioCapture } from './audio.js';
import { RingRenderer } from './ring.js';

// --- Elements ---
const canvas    = document.getElementById('canvas');
const overlay   = document.getElementById('overlay');
const toggleBtn = document.getElementById('toggle-btn');
const statusEl  = document.getElementById('status');
const errorText = document.getElementById('error-text');

// --- State ---
const history  = new MoodHistory();
const renderer = new RingRenderer(canvas);
let worker     = null;
let audio      = null;
let pendingId  = 0;
let mode       = 'proportional';

// --- Resize ---
window.addEventListener('resize', () => renderer.resize());

// --- Worker ---
function initWorker() {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

  worker.onmessage = ({ data }) => {
    switch (data.type) {
      case 'progress': {
        const label = data.stage === 'whisper' ? 'Transcription model' : 'Mood model';
        const pct   = data.progress?.progress != null
          ? ` ${Math.round(data.progress.progress)}%`
          : '';
        if (data.progress?.status === 'downloading') setStatus(`Downloading ${label}${pct}…`);
        if (data.progress?.status === 'loading')     setStatus(`Loading ${label}…`);
        break;
      }
      case 'whisper_ready':
        setStatus('Loading mood model…');
        break;
      case 'ready':
        setStatus('Listening');
        startAudio();
        break;
      case 'result':
        history.add(data.mood, data.intensity);
        renderer.setCurrentMood(data.mood, data.intensity);
        break;
      case 'error':
        if (!data.id) showError(`Model error: ${data.message}`);
        break;
    }
  };

  const device = navigator.gpu ? 'webgpu' : 'wasm';
  worker.postMessage({ type: 'load', device });
}

// --- Audio ---
function startAudio() {
  audio = new AudioCapture({
    onAudioChunk: (float32) => {
      const id = ++pendingId;
      worker.postMessage({ type: 'transcribe', id, audio: float32 }, [float32.buffer]);
    },
    onError: (msg) => showError(msg),
  });
  audio.start();
}

// --- UI helpers ---
function setStatus(msg) {
  statusEl.textContent = msg;
  statusEl.style.display = 'block';
}

function showError(msg) {
  errorText.textContent = msg;
  errorText.classList.remove('hidden');
  overlay.style.display = 'flex';
  overlay.querySelector('.tap-hint')?.classList.add('hidden');
  overlay.querySelector('.subtitle')?.classList.add('hidden');
}

// --- Start flow ---
overlay.addEventListener('click', () => {
  if (errorText.textContent) return;
  overlay.classList.add('hidden');
  toggleBtn.style.display = 'block';
  statusEl.style.display  = 'block';
  renderer.start(history);
  initWorker();
});

// --- Toggle ---
toggleBtn.addEventListener('click', () => {
  mode = mode === 'proportional' ? 'chronological' : 'proportional';
  renderer.setMode(mode);
  toggleBtn.textContent = mode === 'proportional' ? 'Proportional' : 'Chronological';
});
