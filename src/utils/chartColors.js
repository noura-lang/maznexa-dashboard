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

// Every bar chart's on-bar data label is a fixed white, full stop — not
// picked per bar color, tier, or theme. LABEL_ON_LIGHT/LABEL_ON_DARK stay as
// two names (both white) so every existing call site — labelColorForBg(hex),
// or either constant directly — keeps working unchanged.
export const LABEL_ON_LIGHT = '#ffffff'
export const LABEL_ON_DARK  = '#ffffff'

export function labelColorForBg() {
  return '#ffffff'
}
