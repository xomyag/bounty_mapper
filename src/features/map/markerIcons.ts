import type { MarkerKind } from '../../domain/marker'

// Familiar 24-unit pictograms; the same paths are used by SVG buttons and canvas.
export const markerIcons: Record<MarkerKind, string> = {
  enemy: 'M4 3 L20 19 M20 3 L4 19 M3 14 L9 20 M15 20 L21 14 M4 3 L9 4 L4 9 M20 3 L15 4 L20 9',
  boss: 'M3 6 L7 10 L12 3 L17 10 L21 6 L19 19 L5 19 Z M5 15 L19 15',
  door: 'M4 21 L4 3 L20 3 L20 21 M8 21 L8 5 L17 8 L17 21 Z M13 14 L14 14',
  passage: 'M3 12 L21 12 M15 6 L21 12 L15 18 M3 5 L3 19',
  reward: 'M3 8 L7 3 L17 3 L21 8 L12 21 Z M3 8 L21 8 M7 3 L9 8 L12 21 L15 8 L17 3',
  hero: 'M12 2 L21 6 L20 14 Q17 20 12 22 Q7 20 4 14 L3 6 Z M12 6 L12 17 M7 11 L17 11',
  ally: 'M12 20 L3 11 Q0 2 7 3 Q10 3 12 7 Q14 3 17 3 Q24 2 21 11 Z M8 11 L16 11 M12 8 L12 14',
  npc: 'M12 3 A4 4 0 1 0 12 11 A4 4 0 1 0 12 3 M4 21 L4 19 Q4 14 12 14 Q20 14 20 19 L20 21 Z',
  trap: 'M2 20 L5 13 L8 18 L12 10 L16 18 L19 13 L22 20 Z M12 2 L12 6 M7 4 L9 7 M17 4 L15 7',
}

export function markerScreenScale(cameraScale: number) { return 1 / cameraScale }
export function markerInk(color: string) {
  const [r, g, b] = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16))
  return r * .299 + g * .587 + b * .114 < 140 ? '#ffffff' : '#11161b'
}
