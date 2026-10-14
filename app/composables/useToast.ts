export interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

let seq = 0

export function useToast() {
  const toasts = useState<Toast[]>('toasts', () => [])

  function push(message: string, type: Toast['type'] = 'success', ms = 3800) {
    const id = ++seq
    toasts.value = [...toasts.value, { id, message, type }]
    setTimeout(() => dismiss(id), ms)
  }

  function dismiss(id: number) {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }

  return {
    toasts,
    dismiss,
    success: (m: string) => push(m, 'success'),
    error: (m: string) => push(m, 'error', 6000),
    info: (m: string) => push(m, 'info')
  }
}
