/** Envoi multipart avec suivi de progression (fetch ne le permet pas) */
export function uploadWithProgress<T>(url: string, method: 'POST' | 'PUT', form: FormData, onProgress?: (pct: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url)
    xhr.responseType = 'json'
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)) }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as T)
      else reject({ data: xhr.response || { message: `Erreur ${xhr.status}` } })
    }
    xhr.onerror = () => reject({ data: { message: 'Connexion interrompue pendant l\'envoi.' } })
    xhr.send(form)
  })
}

/** <input type="date"> → ISO fin de journée (heure locale) */
export function dateInputToIso(v: string) {
  return v ? new Date(`${v}T23:59:59`).toISOString() : null
}

/** ISO → valeur pour <input type="date"> */
export function isoToDateInput(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
