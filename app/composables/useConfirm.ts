export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  danger?: boolean
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

// Boîte de confirmation (remplace window.confirm)
export function useConfirm() {
  const pending = useState<PendingConfirm | null>('confirm', () => null)

  function confirm(options: ConfirmOptions) {
    return new Promise<boolean>((resolve) => {
      pending.value = { ...options, resolve }
    })
  }

  function answer(ok: boolean) {
    pending.value?.resolve(ok)
    pending.value = null
  }

  return { pending, confirm, answer }
}
