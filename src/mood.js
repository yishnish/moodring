export const MOODS = ['calm', 'happy', 'excited', 'tense', 'sad', 'angry', 'neutral'];

export const MOOD_COLORS = {
  calm:    [74,  144, 217],
  happy:   [245, 166,  35],
  excited: [255, 107,  53],
  tense:   [208,   2,  27],
  sad:     [123, 104, 238],
  angry:   [139,   0,   0],
  neutral: [155, 155, 155],
};

export function toCSS([r, g, b], a = 1) {
  return `rgba(${r},${g},${b},${a})`;
}

export function lerpColor(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

export function moodColor(mood) {
  return MOOD_COLORS[mood] ?? MOOD_COLORS.neutral;
}

export class MoodHistory {
  constructor() {
    this.chunks = [];
    this.recentCount = 5;
  }

  add(mood, intensity) {
    if (!MOOD_COLORS[mood]) mood = 'neutral';
    intensity = Math.max(0, Math.min(1, intensity ?? 0.5));
    this.chunks.push({ mood, intensity, timestamp: Date.now() });
  }

  get recent() {
    return this.chunks.slice(-this.recentCount);
  }

  get all() {
    return this.chunks;
  }

  get isEmpty() {
    return this.chunks.length === 0;
  }

  // Fraction of session each mood occupied (sums to 1)
  get proportions() {
    if (!this.chunks.length) return { neutral: 1 };
    const counts = Object.fromEntries(MOODS.map(m => [m, 0]));
    for (const { mood } of this.chunks) counts[mood]++;
    const total = this.chunks.length;
    return Object.fromEntries(
      Object.entries(counts)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => [k, v / total])
    );
  }
}
