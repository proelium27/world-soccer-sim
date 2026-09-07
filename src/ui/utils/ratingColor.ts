type Rgb = readonly [number, number, number];

const LOW_COLOR: Rgb = [220, 53, 69]; // #dc3545, matches RatingDelta's negative-delta red
const MID_COLOR: Rgb = [108, 117, 125]; // #6c757d, neutral gray
const HIGH_COLOR: Rgb = [25, 135, 84]; // #198754, matches RatingDelta's positive-delta green

const LOW_VALUE = 40;
const MID_VALUE = 65;
const HIGH_VALUE = 90;

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function mixColor(from: Rgb, to: Rgb, t: number): string {
  const [r, g, b] = [lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)];
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Maps a 0-100 rating to a red -> gray -> green color, so values around
 * ~90+ read as strong (green) and values around ~40 or below read as
 * weak (red), with a smooth gradient in between.
 */
export function getRatingColor(value: number): string {
  const clamped = Math.max(LOW_VALUE, Math.min(HIGH_VALUE, value));
  if (clamped <= MID_VALUE) {
    const t = (clamped - LOW_VALUE) / (MID_VALUE - LOW_VALUE);
    return mixColor(LOW_COLOR, MID_COLOR, t);
  }
  const t = (clamped - MID_VALUE) / (HIGH_VALUE - MID_VALUE);
  return mixColor(MID_COLOR, HIGH_COLOR, t);
}
