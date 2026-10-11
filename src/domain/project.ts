import { emptyDocument, validateRichDocument } from './richText'
import type { RichDocument } from './richText'
export const PROJECT_SCHEMA_VERSION = 2
export const MAX_PROJECT_MAPS = 128

export interface Project {
  id: string
  name: string
  context: RichDocument
  schemaVersion: number
  revision: number
  createdAt: string
  updatedAt: string
}

export interface Map {
  id: string
  projectId: string
  name: string
  description: RichDocument
  order: number
  coordinateBounds: { x: number; y: number; width: number; height: number }
}

export interface Asset {
  id: string
  projectId: string
  mimeType: string
  byteSize: number
  pixelWidth: number
  pixelHeight: number
  checksum: string
  caption?: string
  tags: string[]
  blob: Blob
}

export interface ImagePlacement {
  id: string
  mapId: string
  assetId: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  order: number
  locked: boolean
  visible: boolean
}

export function createProject(name: string): Project {
  if (!name.trim()) throw new Error('Укажите название проекта.')
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(), name: name.trim(), context: emptyDocument(),
    schemaVersion: PROJECT_SCHEMA_VERSION, revision: 0, createdAt: now, updatedAt: now,
  }
}

export function validateProject(project: Project) {
  if (!project || project.schemaVersion !== PROJECT_SCHEMA_VERSION) throw new Error('Версия проекта не поддерживается.')
  if (typeof project.id !== 'string' || !project.id.trim() || typeof project.name !== 'string' || !project.name.trim() || !Number.isSafeInteger(project.revision) || project.revision < 1 || typeof project.createdAt !== 'string' || typeof project.updatedAt !== 'string') throw new Error('Повреждённая запись проекта.')
  validateRichDocument(project.context)
}
