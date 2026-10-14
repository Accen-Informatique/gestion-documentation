export interface DocFile {
  name: string
  mimeType: string
  size: number | null
  ext: string
  missing?: boolean
}

export interface DocItem {
  id: string
  recordId?: string
  title: string
  description: string
  category: string
  visibility: 'public' | 'private'
  unlockedBy: string[]
  file: DocFile
  /** Lien signé vers le fichier (fourni par le serveur) */
  fileUrl: string
  createdAt: string | null
  updatedAt: string | null
}

export function formatSize(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} o`
  const units = ['Ko', 'Mo', 'Go']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toLocaleString('fr-FR', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`
}

export function formatDate(iso: string | null | undefined, withTime = false) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('fr-FR', withTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Message d'erreur lisible depuis une erreur $fetch */
export function errorMessage(e: any, fallback = 'Une erreur est survenue.') {
  return e?.data?.message || e?.data?.statusMessage || e?.statusMessage || e?.message || fallback
}

export type FileKind = 'pdf' | 'image' | 'video' | 'audio' | 'text' | 'word' | 'excel' | 'slides' | 'archive' | 'other'

export function fileKind(file: Pick<DocFile, 'ext' | 'mimeType'>): FileKind {
  const e = file.ext
  if (e === 'pdf') return 'pdf'
  if (file.mimeType.startsWith('image/')) return 'image'
  if (file.mimeType.startsWith('video/')) return 'video'
  if (file.mimeType.startsWith('audio/')) return 'audio'
  if (['doc', 'docx', 'odt', 'rtf', 'pages'].includes(e)) return 'word'
  if (['xls', 'xlsx', 'ods', 'csv', 'numbers'].includes(e)) return 'excel'
  if (['ppt', 'pptx', 'odp', 'key'].includes(e)) return 'slides'
  if (['zip', 'rar', '7z', 'gz', 'tar'].includes(e)) return 'archive'
  if (['txt', 'md', 'json', 'xml', 'log'].includes(e)) return 'text'
  return 'other'
}

/** Ce que le site sait afficher directement */
export type PreviewKind = 'pdf' | 'image' | 'video' | 'audio' | 'markdown' | 'csv' | 'text'

export function previewKind(file: DocFile): PreviewKind | null {
  const m = file.mimeType
  const e = file.ext
  if (m === 'application/pdf') return 'pdf'
  if (['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'].includes(m)) return 'image'
  if (['video/mp4', 'video/webm'].includes(m)) return 'video'
  if (['audio/mpeg', 'audio/wav', 'audio/ogg'].includes(m)) return 'audio'
  if (m === 'text/markdown' || ['md', 'markdown'].includes(e)) return 'markdown'
  if (m === 'text/csv' || e === 'csv') return 'csv'
  if (m === 'text/plain' || ['application/json', 'application/xml'].includes(m) || ['txt', 'log', 'json', 'xml'].includes(e)) return 'text'
  return null
}
