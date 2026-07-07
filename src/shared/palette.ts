/**
 * The single source of truth for every colour in hearthvale.
 *
 * ALL runtime-generated pixel art draws exclusively from these values — no
 * other hex literal is permitted anywhere in the art files. Keeping the palette
 * tight is what makes the hand-crafted village read as one cohesive world.
 */
export const PAL = {
  // Sky / backdrop
  night: '#2e2837',

  // Earth
  soil: '#5a4a41',
  soilDark: '#4a3c35',

  // Grass
  grass: '#8fbf6b',
  grassDark: '#7aa85a',
  grassLight: '#a5d17f',

  // Paths
  path: '#d9b98c',
  pathDark: '#c4a276',

  // Timber
  wood: '#8a6249',
  woodDark: '#6e4d39',
  woodLight: '#a67c5b',

  // Plaster walls
  wall: '#e8d5b0',
  wallShade: '#d4bf98',

  // Roofs — red family
  roofRed: '#c25b4e',
  roofRedDark: '#a34a41',

  // Roofs — blue family
  roofBlue: '#5b7ea8',
  roofBlueDark: '#4a6a8f',

  // Roofs — straw family
  roofStraw: '#d9a951',
  roofStrawDark: '#bf9143',

  // Stone
  stone: '#9a94a6',
  stoneDark: '#7e7890',

  // Foliage
  leaf: '#6aa354',
  leafDark: '#568a43',

  // Accents
  water: '#7fb8d4',
  glow: '#ffd98a',
  cream: '#fff3d9',
  ink: '#3b3347',
  accent: '#e8905a',
} as const;

export type PaletteKey = keyof typeof PAL;
