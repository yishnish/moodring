import { MoodHistory } from './mood.js';
import { AudioCapture } from './audio.js';
import { RingRenderer } from './ring.js';

// --- Elements ---
const canvas        = document.getElementById('canvas');
const overlay       = document.getElementById('overlay');
const toggleBtn     = document.getElementById('toggle-btn');
const statusEl      = document.getElementById('status');
const errorText     = document.getElementById('error-text');
const tapHint       = document.getElementById('tap-hint');
const loadingState  = document.getElementById('loading-state');
const loadingLabel  = document.getElementById('loading-label');
const loadingFill   = document.getElementById('loading-bar-fill');
const loadingPct    = document.getElementById('loading-pct');

// --- State ---
const history  = new MoodHistory();
const renderer = new RingRenderer(canvas);
let worker     = null;
let audio      = null;
let pendingId  = 0;
let mode       = 'proportional';

// Per-model byte tracking for accurate progress bars
const fileBytes = { whisper: {}, gemma: {} };

// --- Resize ---
window.addEventListener('resize', () => renderer.resize());

// --- Loading bar ---
function showLoadingBar(label) {
  overlay.style.cursor = 'default';
  tapHint.classList.add('hidden');
  overlay.querySelector('.subtitle').classList.add('hidden');
  overlay.querySelector('h1').classList.add('hidden');
  loadingState.classList.remove('hidden');
  loadingLabel.textContent = label;
  setBarPct(0);
}

function setBarPct(pct) {
  loadingFill.style.width = `${pct}%`;
  loadingPct.textContent  = `${Math.round(pct)}%`;
}

function updateModelProgress(stage, p) {
  if (p.status === 'progress' && p.file && p.total > 0) {
    fileBytes[stage][p.file] = { loaded: p.loaded ?? 0, total: p.total };
    const entries     = Object.values(fileBytes[stage]);
    const totalLoaded = entries.reduce((s, e) => s + e.loaded, 0);
    const totalSize   = entries.reduce((s, e) => s + e.total, 0);
    setBarPct(totalSize > 0 ? (totalLoaded / totalSize) * 100 : 0);
  }
  if (p.status === 'initiate') {
    const label = stage === 'whisper' ? 'Transcription model' : 'Mood model';
    loadingLabel.textContent = `Downloading ${label}`;
  }
  if (p.status === 'loading') {
    const label = stage === 'whisper' ? 'Transcription model' : 'Mood model';
    loadingLabel.textContent = `Loading ${label}`;
    setBarPct(100);
  }
}

// --- Worker ---
function initWorker() {
  showLoadingBar('Downloading transcription model');

  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

  worker.onmessage = ({ data }) => {
    switch (data.type) {
      case 'progress':
        updateModelProgress(data.stage, data.progress ?? {});
        break;

      case 'whisper_ready':
        fileBytes.gemma = {};
        setBarPct(0);
        loadingLabel.textContent = 'Downloading mood model';
        break;

      case 'ready':
        loadingState.classList.add('hidden');
        overlay.classList.add('hidden');
        toggleBtn.style.display = 'block';
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
  loadingState.classList.add('hidden');
  overlay.style.display  = 'flex';
  overlay.style.cursor   = 'default';
}

// --- Start flow ---
overlay.addEventListener('click', () => {
  if (errorText.textContent) return;
  renderer.start(history);
  initWorker();
});

// --- Toggle ---
toggleBtn.addEventListener('click', () => {
  mode = mode === 'proportional' ? 'chronological' : 'proportional';
  renderer.setMode(mode);
  toggleBtn.textContent = mode === 'proportional' ? 'Proportional' : 'Chronological';
});
