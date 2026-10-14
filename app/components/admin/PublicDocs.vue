<script setup lang="ts">
import type { DocItem } from '../../utils/format'

// Documentation publique : fichiers stockés sur le site, visibles par tous
const toast = useToast()
const api = useApi()
const { asAdmin } = useAccess()
const { confirm } = useConfirm()

const docs = ref<DocItem[]>([])
const loading = ref(true)
const refreshing = ref(false)
const search = ref('')

async function load() {
  refreshing.value = true
  try {
    docs.value = await api.post<DocItem[]>('doc_admin_get_public', asAdmin())
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    loading.value = false
    refreshing.value = false
  }
}
onMounted(load)

const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
const filtered = computed(() => {
  const q = normalize(search.value.trim())
  return q ? docs.value.filter(d => normalize(`${d.title} ${d.description} ${d.category} ${d.file.name}`).includes(q)) : docs.value
})
const categories = computed(() => [...new Set(docs.value.map(d => d.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')))

const form = reactive({
  open: false, mode: 'add' as 'add' | 'edit' | 'replace', id: '',
  file: null as File | null, title: '', category: '', description: '', saving: false, progress: 0, error: ''
})

function openAdd() {
  Object.assign(form, { open: true, mode: 'add', id: '', file: null, title: '', category: '', description: '', saving: false, progress: 0, error: '' })
}
function openEdit(d: DocItem) {
  Object.assign(form, { open: true, mode: 'edit', id: d.id, file: null, title: d.title, category: d.category, description: d.description, saving: false, progress: 0, error: '' })
}
function openReplace(d: DocItem) {
  Object.assign(form, { open: true, mode: 'replace', id: d.id, file: null, title: d.title, category: '', description: '', saving: false, progress: 0, error: '' })
}
watch(() => form.file, (f) => {
  if (f && form.mode === 'add' && !form.title) form.title = f.name.replace(/\.[^.]+$/, '')
})

async function save() {
  if (form.saving) return
  form.saving = true
  form.error = ''
  try {
    if (form.mode === 'edit') {
      await api.post('doc_admin_edit_public', asAdmin({ id: form.id, title: form.title, category: form.category, description: form.description }))
      toast.success('Document mis à jour.')
    } else {
      if (!form.file) throw { data: { message: 'Choisissez un fichier.' } }
      if (form.mode === 'add') {
        await api.upload('doc_admin_add_public', asAdmin({ title: form.title, category: form.category, description: form.description }), form.file, p => (form.progress = p))
        toast.success('Document publié.')
      } else {
        await api.upload('doc_admin_replace_public_file', asAdmin({ id: form.id }), form.file, p => (form.progress = p))
        toast.success('Fichier remplacé.')
      }
    }
    form.open = false
  } catch (e) {
    form.error = errorMessage(e)
  } finally {
    // Toujours resynchroniser avec le serveur, même après une erreur
    load()
    form.saving = false
  }
}

async function remove(d: DocItem) {
  const ok = await confirm({ title: `Supprimer « ${d.title} » ?`, message: 'Le document sera retiré du site et son fichier supprimé de Dropbox.', confirmLabel: 'Supprimer', danger: true })
  if (!ok) return
  try {
    await api.post('doc_admin_delete_public', asAdmin({ id: d.id }))
    docs.value = docs.value.filter(x => x.id !== d.id)
    toast.success('Document supprimé.')
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    // Toujours resynchroniser : le document peut être retiré même si une étape a échoué
    await load()
  }
}
</script>

<template>
  <div class="stack">
    <div class="toolbar">
      <div class="input-icon grow">
        <AppIcon name="search" />
        <input v-model="search" class="input" type="search" placeholder="Rechercher un document…">
      </div>
      <button class="btn btn-primary" type="button" @click="openAdd"><AppIcon name="plus" :size="17" /><span>Publier un document</span></button>
    </div>
    <div class="refresh-bar" :class="{ active: refreshing && !loading }" aria-hidden="true"><span /></div>

    <div v-if="loading" class="stack"><div v-for="i in 3" :key="i" class="skeleton" style="height: 68px" /></div>

    <div v-else-if="!filtered.length" class="card empty">
      <AppIcon name="globe" :size="34" />
      <h3>{{ search ? 'Aucun résultat' : 'Aucun document public' }}</h3>
      <p>{{ search ? 'Essayez un autre mot-clé.' : 'Les documents publiés ici sont visibles par tous les visiteurs.' }}</p>
    </div>

    <ul v-else :class="{ 'is-refreshing': refreshing && !loading }" class="list card">
      <li v-for="d in filtered" :key="d.id" class="item">
        <FileBadge :file="d.file" size="sm" />
        <div class="grow">
          <div class="row">
            <span class="truncate title">{{ d.title }}</span>
            <span v-if="d.category" class="badge">{{ d.category }}</span>
          </div>
          <div class="hint truncate">{{ [d.file.name, formatSize(d.file.size), formatDate(d.updatedAt)].filter(Boolean).join(' · ') }}</div>
        </div>
        <div class="actions">
          <a :href="d.fileUrl" target="_blank" rel="noopener" class="btn btn-ghost btn-icon btn-sm" aria-label="Ouvrir"><AppIcon name="external" :size="16" /></a>
          <button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="Modifier" @click="openEdit(d)"><AppIcon name="edit" :size="16" /></button>
          <button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="Remplacer le fichier" @click="openReplace(d)"><AppIcon name="upload" :size="16" /></button>
          <button type="button" class="btn btn-ghost btn-icon btn-sm btn-danger" aria-label="Supprimer" @click="remove(d)"><AppIcon name="trash" :size="16" /></button>
        </div>
      </li>
    </ul>

    <AppModal
      :open="form.open"
      :title="form.mode === 'add' ? 'Publier un document' : form.mode === 'edit' ? 'Modifier le document' : `Remplacer le fichier · ${form.title}`"
      @close="!form.saving && (form.open = false)"
    >
      <form id="public-form" class="stack" @submit.prevent="save">
        <FileDrop v-if="form.mode !== 'edit'" v-model="form.file" />
        <template v-if="form.mode !== 'replace'">
          <div class="field">
            <label class="label" for="p-title">Titre</label>
            <input id="p-title" v-model="form.title" class="input" maxlength="160" :required="form.mode === 'edit'" placeholder="Ex. Guide de démarrage">
          </div>
          <div class="field">
            <label class="label" for="p-cat">Catégorie <span class="faint">(facultatif)</span></label>
            <input id="p-cat" v-model="form.category" class="input" maxlength="60" list="p-cats" placeholder="Ex. Guides, Notices, Tutoriels">
            <datalist id="p-cats"><option v-for="c in categories" :key="c" :value="c" /></datalist>
          </div>
          <div class="field">
            <label class="label" for="p-desc">Description <span class="faint">(facultatif)</span></label>
            <textarea id="p-desc" v-model="form.description" class="textarea" maxlength="2000" />
          </div>
        </template>
        <div v-if="form.saving && form.mode !== 'edit'" class="progress"><span :style="{ width: `${form.progress}%` }" /></div>
        <div v-if="form.error" class="alert alert-danger"><AppIcon name="alert" :size="17" />{{ form.error }}</div>
      </form>
      <template #footer>
        <button type="button" class="btn" :disabled="form.saving" @click="form.open = false">Annuler</button>
        <button type="submit" form="public-form" class="btn btn-primary" :disabled="form.saving || (form.mode !== 'edit' && !form.file)">
          <AppIcon v-if="form.saving" name="loader" :size="16" />
          {{ form.mode === 'edit' ? 'Enregistrer' : form.mode === 'replace' ? 'Remplacer' : 'Publier' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.toolbar { display: flex; gap: 8px; }
.toolbar .btn { flex: none; min-width: 44px; padding: 0 12px; }
.toolbar .btn span { display: none; }
@media (min-width: 640px) { .toolbar .btn { padding: 0 16px; } .toolbar .btn span { display: inline; } }
.list { list-style: none; margin: 0; padding: 0; }
.item { display: flex; align-items: center; gap: 12px; padding: 12px 10px 12px 14px; flex-wrap: wrap; }
.item + .item { border-top: 1px solid var(--border); }
.item .grow { flex-basis: 160px; }
.title { font-weight: 600; font-size: 14.5px; }
.actions { display: flex; gap: 2px; margin-left: auto; }
.progress { height: 6px; border-radius: 99px; background: var(--surface-2); overflow: hidden; }
.progress span { display: block; height: 100%; background: var(--primary); transition: width .2s; }
.refresh-bar { height: 3px; margin: -10px 0 -6px; border-radius: 99px; overflow: hidden; opacity: 0; transition: opacity .2s; }
.refresh-bar.active { opacity: 1; }
.refresh-bar span { display: block; height: 100%; width: 35%; border-radius: 99px; background: var(--primary); animation: refresh-slide 1s ease-in-out infinite; }
@keyframes refresh-slide { from { transform: translateX(-100%); } to { transform: translateX(290%); } }
.is-refreshing { opacity: .55; pointer-events: none; transition: opacity .2s; }
</style>
