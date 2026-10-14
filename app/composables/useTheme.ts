export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'doc-theme'

// Thème de l'interface : clair par défaut, choix mémorisé dans le navigateur
export function useTheme() {
  const theme = useState<Theme>('theme', () => {
    if (import.meta.client && document.documentElement.dataset.theme === 'dark') return 'dark'
    return 'light'
  })

  function apply(value: Theme) {
    const root = document.documentElement
    root.classList.add('theme-switching')
    if (value === 'dark') root.dataset.theme = 'dark'
    else delete root.dataset.theme
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', value === 'dark' ? '#0e1116' : '#f6f7fb')
    try { localStorage.setItem(STORAGE_KEY, value) } catch {}
    setTimeout(() => root.classList.remove('theme-switching'), 300)
  }

  function toggle() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
    apply(theme.value)
  }

  return { theme, toggle }
}
