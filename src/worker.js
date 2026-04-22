import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

const WHISPER_MODEL = 'Xenova/whisper-tiny.en';
const GEMMA_MODEL   = 'google/gemma-4-E2B-it';
const MOODS         = ['calm', 'happy', 'excited', 'tense', 'sad', 'angry', 'neutral'];
const MIN_WORDS     = 3;

let transcriber = null;
let generator   = null;

function progress(stage, p) {
  self.postMessage({ type: 'progress', stage, progress: p });
}

async function loadModels(device) {
  const dtype = device === 'webgpu' ? 'fp32' : 'q8';

  transcriber = await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
    device,
    dtype,
    progress_callback: (p) => progress('whisper', p),
  });
  self.postMessage({ type: 'whisper_ready' });

  const gemmaDtype = device === 'webgpu' ? 'q4f16' : 'q4';
  generator = await pipeline('text-generation', GEMMA_MODEL, {
    device,
    dtype: gemmaDtype,
    progress_callback: (p) => progress('gemma', p),
  });
  self.postMessage({ type: 'ready' });
}

function buildMessages(text) {
  return [
    {
      role: 'system',
      content: `You are a mood classifier. Respond with ONLY valid JSON, no other text.
Format: {"mood": "<mood>", "intensity": <0.0-1.0>}
mood must be exactly one of: ${MOODS.join(', ')}`,
    },
    {
      role: 'user',
      content: `Classify the emotional tone of this speech: "${text}"`,
    },
  ];
}

function parseResult(raw) {
  const match = raw.match(/\{[^}]+\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (!MOODS.includes(parsed.mood)) parsed.mood = 'neutral';
    parsed.intensity = Math.max(0, Math.min(1, Number(parsed.intensity) || 0.5));
    return parsed;
  } catch {
    return null;
  }
}

self.onmessage = async ({ data }) => {
  if (data.type === 'load') {
    try {
      await loadModels(data.device ?? 'wasm');
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
    return;
  }

  if (data.type === 'transcribe') {
    const { id, audio } = data;
    try {
      // Transcribe
      const { text } = await transcriber(
        { array: audio, sampling_rate: 16000 },
        { language: 'english', task: 'transcribe' },
      );

      const trimmed = text.trim();
      if (trimmed.split(/\s+/).length < MIN_WORDS) {
        self.postMessage({ type: 'skip', id });
        return;
      }

      // Classify mood
      const output = await generator(buildMessages(trimmed), {
        max_new_tokens: 40,
        do_sample: false,
        return_full_text: false,
      });

      const raw    = output[0]?.generated_text ?? '';
      const result = parseResult(raw) ?? { mood: 'neutral', intensity: 0.5 };
      self.postMessage({ type: 'result', id, ...result });
    } catch (err) {
      self.postMessage({ type: 'error', id, message: err.message });
    }
  }
};
