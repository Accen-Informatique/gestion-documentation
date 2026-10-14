<script setup lang="ts">
import type { DocItem } from '../../utils/format'

const route = useRoute()
const id = computed(() => String(route.params.id))
const { session, refresh, withAccess } = useAccess()
const api = useApi()

const doc = ref<DocItem | null>(null)
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    if (!session.value) await refresh()
    doc.value = await api.post<DocItem>('doc_get_document', withAccess({ id: id.value }))
  } catch (e) {
    doc.value = null
    error.value = errorMessage(e, 'Document introuvable.')
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => session.value?.tokens.length, (v, old) => { if (old !== undefined && !doc.value) load() })

useHead(() => ({ title: doc.value ? `${doc.value.title} · Documentation` : 'Documentation' }))

const fileUrl = computed(() => doc.value?.fileUrl ?? '')
const preview = computed(() => doc.value && !doc.value.file.missing ? previewKind(doc.value.file) : null)
// Accès au fichier brut (Ouvrir, Télécharger, texte brut) : un document Markdown se consulte
// en ligne par tous, mais seul un administrateur peut récupérer le fichier lui-même
const rawAccess = computed(() => preview.value !== 'markdown' || !!session.value?.isAdmin)
</script>

<template>
  <div class="container page" :class="{ wide: preview === 'markdown' }">
    <NuxtLink to="/" class="back"><AppIcon name="chevron-left" :size="17" />Toute la documentation</NuxtLink>

    <div v-if="loading" class="stack">
      <div class="skeleton" style="height: 120px" />
      <div class="skeleton" style="height: 360px" />
    </div>

    <div v-else-if="error || !doc" class="card empty">
      <AppIcon name="lock" :size="34" />
      <h3>Document indisponible</h3>
      <p>{{ error }}</p>
      <p class="hint" style="margin-top: 8px">S'il s'agit d'un document privé, saisissez votre code d'accès.</p>
    </div>

    <article v-else class="stack">
      <header class="head card">
        <FileBadge :file="doc.file" size="lg" />
        <div class="grow info">
          <div class="badges">
            <span v-if="doc.visibility === 'private'" class="badge badge-primary"><AppIcon name="lock" :size="12" />Privé</span>
            <span v-if="doc.category" class="badge">{{ doc.category }}</span>
          </div>
          <h1>{{ doc.title }}</h1>
          <p class="faint meta">{{ [doc.file.name, formatSize(doc.file.size), formatDate(doc.updatedAt)].filter(Boolean).join(' · ') }}</p>
          <p v-if="doc.description" class="desc">{{ doc.description }}</p>
          <div v-if="doc.file.missing" class="alert alert-warning"><AppIcon name="alert" :size="17" />Le fichier n'est pas disponible pour le moment.</div>
          <div v-else-if="rawAccess" class="cta">
            <a v-if="preview" :href="fileUrl" target="_blank" rel="noopener" class="btn btn-primary"><AppIcon name="external" :size="16" />Ouvrir</a>
            <a :href="`${fileUrl}&dl=1`" class="btn" :class="{ 'btn-primary': !preview }"><AppIcon name="download" :size="16" />Télécharger</a>
            <span v-if="preview === 'markdown'" class="admin-only"><AppIcon name="shield" :size="14" />Réservé aux administrateurs</span>
          </div>
        </div>
      </header>

      <!-- Markdown : page de lecture complète (sommaire, sections, recherche) -->
      <DocReader v-if="preview === 'markdown'" :url="fileUrl" :ext="doc.file.ext" :title="doc.title" :raw-access="rawAccess" />

      <section v-else-if="preview" class="viewer card" :class="`is-${preview}`">
        <iframe v-if="preview === 'pdf'" :src="fileUrl" :title="doc.title" />
        <img v-else-if="preview === 'image'" :src="fileUrl" :alt="doc.title">
        <video v-else-if="preview === 'video'" :src="fileUrl" controls playsinline preload="metadata" />
        <audio v-else-if="preview === 'audio'" :src="fileUrl" controls preload="metadata" />
        <DocTextPreview v-else-if="preview === 'csv' || preview === 'text'" :url="fileUrl" :kind="preview" :ext="doc.file.ext" />
      </section>
    </article>
  </div>
</template>

<style scoped>
.page { padding-top: 20px; }
.page.wide { max-width: 1440px; }
.back { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); font-size: 14px; font-weight: 500; margin-bottom: 16px; }
.back:hover { color: var(--text); }
.head { display: flex; flex-direction: column; gap: 16px; padding: 20px; }
@media (min-width: 640px) { .head { flex-direction: row; padding: 24px; gap: 20px; } }
.info { display: flex; flex-direction: column; gap: 8px; }
.badges { display: flex; gap: 6px; flex-wrap: wrap; }
.badges:empty { display: none; }
h1 { font-size: clamp(21px, 5vw, 28px); }
.meta { font-size: 13px; word-break: break-word; }
.desc { white-space: pre-line; color: var(--muted); }
.cta { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.cta .btn { flex: 1; }
@media (min-width: 640px) { .cta .btn { flex: none; } }
.admin-only { display: inline-flex; align-items: center; gap: 6px; width: 100%; font-size: 12.5px; color: var(--faint); }
@media (min-width: 640px) { .admin-only { width: auto; } }
.viewer { overflow: hidden; }
.viewer iframe { display: block; width: 100%; height: 75vh; border: 0; background: #fff; }
.viewer.is-pdf { display: none; } /* les PDF intégrés sont peu lisibles sur mobile : bouton « Ouvrir » */
@media (min-width: 768px) { .viewer.is-pdf { display: block; } }
.viewer.is-image { display: grid; place-items: center; padding: 12px; background: var(--surface-2); }
.viewer img { max-height: 80vh; border-radius: var(--radius-sm); }
.viewer video { display: block; width: 100%; background: #000; }
.viewer.is-audio { padding: 16px; }
.viewer audio { width: 100%; }
.viewer.is-markdown, .viewer.is-csv, .viewer.is-text { overflow: visible; }
</style>
