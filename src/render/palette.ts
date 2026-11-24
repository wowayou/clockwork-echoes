// One palette for canvas and CSS (styles.css mirrors these as custom properties).
export const C = {
  night: '#0b1020',
  floor: '#1a2236',
  floorAlt: '#1d263c',
  groove: '#121829',
  wallTop: '#2e3956',
  wallTopHi: '#3d4a6c',
  wallFace: '#1b2238',
  wallFaceLo: '#141a2c',
  brass: '#e0b25a',
  brassHi: '#ffe3a1',
  brassLo: '#8f6227',
  echo: '#6fe6dc',
  echoDeep: '#2a8f8a',
  drift: '#ff7ad9',
  danger: '#ff5468',
  iron: '#2a2f40',
  ironHi: '#4a5270',
  wood: '#b07a40',
  woodHi: '#d29a5a',
  woodLo: '#7a4f25',
  parchment: '#ece4cf',
  muted: '#8e98b3',
} as const;

/** Plate/door colours, each with a shape so colour is never the only cue. */
export const KEYS = [
  { name: '红', color: '#ff7a59', glow: '#ffb199', shape: 'circle' },
  { name: '蓝', color: '#59a8ff', glow: '#a9d2ff', shape: 'triangle' },
  { name: '绿', color: '#6fd67a', glow: '#b8f0bd', shape: 'square' },
  { name: '紫', color: '#c792ff', glow: '#e3c9ff', shape: 'diamond' },
] as const;

export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'] as const;
