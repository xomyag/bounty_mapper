import { validateRichDocument } from './richText'
import type { RichDocument } from './richText'

export const markerTypes = {
  enemy: { label: 'Противник', statuses: { alive: 'Жив', hidden: 'Скрыт', defeated: 'Повержен' } },
  boss: { label: 'Босс', statuses: { alive: 'Жив', hidden: 'Скрыт', defeated: 'Повержен' } },
  door: { label: 'Дверь', statuses: { open: 'Открыта', locked: 'Заперта', hidden: 'Скрыта' } },
  passage: { label: 'Проход', statuses: { available: 'Доступен', blocked: 'Заблокирован', hidden: 'Скрыт' } },
  reward: { label: 'Награда', statuses: { available: 'Доступна', concealed: 'Спрятана', collected: 'Получена' } },
  hero: { label: 'Герой', statuses: { present: 'На месте', hidden: 'Скрыт', gone: 'Ушёл' } },
  ally: { label: 'Союзник', statuses: { present: 'На месте', hidden: 'Скрыт', gone: 'Ушёл' } },
  npc: { label: 'NPC', statuses: { present: 'На месте', hidden: 'Скрыт', gone: 'Ушёл' } },
} as const
export type MarkerKind = keyof typeof markerTypes
export interface Entity { id: string; projectId: string; kind: MarkerKind; name: string; description: RichDocument; status: string; tags: string[] }
export interface MarkerPlacement { id: string; entityId: string; mapId: string; x: number; y: number; regionIds: string[]; color: string; locked: boolean; order: number }
export interface MapObjects { entities: Entity[]; markers: MarkerPlacement[] }
export const MAX_MARKERS = 4096
export const MAX_ENTITIES = 4096
export const statusesOf = (kind: MarkerKind): Record<string, string> => markerTypes[kind].statuses
export const statusLabel = (entity: Entity) => statusesOf(entity.kind)[entity.status]
export const statusBadge = (status: string) => ({ alive: '●', hidden: '?', defeated: '×', open: '○', locked: '▣', available: '+', blocked: '×', concealed: '?', collected: '✓', present: '●', gone: '→' } as Record<string, string>)[status]
const idValid = (id: unknown) => typeof id === 'string' && !!id.trim()
export function validateEntity(entity: Entity) {
  if (!idValid(entity.id) || !idValid(entity.projectId) || !Object.hasOwn(markerTypes, entity.kind) || typeof entity.name !== 'string' || !entity.name.trim() || entity.name.length > 512 || !Object.hasOwn(statusesOf(entity.kind), entity.status) || !Array.isArray(entity.tags) || entity.tags.length > 256 || new Set(entity.tags).size !== entity.tags.length || entity.tags.some((t) => typeof t !== 'string' || !t.trim() || t.length > 120)) throw new Error('Некорректная сущность или статус маркера.')
  validateRichDocument(entity.description)
}
export function validateMarker(marker: MarkerPlacement) {
  if (!idValid(marker.id) || !idValid(marker.entityId) || !idValid(marker.mapId) || ![marker.x, marker.y].every((n) => Number.isFinite(n) && Math.abs(n) <= 1e9) || !/^#[0-9a-f]{6}$/i.test(marker.color) || typeof marker.locked !== 'boolean' || !Number.isSafeInteger(marker.order) || marker.order < 0 || !Array.isArray(marker.regionIds) || marker.regionIds.length > 2048 || marker.regionIds.some((id) => !idValid(id)) || new Set(marker.regionIds).size !== marker.regionIds.length) throw new Error('Некорректное размещение маркера.')
}
