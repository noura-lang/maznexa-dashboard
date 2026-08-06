// Brand-only chart palette (Maznexa Purple #6858a2 + Blue #8c8ffe), light → dark.
// Use these instead of arbitrary/traffic-light colors in any chart.

export const CHART_COLORS = [
  '#d6ceff', // brand-200
  '#b8a8ff', // brand-300
  '#9b7eff', // brand-400
  '#8c8ffe', // accent (blue)
  '#8c6dc4', // brand-500
  '#6858a2', // brand-600 (primary purple)
  '#3d2b7a', // brand-700
]

export function chartColor(i) {
  return CHART_COLORS[i % CHART_COLORS.length]
}

// Sequential light -> dark shade for the i-th of `total` ranked values
// (e.g. bars sorted descending), so magnitude reads visually without
// relying on hue.
export const SEQUENTIAL_STOPS = ['#d6ceff', '#b8a8ff', '#9b7eff', '#8c6dc4', '#6858a2', '#3d2b7a']

export function sequentialColor(index, total) {
  if (total <= 1) return SEQUENTIAL_STOPS[SEQUENTIAL_STOPS.length - 1]
  const pos = index / (total - 1)
  const idx = Math.round(pos * (SEQUENTIAL_STOPS.length - 1))
  return SEQUENTIAL_STOPS[idx]
}

// The darkest utilization tier ("Professional", 95%+ — SEQUENTIAL_STOPS[5],
// #3d2b7a) sits too close to the app's dark-mode card backgrounds
// (#1a0e3d/#0f0824) to read as a filled bar, heatmap cell, or badge — swap
// to this lighter, distinct purple + a light border in dark mode only.
// Light mode keeps the original darkest-purple, which reads fine on white.
export const DARK_PROFESSIONAL_COLOR  = '#B893FF'
export const DARK_PROFESSIONAL_BORDER = '#E4D6FF'

// Shared on-bar data-label colors — every bar chart's LabelList picks
// between these two based on its own bar's fill, so a label is always
// readable against the exact color behind it instead of a static
// 'currentColor' guess that can go invisible on light bars in dark mode
// (or vice versa).
export const LABEL_ON_LIGHT = '#4B2D8A'
export const LABEL_ON_DARK  = '#ffffff'

function relativeLuminance(hex) {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.substring(0, 2), 16)
  const g = parseInt(clean.substring(2, 4), 16)
  const b = parseInt(clean.substring(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

// > 0.6 covers the palette's two lightest stops (and the dark-mode
// Professional-tier swap, #B893FF) — everything else in the brand-purple
// range reads better with a white label.
export function labelColorForBg(hex) {
  return relativeLuminance(hex) > 0.6 ? LABEL_ON_LIGHT : LABEL_ON_DARK
}
