<script setup lang="ts">
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Aperçu des fichiers texte : Markdown mis en forme, CSV en tableau, texte brut
// rawAccess : bouton « Voir le texte brut » du Markdown (masqué si la prop est absente)
const props = defineProps<{ url: string, kind: 'markdown' | 'csv' | 'text', ext?: string, rawAccess?: boolean }>()
// rendered : le document est affiché (la page construit le sommaire à partir des titres)
const emit = defineEmits<{ rendered: [payload: { article: HTMLElement, frontMatter: string }] }>()

const MAX_CHARS = 2_000_000
const raw = ref('')
const loading = ref(true)
const error = ref('')
const truncated = ref(false)
const showSource = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch(props.url)
    if (!res.ok) throw new Error(res.status === 404 ? 'Fichier introuvable ou lien expiré.' : `Erreur ${res.status}`)
    let text = await res.text()
    truncated.value = text.length > MAX_CHARS
    if (truncated.value) text = text.slice(0, MAX_CHARS)
    raw.value = text
  } catch (e: any) {
    error.value = e?.message || 'Aperçu indisponible.'
  } finally {
    loading.value = false
  }
}
watch(() => props.url, load, { immediate: true })

// Identifiant lisible à partir d'un titre (« Zone Gestion SAV » → « zone-gestion-sav »)
function slugify(text: string) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// En-tête de configuration en tête du .md (--- … ---) : lu par le site, jamais affiché
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const markdownBody = computed(() => raw.value
  .replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
  // Image avec attributs MkDocs : ![alt](src){ width="600" } → <img … width="600">
  .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\{([^}\n]*)\}/g, (_m, alt: string, src: string, attrs: string) => {
    const w = attrs.match(/width\s*=\s*"?(\d+(?:px|%)?)"?/)?.[1]
    return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${w ? ` width="${w.replace('px', '')}"` : ''}>`
  }))

// Encadrés « > [!TIP] » (syntaxe GitHub) : titre par défaut selon le type
const CALLOUTS: Record<string, string> = { NOTE: 'Remarque', TIP: 'Astuce', IMPORTANT: 'Important', WARNING: 'Attention', CAUTION: 'Danger' }

function decorateCallouts(root: DocumentFragment) {
  root.querySelectorAll('blockquote').forEach((bq) => {
    const p = bq.querySelector(':scope > p')
    const m = p?.textContent?.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i)
    if (!p || !m) return
    const type = m[1]!.toUpperCase()
    // Retire le marqueur [!TYPE] du premier texte
    const first = Array.from(p.childNodes).find(n => n.nodeType === 3 && /\[!/.test(n.textContent || ''))
    if (first) first.textContent = (first.textContent || '').replace(/^\s*\[![A-Z]+\]\s*/i, '')
    // Titre : la ligne en gras qui suit le marqueur, sinon le titre par défaut
    const title = document.createElement('p')
    title.className = 'callout-title'
    const strong = p.querySelector(':scope > strong')
    const onlyStrong = strong && (p.textContent || '').trim() === (strong.textContent || '').trim()
    title.textContent = onlyStrong ? strong!.textContent : CALLOUTS[type]!
    if (onlyStrong || !(p.textContent || '').trim()) p.remove()
    else if (strong && p.firstElementChild === strong) { title.textContent = strong.textContent; strong.remove() }
    bq.prepend(title)
    bq.classList.add('callout', `callout-${type.toLowerCase()}`)
  })
}

// Sommaire écrit dans le .md : masqué (la page affiche déjà le sien à gauche)
const TOC_TITLE = /^(sommaire|table des mati[eè]res|contents|table of contents|toc)\s*:?$/i

function removeManualToc(root: DocumentFragment) {
  // Marqueurs [TOC] / [[_TOC_]]
  root.querySelectorAll('p').forEach((p) => {
    if (/^\s*\[\[?_?toc_?\]?\]\s*$/i.test(p.textContent || '')) p.remove()
  })
  root.querySelectorAll('h1, h2, h3, h4').forEach((h) => {
    if (!TOC_TITLE.test((h.textContent || '').trim())) return
    const level = Number(h.tagName[1])
    // Bloc du sommaire : jusqu'au prochain titre de même niveau (ou plus haut) ou au séparateur ---
    const block: Element[] = []
    for (let el = h.nextElementSibling; el; el = el.nextElementSibling) {
      if (/^H[1-6]$/.test(el.tagName) && Number(el.tagName[1]) <= level) break
      if (el.tagName === 'HR') { block.push(el); break }
      block.push(el)
    }
    // Uniquement s'il s'agit bien d'une liste de liens vers le document
    const links = block.flatMap(el => Array.from(el.querySelectorAll('a[href^="#"]')))
    const hasList = block.some(el => el.tagName === 'UL' || el.tagName === 'OL')
    if (!hasList || links.length < 3) return
    block.forEach(el => el.remove())
    h.remove()
  })
}

// Markdown → HTML nettoyé (aucun script)
const html = computed(() => {
  if (props.kind !== 'markdown' || !raw.value) return ''
  const out = marked.parse(markdownBody.value, { gfm: true, breaks: false, async: false }) as string
  const clean = DOMPurify.sanitize(out, { USE_PROFILES: { html: true }, ADD_ATTR: ['id', 'target'] })

  const tpl = document.createElement('template')
  tpl.innerHTML = clean
  decorateCallouts(tpl.content)
  removeManualToc(tpl.content)
  // Titres sans identifiant : on en crée un (liens #titre et partage d'une section)
  const used = new Set(Array.from(tpl.content.querySelectorAll('[id]')).map(el => el.id))
  tpl.content.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
    if (h.id) return
    let id = slugify(h.textContent || '') || 'section'
    for (let i = 2; used.has(id); i++) id = `${slugify(h.textContent || '')}-${i}`
    used.add(id)
    h.id = id
  })
  // Seuls les liens externes s'ouvrent dans un nouvel onglet ; les liens #ancre restent dans la page
  tpl.content.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || ''
    if (/^(https?:)?\/\//i.test(href) || href.startsWith('mailto:')) {
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
    } else {
      a.removeAttribute('target')
    }
  })
  return tpl.innerHTML
})

// Clic sur un lien interne (#ancre) : défilement jusqu'à la cible, sans passer par le routeur
const article = ref<HTMLElement | null>(null)

function scrollToAnchor(hash: string, smooth = true) {
  const id = decodeURIComponent(hash.replace(/^#/, ''))
  if (!id || !article.value) return false
  const target = article.value.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`)
  if (!target) return false
  for (let el: HTMLElement | null = target; el && el !== article.value; el = el.parentElement) {
    if (el.tagName === 'DETAILS') (el as HTMLDetailsElement).open = true
  }
  target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
  history.replaceState(history.state, '', `${location.pathname}${location.search}#${encodeURIComponent(id)}`)
  return true
}

function onArticleClick(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest('a')
  const href = a?.getAttribute('href') || ''
  if (!href.startsWith('#') || e.metaKey || e.ctrlKey || e.shiftKey) return
  e.preventDefault()
  scrollToAnchor(href)
}

// Diagrammes ```mermaid : bibliothèque chargée seulement si le document en contient
const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs'
async function renderMermaid() {
  const blocks = article.value?.querySelectorAll<HTMLElement>('pre > code.language-mermaid') ?? []
  if (!blocks.length) return
  let mermaid: any
  try {
    // Chargé depuis le CDN au premier diagramme (pas de dépendance npm à installer)
    mermaid = (await import(/* @vite-ignore */ MERMAID_URL)).default
  } catch {
    return // hors ligne : les diagrammes restent affichés en texte
  }
  const dark = document.documentElement.dataset.theme === 'dark'
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'neutral', fontFamily: 'Inter, system-ui, sans-serif' })
  let n = 0
  for (const code of Array.from(blocks)) {
    const pre = code.parentElement!
    try {
      const { svg } = await mermaid.render(`mmd-${Date.now()}-${n++}`, code.textContent || '')
      const fig = document.createElement('figure')
      fig.className = 'mermaid-figure'
      fig.innerHTML = svg
      pre.replaceWith(fig)
    } catch {
      pre.classList.add('mermaid-error') // diagramme invalide : on laisse le code visible
    }
  }
}

// En-tête de configuration brut (--- … ---), transmis à la page
const frontMatter = computed(() => raw.value.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n/)?.[1] ?? '')

// Après chaque rendu : diagrammes, sommaire de la page, puis lien partagé vers une section (…/docs/xxx#section)
watch([html, showSource], async ([value, source]) => {
  if (!value || source) return
  await nextTick()
  await renderMermaid()
  if (article.value) emit('rendered', { article: article.value, frontMatter: frontMatter.value })
  if (location.hash) scrollToAnchor(location.hash, false)
})

defineExpose({ scrollToAnchor })

// JSON indenté pour la lecture
const prettyText = computed(() => {
  if (props.ext === 'json') {
    try { return JSON.stringify(JSON.parse(raw.value), null, 2) } catch {}
  }
  return raw.value
})

// CSV : séparateur détecté (; , ou tabulation), guillemets gérés
const table = computed(() => {
  if (props.kind !== 'csv' || !raw.value) return [] as string[][]
  const firstLine = raw.value.split(/\r?\n/, 1)[0] || ''
  const sep = [';', ',', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0]!
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const t = raw.value
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === sep) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
      if (rows.length >= 2000) break
    } else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(r => r.some(v => v.trim() !== ''))
})
</script>

<template>
  <div class="text-preview">
    <div v-if="loading" class="state"><AppIcon name="loader" :size="18" /> Chargement de l'aperçu…</div>
    <div v-else-if="error" class="state alert alert-warning"><AppIcon name="alert" :size="17" />{{ error }}</div>
    <template v-else>
      <div v-if="kind === 'markdown' && rawAccess" class="toolbar">
        <button type="button" class="btn btn-ghost btn-sm" @click="showSource = !showSource">
          <AppIcon :name="showSource ? 'eye' : 'file'" :size="15" />{{ showSource ? 'Voir la mise en forme' : 'Voir le texte brut' }}
        </button>
      </div>
      <!-- eslint-disable-next-line vue/no-v-html -->
      <article v-if="kind === 'markdown' && !showSource" ref="article" class="prose" @click="onArticleClick" v-html="html" />
      <div v-else-if="kind === 'csv'" class="table-wrap">
        <table>
          <thead v-if="table.length"><tr><th v-for="(h, i) in table[0]" :key="i">{{ h }}</th></tr></thead>
          <tbody><tr v-for="(r, i) in table.slice(1)" :key="i"><td v-for="(v, j) in r" :key="j">{{ v }}</td></tr></tbody>
        </table>
      </div>
      <pre v-else class="raw">{{ kind === 'markdown' ? raw : prettyText }}</pre>
      <p v-if="truncated" class="hint more">Aperçu tronqué : téléchargez le fichier pour le voir en entier.</p>
    </template>
  </div>
</template>

<style scoped>
.text-preview { padding: 20px; }
@media (min-width: 768px) { .text-preview { padding: 28px 36px; } }
.state { display: flex; align-items: center; gap: 8px; color: var(--muted); }
.toolbar { display: flex; justify-content: flex-end; margin: -8px -8px 8px 0; }
.raw { margin: 0; white-space: pre-wrap; word-break: break-word; font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; max-height: 75vh; overflow: auto; }
.more { margin-top: 12px; }
.table-wrap { overflow: auto; max-height: 75vh; border: 1px solid var(--border); border-radius: var(--radius-sm); }
table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
th, td { padding: 8px 12px; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; }
th { position: sticky; top: 0; background: var(--surface-2); font-weight: 600; }
tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--surface-2) 50%, transparent); }

/* Mise en forme du Markdown */
.prose { max-width: 760px; margin: 0 auto; font-size: 15.5px; line-height: 1.7; color: var(--text); overflow-wrap: break-word; }
.prose :deep(> *:first-child) { margin-top: 0; }
/* Menus déroulants : <details><summary>Titre</summary> … </details> */
.prose :deep(details) { border: 1px solid var(--border); border-radius: var(--radius-sm); margin: 0 0 1em; background: var(--surface); overflow: hidden; }
.prose :deep(details > summary) {
  list-style: none; cursor: pointer; user-select: none;
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; font-weight: 600; transition: background .15s;
}
.prose :deep(details > summary::-webkit-details-marker) { display: none; }
.prose :deep(details > summary::before) {
  content: ''; flex: none; width: 8px; height: 8px;
  border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted);
  transform: rotate(-45deg); transition: transform .2s;
}
.prose :deep(details[open] > summary::before) { transform: rotate(45deg); }
.prose :deep(details > summary:hover) { background: var(--surface-2); }
.prose :deep(details[open] > summary) { border-bottom: 1px solid var(--border); }
.prose :deep(details > :not(summary)) { margin-left: 16px; margin-right: 16px; }
.prose :deep(details > :nth-child(2)) { margin-top: 14px; }
.prose :deep(details > :last-child) { margin-bottom: 14px; }
.prose :deep(details details) { margin-top: 8px; }
@media print { .prose :deep(details) { break-inside: avoid; } }

/* La cible d'une ancre ne passe pas sous la barre du haut */
.prose :deep([id]) { scroll-margin-top: 84px; }
.prose :deep(h1) { font-size: 1.8em; margin: 1.4em 0 .6em; }
.prose :deep(h2) { font-size: 1.4em; margin: 1.6em 0 .6em; padding-bottom: .3em; border-bottom: 1px solid var(--border); }
.prose :deep(h3) { font-size: 1.15em; margin: 1.4em 0 .5em; }
.prose :deep(h4) { font-size: 1em; margin: 1.2em 0 .4em; }
.prose :deep(p), .prose :deep(ul), .prose :deep(ol), .prose :deep(blockquote), .prose :deep(pre), .prose :deep(table) { margin: 0 0 1em; }
.prose :deep(ul), .prose :deep(ol) { padding-left: 1.4em; }
.prose :deep(li + li) { margin-top: .25em; }
.prose :deep(a) { color: var(--primary); text-decoration: underline; text-underline-offset: 2px; }
.prose :deep(code) { font: .88em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--surface-2); padding: .15em .4em; border-radius: 5px; }
.prose :deep(pre) { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 14px 16px; overflow: auto; }
.prose :deep(pre code) { background: none; padding: 0; font-size: 13px; }
.prose :deep(blockquote) { border-left: 3px solid var(--primary); padding: .2em 0 .2em 1em; color: var(--muted); }
/* Encadrés > [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION] */
.prose :deep(.callout) { --c: #2453d8; border: 1px solid color-mix(in srgb, var(--c) 30%, transparent); border-left: 4px solid var(--c); background: color-mix(in srgb, var(--c) 7%, var(--surface)); border-radius: var(--radius-sm); padding: 12px 16px; color: var(--text); }
.prose :deep(.callout > :last-child) { margin-bottom: 0; }
.prose :deep(.callout-title) { display: flex; align-items: center; gap: 8px; font-weight: 700; color: var(--c); margin-bottom: 6px; }
.prose :deep(.callout-title::before) { content: var(--i); font-size: 1.05em; }
.prose :deep(.callout-note) { --c: #2453d8; --i: 'ℹ️'; }
.prose :deep(.callout-tip) { --c: #16825d; --i: '💡'; }
.prose :deep(.callout-important) { --c: #7c3aed; --i: '📌'; }
.prose :deep(.callout-warning) { --c: #b45309; --i: '⚠️'; }
.prose :deep(.callout-caution) { --c: #c4314b; --i: '⛔'; }
.prose :deep(table) { border-collapse: collapse; display: block; overflow-x: auto; }
.prose :deep(th), .prose :deep(td) { border: 1px solid var(--border); padding: 6px 12px; }
.prose :deep(th) { background: var(--surface-2); }
.prose :deep(img) { max-width: 100%; border-radius: var(--radius-sm); }
.prose :deep(.mermaid-figure) { margin: 0 0 1.2em; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); overflow-x: auto; text-align: center; }
.prose :deep(.mermaid-figure svg) { max-width: 100%; height: auto; }
.prose :deep(hr) { border: 0; border-top: 1px solid var(--border); margin: 2em 0; }
</style>
