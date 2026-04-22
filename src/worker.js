import { AutoProcessor, Gemma4ForConditionalGeneration } from '@huggingface/transformers';

const MODEL_ID = 'onnx-community/gemma-4-E2B-it-ONNX';
const MOODS    = ['calm', 'happy', 'excited', 'tense', 'sad', 'angry', 'neutral'];

let processor = null;
let model     = null;

const MESSAGES = [
  {
    role: 'user',
    content: [
      { type: 'audio' },
      {
        type: 'text',
        text: `Transcribe this speech and classify the emotional tone.
Reply with ONLY valid JSON, no other text:
{"transcript": "...", "mood": "<mood>", "intensity": <0.0-1.0>}
mood must be exactly one of: ${MOODS.join(', ')}`,
      },
    ],
  },
];

function parseResult(raw) {
  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (!MOODS.includes(parsed.mood)) parsed.mood = 'neutral';
    parsed.intensity  = Math.max(0, Math.min(1, Number(parsed.intensity) || 0.5));
    parsed.transcript = typeof parsed.transcript === 'string' ? parsed.transcript : '';
    return parsed;
  } catch {
    return null;
  }
}

self.onmessage = async ({ data }) => {
  if (data.type === 'load') {
    try {
      const device = data.device ?? 'wasm';
      const dtype  = device === 'webgpu' ? 'q4f16' : 'q4';
      const prog   = (p) => self.postMessage({ type: 'progress', stage: 'gemma', progress: p });

      processor = await AutoProcessor.from_pretrained(MODEL_ID, { progress_callback: prog });
      model     = await Gemma4ForConditionalGeneration.from_pretrained(MODEL_ID, {
        dtype,
        device,
        progress_callback: prog,
      });

      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
    return;
  }

  if (data.type === 'transcribe') {
    const { id, audio } = data;
    try {
      const prompt = processor.apply_chat_template(MESSAGES, {
        enable_thinking: false,
        add_generation_prompt: true,
      });

      const inputs = await processor(prompt, null, audio, { add_special_tokens: false });

      const outputs = await model.generate({
        ...inputs,
        max_new_tokens: 100,
        do_sample: false,
      });

      const decoded = processor.batch_decode(
        outputs.slice(null, [inputs.input_ids.dims.at(-1), null]),
        { skip_special_tokens: true },
      );

      const parsed = parseResult(decoded[0]);
      if (!parsed || !parsed.transcript || parsed.transcript.trim().split(/\s+/).length < 3) {
        self.postMessage({ type: 'skip', id });
        return;
      }
      self.postMessage({ type: 'result', id, ...parsed });
    } catch (err) {
      self.postMessage({ type: 'error', id, message: err.message });
    }
  }
};
