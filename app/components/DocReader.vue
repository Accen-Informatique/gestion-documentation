<script setup lang="ts">
// Lecture d'un document Markdown : sommaire par parties à gauche, sous-sections à droite,
// section en cours suivie pendant la lecture, recherche, progression, panneau mobile
// rawAccess : accès au texte brut du Markdown (transmis à DocTextPreview)
const props = defineProps<{ url: string, ext?: string, title?: string, rawAccess?: boolean }>()

interface Sub { id: string, text: string }
interface Section { id: string, text: string, subs: Sub[] }
interface Chapter { id: string, text: string, sections: Section[], faq: boolean, questions: number }
interface Part { name: string, chapters: Chapter[] }
interface Entry { id: string, text: string, kind: string, context: string }
interface Marker { el: HTMLElement, chapter: string, section: string, sub: string }

const preview = ref<{ scrollToAnchor: (hash: string, smooth?: boolean) => boolean } | null>(null)
const parts = ref<Part[]>([])
const chapters = ref<Chapter[]>([])
const entries = ref<Entry[]>([])
const docTitle = ref('')
const activeChapter = ref('')
const activeSection = ref('')
const activeSub = ref('')
const progress = ref(0)
const query = ref('')
const tocOpen = ref(false)
const showTop = ref(false)
const content = ref<HTMLElement | null>(null)
let markers: Marker[] = []

const clean = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim()
const key = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase()

// En-tête de configuration : « titre: … » et « parties: » (Nom: [Chapitre, Chapitre])
function readFrontMatter(fm: string) {
  const title = fm.match(/^titre\s*:\s*(.+)$/m)?.[1]?.trim() ?? ''
  const groups: { name: string, items: string[] }[] = []
  let inParts = false
  for (const line of fm.split(/\r?\n/)) {
    if (/^parties\s*:\s*$/.test(line)) { inParts = true; continue }
    if (!inParts) continue
    const m = line.match(/^\s+(.+?)\s*:\s*\[(.*)\]\s*$/)
    if (m) groups.push({ name: m[1]!.trim(), items: m[2]!.split(',').map(x => x.trim()).filter(Boolean) })
    else if (/^\S/.test(line)) inParts = false
  }
  return { title, groups }
}

function onRendered({ article, frontMatter }: { article: HTMLElement, frontMatter: string }) {
  const fm = readFrontMatter(frontMatter)
  let headings = Array.from(article.querySelectorAll<HTMLElement>('h1, h2, h3'))

  // Le premier # est le titre du document s'il y a plusieurs chapitres
  const h1s = headings.filter(h => h.tagName === 'H1')
  docTitle.value = fm.title
  if (h1s.length > 1 && [fm.title, props.title || ''].some(t => t && key(t) === key(h1s[0]!.textContent || ''))) {
    docTitle.value = clean(h1s[0]!.textContent)
    headings = headings.filter(h => h !== h1s[0])
  }
  // Sans # : les ## deviennent les chapitres
  const lv = headings.some(h => h.tagName === 'H1') ? { c: 'H1', s: 'H2', u: 'H3' } : { c: 'H2', s: 'H3', u: '' }

  const list: Chapter[] = []
  const marks: Marker[] = []
  for (const h of headings) {
    const text = clean(h.textContent)
    if (!text || !h.id || /^sommaire$/i.test(text)) continue
    const ch = list[list.length - 1]
    const sec = ch?.sections[ch.sections.length - 1]
    if (h.tagName === lv.c) {
      list.push({ id: h.id, text, sections: [], faq: false, questions: 0 })
      marks.push({ el: h, chapter: h.id, section: '', sub: '' })
    } else if (h.tagName === lv.s && ch) {
      ch.sections.push({ id: h.id, text, subs: [] })
      marks.push({ el: h, chapter: ch.id, section: h.id, sub: '' })
    } else if (h.tagName === lv.u && ch && sec) {
      sec.subs.push({ id: h.id, text })
      marks.push({ el: h, chapter: ch.id, section: sec.id, sub: h.id })
    }
  }

  // Questions repliables (<details> dont le titre finit par « ? ») : FAQ si au moins 5 dans un chapitre
  const qEntries: Entry[] = []
  let current: Chapter | undefined
  let n = 0
  const chapterById = new Map(list.map(c => [c.id, c]))
  article.querySelectorAll<HTMLElement>(`${lv.c.toLowerCase()}, details > summary`).forEach((el) => {
    if (el.tagName === lv.c) { current = chapterById.get(el.id) ?? current; return }
    const details = el.parentElement as HTMLDetailsElement
    if (!details.id) details.id = `question-${++n}`
    const text = clean(el.textContent)
    if (current && /\?\s*$/.test(text)) current.questions++
    qEntries.push({ id: details.id, text, kind: /\?\s*$/.test(text) ? 'Question' : 'Bloc', context: current?.text ?? '' })
  })
  list.forEach((c) => { c.faq = c.questions >= 5 })

  // Index de recherche : titres + questions
  const idx: Entry[] = []
  list.forEach((c) => {
    idx.push({ id: c.id, text: c.text, kind: 'Chapitre', context: '' })
    c.sections.forEach((s) => {
      idx.push({ id: s.id, text: s.text, kind: 'Section', context: c.text })
      s.subs.forEach(u => idx.push({ id: u.id, text: u.text, kind: 'Sous-section', context: s.text }))
    })
  })

  // Regroupement en parties (en-tête du .md) ; chapitres non cités à la suite
  const used = new Set<string>()
  const grouped: Part[] = fm.groups.map(g => ({
    name: g.name,
    chapters: list.filter((c) => {
      if (used.has(c.id)) return false
      const ok = g.items.some(i => key(i) && (key(c.text) === key(i) || key(c.text).includes(key(i)) || key(i).includes(key(c.text))))
      if (ok) used.add(c.id)
      return ok
    })
  })).filter(p => p.chapters.length)
  const rest = list.filter(c => !used.has(c.id))
  if (rest.length) grouped.push({ name: grouped.length ? 'Autres' : '', chapters: rest })

  chapters.value = list
  parts.value = grouped
  entries.value = [...idx, ...qEntries]
  markers = marks
  nextTick(updateActive)
}

// Section en cours : dernier titre passé sous la barre du haut
let ticking = false
function updateActive() {
  ticking = false
  // Ligne de lecture : sous l'en-tête (+ la barre « Sommaire » sur mobile)
  const line = window.innerWidth < 960 ? 170 : 110
  let hit: Marker | undefined
  for (const m of markers) {
    if (m.el.getBoundingClientRect().top - line <= 0) hit = m
    else break
  }
  hit ??= markers[0]
  activeChapter.value = hit?.chapter ?? ''
  activeSection.value = hit?.section ?? ''
  activeSub.value = hit?.sub ?? ''
  const box = content.value?.getBoundingClientRect()
  if (box) {
    const total = box.height - window.innerHeight + 120
    progress.value = Math.min(1, Math.max(0, total > 0 ? (120 - box.top) / total : 1))
  }
  showTop.value = window.scrollY > 900
}
function onScroll() {
  if (!ticking) { ticking = true; requestAnimationFrame(updateActive) }
}
onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }))
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))

function scrollToTop() {
  // Loin du haut : saut direct, comme pour le sommaire (pas de chargement de toutes les images du trajet)
  window.scrollTo({ top: 0, behavior: window.scrollY > window.innerHeight * 2 ? 'auto' : 'smooth' })
}

function go(id: string) {
  tocOpen.value = false
  nextTick(() => preview.value?.scrollToAnchor(`#${id}`))
}

const chapter = computed(() => chapters.value.find(c => c.id === activeChapter.value))
const section = computed(() => chapter.value?.sections.find(s => s.id === activeSection.value))
const nextChapter = computed(() => {
  const i = chapters.value.findIndex(c => c.id === activeChapter.value)
  return i >= 0 ? chapters.value[i + 1] : undefined
})
// Colonne de droite : thèmes de la FAQ, sous-sections de la section, ou sections du chapitre
const rail = computed(() => {
  if (!chapter.value) return null
  if (chapter.value.faq) return { title: 'Thèmes', items: chapter.value.sections, active: activeSection.value }
  if (section.value?.subs.length) return { title: 'Dans cette section', items: section.value.subs, active: activeSub.value }
  if (chapter.value.sections.length) return { title: 'Dans ce chapitre', items: chapter.value.sections, active: activeSection.value }
  return null
})
</script>

<template>
  <div class="reader">
    <div class="progress" :style="{ transform: `scaleX(${progress})` }" aria-hidden="true" />

    <!-- Mobile : barre « Sommaire » + section en cours -->
    <div v-if="chapters.length" class="mobile-bar">
      <button type="button" class="btn btn-sm" @click="tocOpen = true"><AppIcon name="book" :size="15" />Sommaire</button>
      <span class="where truncate">
        <template v-if="chapter">{{ chapter.text }}</template>
        <template v-if="section"> › <b>{{ section.text }}</b></template>
      </span>
    </div>

    <aside v-if="chapters.length" class="toc">
      <DocOutlineTree
        v-model:query="query" :parts="parts" :entries="entries" :doc-title="docTitle"
        :active-chapter="activeChapter" :active-section="activeSection" @go="go"
      />
    </aside>

    <div ref="content" class="content card">
      <DocTextPreview ref="preview" :url="url" kind="markdown" :ext="ext" :raw-access="rawAccess" @rendered="onRendered" />
    </div>

    <aside v-if="chapters.length" class="rail">
      <template v-if="rail">
        <div class="rail-title">{{ rail.title }}</div>
        <a
          v-for="item in rail.items" :key="item.id" :href="`#${item.id}`"
          :class="{ on: item.id === rail.active }" @click.prevent="go(item.id)"
        >{{ item.text }}</a>
      </template>
      <template v-if="nextChapter">
        <div class="rail-title next-title">Chapitre suivant</div>
        <a class="next" :href="`#${nextChapter.id}`" @click.prevent="go(nextChapter.id)">{{ nextChapter.text }} →</a>
      </template>
    </aside>

    <button v-show="showTop" type="button" class="to-top" aria-label="Revenir en haut" @click="scrollToTop">
      <AppIcon name="chevron-down" :size="18" />
    </button>

    <AppModal :open="tocOpen" title="Sommaire" :width="420" @close="tocOpen = false">
      <DocOutlineTree
        v-model:query="query" :parts="parts" :entries="entries"
        :active-chapter="activeChapter" :active-section="activeSection" @go="go"
      />
    </AppModal>
  </div>
</template>

<style scoped>
.reader { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
.progress { position: fixed; top: calc(60px + env(safe-area-inset-top)); left: 0; right: 0; height: 3px; background: var(--primary); transform-origin: left; z-index: 21; pointer-events: none; }
.content { min-width: 0; }
.toc, .rail { min-width: 0; }
.toc, .rail { display: none; }

.mobile-bar {
  position: sticky; top: calc(60px + env(safe-area-inset-top)); z-index: 15;
  display: flex; align-items: center; gap: 10px; margin: 0 -16px; padding: 8px 16px;
  background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--border); font-size: 13.5px;
}
.mobile-bar .btn { flex: none; }
.where { color: var(--muted); min-width: 0; }
.where b { color: var(--text); font-weight: 600; }

/* Tablette / ordinateur : sommaire à gauche */
@media (min-width: 960px) {
  .reader { grid-template-columns: 260px minmax(0, 1fr); gap: 28px; }
  .mobile-bar { display: none; }
  .toc { display: flex; position: sticky; top: 84px; max-height: calc(100vh - 104px); width: 260px; }
  .toc > * { flex: 1; min-width: 0; }
}
/* Grand écran : colonne de droite */
@media (min-width: 1280px) {
  .reader { grid-template-columns: 260px minmax(0, 1fr) 210px; }
  .rail { display: flex; flex-direction: column; position: sticky; top: 84px; max-height: calc(100vh - 104px); overflow-y: auto; font-size: 13px; }
}
.rail-title { font-size: 11.5px; text-transform: uppercase; letter-spacing: .07em; color: var(--faint); font-weight: 700; margin-bottom: 8px; }
.next-title { margin-top: 22px; }
.rail a { display: block; padding: 4px 0 4px 12px; border-left: 2px solid var(--border); color: var(--muted); line-height: 1.4; }
.rail a:hover { color: var(--text); }
.rail a.on { color: var(--primary); border-left-color: var(--primary); font-weight: 600; }
.rail a.next { border: 0; padding-left: 0; }

.to-top {
  position: fixed; right: 20px; bottom: calc(20px + env(safe-area-inset-bottom)); z-index: 20;
  width: 42px; height: 42px; border-radius: 50%; border: 1px solid var(--border); background: var(--surface);
  box-shadow: var(--shadow); display: grid; place-items: center; cursor: pointer; color: var(--muted);
}
.to-top svg { transform: rotate(180deg); }
.to-top:hover { color: var(--text); }
@media print { .toc, .rail, .mobile-bar, .progress, .to-top { display: none !important; } .reader { display: block; } }
</style>
