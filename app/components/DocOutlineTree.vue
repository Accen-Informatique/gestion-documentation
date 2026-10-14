<script setup lang="ts">
// Sommaire d'un document : parties → chapitres → sections, avec recherche
export interface OutlineSub { id: string, text: string }
export interface OutlineSection { id: string, text: string, subs: OutlineSub[] }
export interface OutlineChapter { id: string, text: string, sections: OutlineSection[], faq: boolean, questions: number }
export interface OutlinePart { name: string, chapters: OutlineChapter[] }
export interface OutlineEntry { id: string, text: string, kind: string, context: string }

const props = defineProps<{
  parts: OutlinePart[]
  entries: OutlineEntry[]
  activeChapter: string
  activeSection: string
  docTitle?: string
}>()
const emit = defineEmits<{ go: [id: string] }>()
const query = defineModel<string>('query', { default: '' })

const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

// Résultats de recherche : titres et questions de FAQ, 40 au maximum
const results = computed(() => {
  const words = normalize(query.value.trim()).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return props.entries.filter((e) => {
    const hay = normalize(`${e.text} ${e.context}`)
    return words.every(w => hay.includes(w))
  }).slice(0, 40)
})

// Chapitres dépliés à la main en plus du chapitre en cours
const opened = ref(new Set<string>())
function isOpen(c: OutlineChapter) {
  return c.id === props.activeChapter || opened.value.has(c.id)
}
function toggle(c: OutlineChapter) {
  const s = new Set(opened.value)
  s.has(c.id) ? s.delete(c.id) : s.add(c.id)
  opened.value = s
}
function go(id: string) {
  emit('go', id)
  query.value = ''
}

// Raccourci « / » : focus sur la recherche
const input = ref<HTMLInputElement | null>(null)
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement
  if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(t.tagName) && !t.isContentEditable && input.value?.offsetParent) {
    e.preventDefault()
    input.value?.focus()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="outline">
    <div v-if="docTitle" class="doc-title">{{ docTitle }}</div>
    <label class="search">
      <AppIcon name="search" :size="15" />
      <input ref="input" v-model="query" type="search" placeholder="Rechercher…" aria-label="Rechercher dans le document">
      <kbd v-if="!query">/</kbd>
    </label>

    <!-- Résultats de recherche -->
    <div v-if="query.trim()" class="results">
      <p v-if="!results.length" class="none">Aucun résultat.</p>
      <button v-for="r in results" :key="r.id" type="button" class="result" @click="go(r.id)">
        <span class="r-kind">{{ r.kind }}<template v-if="r.context"> · {{ r.context }}</template></span>
        <span class="r-text">{{ r.text }}</span>
      </button>
    </div>

    <!-- Plan du document -->
    <nav v-else class="tree" aria-label="Sommaire du document">
      <template v-for="part in parts" :key="part.name">
        <div v-if="part.name" class="part">{{ part.name }}</div>
        <div v-for="c in part.chapters" :key="c.id" class="chapter" :class="{ current: c.id === activeChapter }">
          <div class="ch-row">
            <button
              v-if="c.sections.length && !c.faq" type="button" class="chev" :class="{ open: isOpen(c) }"
              :aria-label="isOpen(c) ? 'Replier' : 'Déplier'" @click="toggle(c)"
            />
            <span v-else class="chev-space" />
            <a :href="`#${c.id}`" class="ch-link" :title="c.text" @click.prevent="go(c.id)">{{ c.text }}</a>
            <span v-if="c.faq" class="count">{{ c.questions }} questions</span>
            <span v-else-if="c.sections.length && c.id !== activeChapter" class="count">{{ c.sections.length }}</span>
          </div>
          <ul v-if="isOpen(c) && !c.faq && c.sections.length">
            <li v-for="s in c.sections" :key="s.id" :class="{ active: s.id === activeSection }">
              <a :href="`#${s.id}`" :title="s.text" @click.prevent="go(s.id)">{{ s.text }}</a>
            </li>
          </ul>
        </div>
      </template>
    </nav>
  </div>
</template>

<style scoped>
.outline { display: flex; flex-direction: column; gap: 10px; min-height: 0; min-width: 0; width: 100%; max-width: 100%; }
.doc-title { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--faint); font-weight: 700; padding: 0 4px; }
.search {
  display: flex; align-items: center; gap: 10px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  padding: 0 10px 0 14px; color: var(--faint); cursor: text;
  transition: border-color .15s, box-shadow .15s;
}
.search:focus-within { border-color: var(--primary); box-shadow: var(--ring); }
.search input {
  flex: 1; min-width: 0; border: 0; outline: none; background: transparent;
  padding: 10px 4px; font-size: 14px; color: var(--text);
  -webkit-appearance: none; appearance: none;
}
/* Le cadre bleu est porté par le champ entier, pas par la zone de saisie */
.search input:focus, .search input:focus-visible { outline: none; box-shadow: none; }
.search input::placeholder { color: var(--faint); }
.search input::-webkit-search-cancel-button { -webkit-appearance: none; }
.search kbd { flex: none; font: 11px ui-monospace, monospace; border: 1px solid var(--border); border-radius: 5px; padding: 1px 6px; }
.tree, .results { overflow-y: auto; overflow-x: hidden; min-height: 0; padding-right: 6px; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
.tree::-webkit-scrollbar, .results::-webkit-scrollbar { width: 6px; }
.tree::-webkit-scrollbar-thumb, .results::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; }
.tree, .chapter, .ch-row, ul, li { min-width: 0; max-width: 100%; }
.part { font-size: 11.5px; text-transform: uppercase; letter-spacing: .07em; color: var(--faint); font-weight: 700; margin: 14px 0 4px 8px; }
.part:first-child { margin-top: 4px; }
.chapter { border-radius: 9px; margin-bottom: 1px; }
.chapter.current > .ch-row { background: var(--surface); border: 1px solid var(--border); }
.ch-row { display: flex; align-items: center; gap: 2px; padding: 2px 8px 2px 2px; border-radius: 9px; border: 1px solid transparent; }
.ch-row:hover { background: var(--surface-2); }
.chapter.current > .ch-row:hover { background: var(--surface); }
.chev, .chev-space { width: 24px; height: 28px; flex: none; }
.chev { border: 0; background: none; cursor: pointer; position: relative; border-radius: 6px; }
.chev::before { content: ''; position: absolute; left: 9px; top: 11px; width: 6px; height: 6px; border-right: 2px solid var(--faint); border-bottom: 2px solid var(--faint); transform: rotate(-45deg); transition: transform .15s; }
.chev.open::before { transform: rotate(45deg); top: 9px; }
.ch-link { flex: 1; min-width: 0; padding: 5px 0; font-size: 14px; font-weight: 500; color: #3a4152; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
:root[data-theme="dark"] .ch-link { color: var(--muted); }
.chapter.current .ch-link { color: var(--text); font-weight: 700; }
.count { flex: none; font-size: 11px; font-weight: 600; color: var(--faint); white-space: nowrap; margin-left: 6px; }
ul { list-style: none; margin: 4px 0 8px 24px; padding: 0; border-left: 2px solid var(--border); }
/* Titres longs : 2 lignes maximum, jamais de débordement */
li a {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2;
  max-width: calc(100% + 2px); box-sizing: border-box; margin-left: -2px; padding: 4px 10px;
  border-left: 2px solid transparent; font-size: 13.5px; line-height: 1.4; color: var(--muted);
  overflow: hidden; overflow-wrap: anywhere;
}
li a:hover { color: var(--text); }
li.active a { color: var(--primary); font-weight: 600; border-left-color: var(--primary); }
.results { display: flex; flex-direction: column; gap: 2px; }
.result { all: unset; display: flex; flex-direction: column; gap: 1px; padding: 7px 10px; border-radius: 8px; cursor: pointer; }
.result:hover, .result:focus-visible { background: var(--surface-2); }
.r-kind { font-size: 11px; color: var(--faint); text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.r-text { font-size: 13.5px; color: var(--text); overflow-wrap: anywhere; }
.none { color: var(--muted); font-size: 13.5px; padding: 8px; }
</style>
