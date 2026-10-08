export const PROJECT_SCHEMA_VERSION = 1

export interface Project {
  id: string
  name: string
  contextMd: string
  schemaVersion: number
  revision: number
  createdAt: string
  updatedAt: string
}

export interface Map {
  id: string
  projectId: string
  name: string
  notesMd: string
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

export function createProject(name: string): Project {
  if (!name.trim()) throw new Error('Укажите название проекта.')
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(), name: name.trim(), contextMd: '',
    schemaVersion: PROJECT_SCHEMA_VERSION, revision: 0, createdAt: now, updatedAt: now,
  }
}
