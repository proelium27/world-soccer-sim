import { OVR_SCALE_SHIFT, RATING_MAX } from "../../core/constants.js";

type Rgb = readonly [number, number, number];

const LOW_COLOR: Rgb = [220, 53, 69]; // #dc3545, matches RatingDelta's negative-delta red
const MID_COLOR: Rgb = [108, 117, 125]; // #6c757d, neutral gray
const HIGH_COLOR: Rgb = [25, 135, 84]; // #198754, matches RatingDelta's positive-delta green

/*
 * Three positions on the OVR scale, so they move with OVR_SCALE_SHIFT like every
 * other one. Left behind they would have kept describing the old scale: the
 * neutral midpoint was "an average starter", and an average starter is now a 76
 * rather than a 65, so every ordinary first-teamer would have rendered green and
 * a genuinely weak player neutral gray.
 *
 * The top is clamped to RATING_MAX because the faithful shift puts it at 101,
 * which no rating can reach. That leaves the green half of the gradient two
 * points narrower than the red half, which is invisible.
 */
export const LOW_VALUE = 40 + OVR_SCALE_SHIFT;
export const MID_VALUE = 65 + OVR_SCALE_SHIFT;
export const HIGH_VALUE = Math.min(RATING_MAX, 90 + OVR_SCALE_SHIFT);

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function mixColor(from: Rgb, to: Rgb, t: number): string {
  const [r, g, b] = [lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)];
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Maps an OVR to a red -> gray -> green color, so an elite player reads as
 * strong (green) and a weak one as red, with a smooth gradient between. The
 * three thresholds are positions on the rating scale and move with it.
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
