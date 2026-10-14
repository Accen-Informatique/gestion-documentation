export interface SessionToken {
  /** Le code d'accès lui-même (conservé dans ce navigateur) */
  ref: string
  label: string
  expiresAt: string | null
}

export interface SessionInfo {
  isAdmin: boolean
  adminConfigured: boolean
  tokens: SessionToken[]
}

const CODES_KEY = 'doc-codes'
const ADMIN_KEY = 'doc-admin'
const ADMIN_TTL_MS = 12 * 60 * 60 * 1000

function readJson<T>(storage: Storage, key: string, fallback: T): T {
  try { return JSON.parse(storage.getItem(key) || '') as T } catch { return fallback }
}

// Codes clients (localStorage) et token admin (12 h), envoyés au serveur à chaque appel
export function useAccess() {
  const session = useState<SessionInfo | null>('session', () => null)
  const tokenDialogOpen = useState('tokenDialogOpen', () => false)
  const api = useApi()

  function adminToken(): string | null {
    if (!import.meta.client) return null
    const a = readJson<{ token: string, until: number } | null>(localStorage, ADMIN_KEY, null)
    if (a && a.until > Date.now()) return a.token
    try { localStorage.removeItem(ADMIN_KEY) } catch {}
    return null
  }

  function codes(): string[] {
    return (session.value?.tokens ?? []).map(t => t.ref)
  }

  function save(tokens: SessionToken[]) {
    session.value = { isAdmin: !!adminToken(), adminConfigured: true, tokens }
    try { localStorage.setItem(CODES_KEY, JSON.stringify(tokens)) } catch {}
  }

  /** Recharge l'état depuis le navigateur (les codes sont revalidés par le serveur à chaque liste) */
  async function refresh() {
    const stored = import.meta.client ? readJson<SessionToken[]>(localStorage, CODES_KEY, []) : []
    session.value = { isAdmin: !!adminToken(), adminConfigured: true, tokens: Array.isArray(stored) ? stored : [] }
    return session.value
  }

  /** Remplace les codes par ceux que le serveur considère encore valides */
  function syncCodes(valid: { code: string, label: string, expiresAt: string | null }[]) {
    const next = valid.map(v => ({ ref: v.code, label: v.label, expiresAt: v.expiresAt }))
    const same = JSON.stringify(next) === JSON.stringify(session.value?.tokens ?? [])
    if (!same) save(next)
  }

  async function addCode(raw: string) {
    const res = await api.post<{ code: string, label: string, expiresAt: string | null, documentCount: number }>('doc_check_code', { code: raw })
    save([...codes().filter(c => c !== res.code).map(c => session.value!.tokens.find(t => t.ref === c)!), { ref: res.code, label: res.label, expiresAt: res.expiresAt }])
    return res
  }

  async function removeToken(ref: string) {
    save((session.value?.tokens ?? []).filter(t => t.ref !== ref))
  }

  async function adminLogin(token: string) {
    await api.post('doc_admin_login', { adminToken: token })
    try { localStorage.setItem(ADMIN_KEY, JSON.stringify({ token, until: Date.now() + ADMIN_TTL_MS })) } catch {}
    save(session.value?.tokens ?? [])
  }

  function adminLogout() {
    try { localStorage.removeItem(ADMIN_KEY) } catch {}
    save(session.value?.tokens ?? [])
  }

  /** Body d'un appel admin */
  function asAdmin(body: Record<string, unknown> = {}) {
    return { ...body, adminToken: adminToken() }
  }

  /** Body d'un appel visiteur (codes + admin éventuel) */
  function withAccess(body: Record<string, unknown> = {}) {
    return { ...body, codes: codes(), adminToken: adminToken() || undefined }
  }

  return { session, tokenDialogOpen, refresh, syncCodes, addCode, removeToken, adminLogin, adminLogout, asAdmin, withAccess }
}
