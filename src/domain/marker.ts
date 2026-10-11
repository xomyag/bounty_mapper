import { message } from '../i18n/message'
import { validateRichDocument } from './richText'
import type { RichDocument } from './richText'
import type { RegionCheck } from './region'

export const markerTypes = {
  enemy: { label: message("ui.enemy"), statuses: { alive: message("ui.alive"), hidden: message("ui.hidden"), defeated: message("ui.defeated") } },
  boss: { label: message("ui.boss"), statuses: { alive: message("ui.alive"), hidden: message("ui.hidden"), defeated: message("ui.defeated") } },
  door: { label: message("ui.door"), statuses: { open: message("ui.open.aa7e7a"), locked: message("ui.locked.9d04c0"), hidden: message("ui.hidden.3edab7") } },
  passage: { label: message("ui.passage"), statuses: { available: message("ui.available"), blocked: message("ui.blocked"), hidden: message("ui.hidden") } },
  reward: { label: message("ui.reward"), statuses: { available: message("ui.available.2e09d6"), concealed: message("ui.concealed"), collected: message("ui.collected") } },
  hero: { label: message("ui.hero"), statuses: { present: message("ui.present"), hidden: message("ui.hidden"), gone: message("ui.gone") } },
  ally: { label: message("ui.ally"), statuses: { present: message("ui.present"), hidden: message("ui.hidden"), gone: message("ui.gone") } },
  npc: { label: 'NPC', statuses: { present: message("ui.present"), hidden: message("ui.hidden"), gone: message("ui.gone") } },
  trap: { label: message("ui.trap"), statuses: { armed: message("ui.armed"), disarmed: message("ui.disarmed") } },
} as const
export type MarkerKind = keyof typeof markerTypes
export interface Entity { id: string; projectId: string; kind: MarkerKind; name: string; description: RichDocument; status: string; tags: string[]; checks: RegionCheck[] }
export interface MarkerPlacement { id: string; entityId: string; mapId: string; x: number; y: number; regionIds: string[]; color: string; locked: boolean; order: number }
export interface MapObjects { entities: Entity[]; markers: MarkerPlacement[] }
export const MAX_MARKERS = 4096
export const MAX_ENTITIES = 4096
export const statusesOf = (kind: MarkerKind): Record<string, string> => markerTypes[kind].statuses
export const statusLabel = (entity: Entity) => statusesOf(entity.kind)[entity.status]
export const statusBadge = (status: string) => ({ alive: '●', hidden: '?', defeated: '×', open: '○', locked: '▣', available: '+', blocked: '×', concealed: '?', collected: '✓', present: '●', gone: '→', armed: '!', disarmed: '✓' } as Record<string, string>)[status]
export function trapCheckProblem(check: RegionCheck): string | undefined {
  if (typeof check.condition !== 'string' || !check.condition.trim()) return message("ui.enter.the.check.purpose")
  if (typeof check.ability !== 'string' || !check.ability.trim()) return message("ui.enter.a.skill.or.ability")
  if (check.dc === undefined || !Number.isSafeInteger(check.dc) || check.dc <= 0) return message("ui.difficulty.must.be.a.positive.integer")
  if (check.condition.length > 262144 || check.ability.length > 262144 || typeof check.result !== 'string' || check.result.length > 262144) return message("ui.the.check.text.limit.was.exceeded")
}
const idValid = (id: unknown) => typeof id === 'string' && !!id.trim()
export function validateEntity(entity: Entity) {
  if (!idValid(entity.id) || !idValid(entity.projectId) || !Object.hasOwn(markerTypes, entity.kind) || typeof entity.name !== 'string' || !entity.name.trim() || entity.name.length > 512 || !Object.hasOwn(statusesOf(entity.kind), entity.status) || !Array.isArray(entity.tags) || entity.tags.length > 256 || new Set(entity.tags).size !== entity.tags.length || entity.tags.some((t) => typeof t !== 'string' || !t.trim() || t.length > 120)) throw new Error(message("ui.invalid.entity.or.marker.status"))
  validateRichDocument(entity.description)
  if (!Array.isArray(entity.checks) || entity.checks.length > 256 || new Set(entity.checks.map((c) => c?.id)).size !== entity.checks.length || entity.checks.some((c) => !c || !idValid(c.id)) || (entity.kind !== 'trap' && entity.checks.length)) throw new Error(message("ui.invalid.marker.check.list"))
  for (const [index, check] of entity.checks.entries()) { const problem = trapCheckProblem(check); if (problem) throw new Error(message("ui.check.value.value", { p0: index + 1, p1: problem })) }
}
export function validateMarker(marker: MarkerPlacement) {
  if (!idValid(marker.id) || !idValid(marker.entityId) || !idValid(marker.mapId) || ![marker.x, marker.y].every((n) => Number.isFinite(n) && Math.abs(n) <= 1e9) || !/^#[0-9a-f]{6}$/i.test(marker.color) || typeof marker.locked !== 'boolean' || !Number.isSafeInteger(marker.order) || marker.order < 0 || !Array.isArray(marker.regionIds) || marker.regionIds.length > 2048 || marker.regionIds.some((id) => !idValid(id)) || new Set(marker.regionIds).size !== marker.regionIds.length) throw new Error(message("ui.invalid.marker.placement"))
}
