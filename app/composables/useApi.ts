import AES from 'crypto-js/aes'
import Utf8 from 'crypto-js/enc-utf8'

// Appels vers le serveur Express (/api/v1) : body { data: encrypt(...) }, réponse encrypt({ code, message, data })
export function useApi() {
  const config = useRuntimeConfig()
  const base = String(config.public.apiBase || '/api/v1').replace(/\/+$/, '')
  const key = String(config.public.cryptageKey || '')

  // Origine de l'API : les liens de fichiers renvoyés par le serveur (« /api/v1/doc_file/… ») y sont rattachés
  const origin = /^https?:\/\//.test(base) ? new URL(base).origin : ''

  function absoluteFileUrls(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(absoluteFileUrls)
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) {
        out[k] = k === 'fileUrl' && typeof v === 'string' && v.startsWith('/') ? origin + v : absoluteFileUrls(v)
      }
      return out
    }
    return value
  }

  const encrypt = (datas: unknown) => AES.encrypt(JSON.stringify(datas), key).toString()
  const decrypt = <T>(data: string): T => JSON.parse(AES.decrypt(data, key).toString(Utf8))

  function unpack<T>(raw: unknown): T {
    let res: { code: number, message: string, data: T }
    try {
      res = decrypt(String(raw))
    } catch {
      throw { data: { message: 'Réponse illisible du serveur (clé de chiffrement différente ?).' } }
    }
    if (res.code !== 0) throw { data: { message: res.message || 'Une erreur est survenue.' } }
    return absoluteFileUrls(res.data) as T
  }

  async function post<T = unknown>(route: string, body: Record<string, unknown> = {}): Promise<T> {
    const raw = await $fetch<string>(`${base}/${route}`, { method: 'POST', body: { data: encrypt(body) } })
    return unpack<T>(raw)
  }

  // Envoi de fichier : data chiffré + fichier en multipart, avec progression
  async function upload<T = unknown>(route: string, body: Record<string, unknown>, file: File, onProgress?: (pct: number) => void): Promise<T> {
    const fd = new FormData()
    fd.append('data', encrypt(body))
    fd.append('file', file)
    const raw = await uploadWithProgress<string>(`${base}/${route}`, 'POST', fd, onProgress)
    return unpack<T>(raw)
  }

  return { post, upload }
}
