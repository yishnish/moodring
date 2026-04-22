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
const debugPanel    = document.getElementById('debug-panel');
const debugStatus   = document.getElementById('debug-status');
const debugMood     = document.getElementById('debug-mood');
const debugSnippet  = document.getElementById('debug-snippet');
const debugCount    = document.getElementById('debug-count');

// --- State ---
const history  = new MoodHistory();
const renderer = new RingRenderer(canvas);
let worker     = null;
let audio      = null;
let pendingId  = 0;
let activeJobs = 0;
let chunkCount = 0;
let mode       = 'proportional';

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

// v4 fires 'progress_total' with an aggregate percentage across all files
function updateModelProgress(p) {
  if (p.status === 'progress_total') {
    setBarPct(p.progress ?? 0);
  }
  if (p.status === 'initiate') {
    loadingLabel.textContent = 'Downloading Gemma 4 E2B';
  }
  if (p.status === 'done') {
    loadingLabel.textContent = 'Loading Gemma 4 E2B';
  }
}

// --- Debug panel ---
function setDebugStatus(msg) {
  debugStatus.textContent = msg;
}

function updateDebug({ mood, intensity, transcript } = {}) {
  debugCount.textContent = `${chunkCount} chunk${chunkCount !== 1 ? 's' : ''}`;
  if (mood) {
    debugMood.textContent = `${mood}  ${(intensity * 100).toFixed(0)}%`;
    debugMood.style.color = getMoodDebugColor(mood);
  }
  if (transcript) {
    const trimmed = transcript.trim();
    debugSnippet.textContent = trimmed.length > 80
      ? '…' + trimmed.slice(-80)
      : trimmed;
  }
}

function getMoodDebugColor(mood) {
  const map = {
    calm: '#4A90D9', happy: '#F5A623', excited: '#FF6B35',
    tense: '#D0021B', sad: '#7B68EE', angry: '#8B0000', neutral: '#9B9B9B',
  };
  return map[mood] ?? '#fff';
}

// --- Worker ---
function initWorker() {
  showLoadingBar('Starting…');

  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

  worker.onmessage = ({ data }) => {
    switch (data.type) {
      case 'progress':
        updateModelProgress(data.progress ?? {});
        break;

      case 'ready':
        loadingState.classList.add('hidden');
        overlay.classList.add('hidden');
        toggleBtn.style.display = 'block';
        debugPanel.style.display = 'flex';
        setStatus('Listening');
        setDebugStatus('Listening — waiting for speech');
        startAudio();
        break;

      case 'result':
        activeJobs = Math.max(0, activeJobs - 1);
        chunkCount++;
        history.add(data.mood, data.intensity);
        renderer.setCurrentMood(data.mood, data.intensity);
        updateDebug({ mood: data.mood, intensity: data.intensity, transcript: data.transcript });
        setDebugStatus(activeJobs > 0 ? `Processing (${activeJobs} in queue)` : 'Listening');
        break;

      case 'skip':
        activeJobs = Math.max(0, activeJobs - 1);
        setDebugStatus(activeJobs > 0 ? `Processing (${activeJobs} in queue)` : 'Listening — no speech detected');
        break;

      case 'error':
        activeJobs = Math.max(0, activeJobs - 1);
        if (!data.id) {
          showError(`Model error: ${data.message}`);
        } else {
          setDebugStatus(`Chunk error: ${data.message}`);
        }
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
      activeJobs++;
      setDebugStatus(`Processing chunk #${id}…`);
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
