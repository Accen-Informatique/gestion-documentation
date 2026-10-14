<script setup lang="ts">
import type { DocItem } from '../../utils/format'

// Clients : un token = un USER_TOKEN dans FileMaker ; chaque fichier = un enregistrement WEB_DOCUMENTATION

interface ClientToken {
  id: string
  value: string
  source: 'site' | 'filemaker'
  label: string
  note: string
  active: boolean
  expiresAt: string | null
  createdAt: string
  lastUsedAt: string | null
  status: 'active' | 'disabled' | 'expired'
  files: DocItem[]
}

const toast = useToast()
const api = useApi()
const { asAdmin } = useAccess()
const { confirm } = useConfirm()

const tokens = ref<ClientToken[]>([])
const fmError = ref<string | null>(null)
const loading = ref(true)
const refreshing = ref(false)
const search = ref('')
const expanded = ref<string | null>(null)
const revealed = ref(new Set<string>())

async function load() {
  refreshing.value = true
  try {
    const res = await api.post<{ fmError: string | null, tokens: ClientToken[] }>('doc_admin_get_clients', asAdmin())
    tokens.value = res.tokens
    fmError.value = res.fmError
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
  if (!q) return tokens.value
  return tokens.value.filter(t => normalize(`${t.label} ${t.value} ${t.note} ${t.files.map(f => f.title).join(' ')}`).includes(q))
})
const stats = computed(() => ({
  clients: tokens.value.length,
  active: tokens.value.filter(t => t.status === 'active').length,
  files: tokens.value.reduce((n, t) => n + t.files.length, 0)
}))

const statusBadge = {
  active: { cls: 'badge-success', text: 'Actif' },
  disabled: { cls: '', text: 'Désactivé' },
  expired: { cls: 'badge-warning', text: 'Expiré' }
} as const

function masked(v: string) {
  return v.replace(/[^-]/g, '•')
}
function toggleReveal(id: string) {
  const s = new Set(revealed.value)
  s.has(id) ? s.delete(id) : s.add(id)
  revealed.value = s
}
async function copy(v: string) {
  if (await copyText(v)) toast.success('Code copié dans le presse-papiers.')
  else toast.error('Copie impossible : sélectionnez le code manuellement.')
}
function initials(label: string) {
  return label.split(/[\s-]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?'
}

/* ---------- Fiche client (création / modification) ---------- */
const form = reactive({ open: false, id: '' as string, label: '', note: '', expires: '', active: true, customValue: '', advanced: false, saving: false, error: '' })
const created = ref<ClientToken | null>(null)

function openCreate() {
  Object.assign(form, { open: true, id: '', label: '', note: '', expires: '', active: true, customValue: '', advanced: false, saving: false, error: '' })
  created.value = null
}
function openEdit(t: ClientToken) {
  Object.assign(form, { open: true, id: t.id, label: t.source === 'filemaker' && t.label === t.value ? '' : t.label, note: t.note, expires: isoToDateInput(t.expiresAt), active: t.active, customValue: '', advanced: false, saving: false, error: '' })
  created.value = null
}

async function saveClient() {
  if (!form.label.trim() || form.saving) return
  form.saving = true
  form.error = ''
  const body: Record<string, unknown> = { label: form.label, note: form.note, expiresAt: dateInputToIso(form.expires), active: form.active }
  try {
    if (form.id) {
      await api.post('doc_admin_edit_client', asAdmin({ ...body, id: form.id }))
      form.open = false
      toast.success('Client mis à jour.')
    } else {
      if (form.customValue.trim()) body.value = form.customValue.trim()
      created.value = await api.post<ClientToken>('doc_admin_create_client', asAdmin(body))
      expanded.value = created.value.id
    }
  } catch (e) {
    form.error = errorMessage(e)
  } finally {
    // Toujours resynchroniser avec le serveur, même après une erreur
    load()
    form.saving = false
  }
}

async function toggleActive(t: ClientToken) {
  try {
    await api.post('doc_admin_edit_client', asAdmin({ id: t.id, active: !t.active }))
    toast.success(t.active ? 'Accès désactivé.' : 'Accès réactivé.')
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    load()
  }
}

async function regenerate(t: ClientToken) {
  const ok = await confirm({
    title: 'Générer un nouveau code ?',
    message: `L'ancien code de « ${t.label} » cessera de fonctionner immédiatement. Le USER_TOKEN de ses ${t.files.length} enregistrement(s) FileMaker sera mis à jour.`,
    confirmLabel: 'Générer'
  })
  if (!ok) return
  try {
    const res = await api.post<ClientToken>('doc_admin_regenerate_client', asAdmin({ id: t.id }))
    revealed.value = new Set([...revealed.value, t.id])
    toast.success(`Nouveau code : ${res.value}`)
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    load()
  }
}

async function removeClient(t: ClientToken) {
  const ok = await confirm({
    title: `Supprimer « ${t.label} » ?`,
    message: t.files.length
      ? `Son code ne fonctionnera plus : ses ${t.files.length} document(s) passeront en isDelete = 1 et leurs fichiers seront supprimés de Dropbox.`
      : 'Le code ne donnera plus accès à rien.',
    confirmLabel: 'Supprimer', danger: true
  })
  if (!ok) return
  try {
    await api.post('doc_admin_delete_client', asAdmin({ id: t.id }))
    toast.success('Client supprimé.')
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    await load()
  }
}

/* ---------- Fichiers d'un client ---------- */
const fileForm = reactive({
  open: false, mode: 'add' as 'add' | 'edit' | 'replace', tokenId: '', tokenLabel: '', recordId: '',
  file: null as File | null, nom: '', description: '', saving: false, progress: 0, error: ''
})

function openAddFile(t: ClientToken) {
  Object.assign(fileForm, { open: true, mode: 'add', tokenId: t.id, tokenLabel: t.label, recordId: '', file: null, nom: '', description: '', saving: false, progress: 0, error: '' })
}
function openEditFile(t: ClientToken, f: DocItem) {
  Object.assign(fileForm, { open: true, mode: 'edit', tokenId: t.id, tokenLabel: t.label, recordId: f.recordId, file: null, nom: f.title, description: f.description, saving: false, progress: 0, error: '' })
}
function openReplaceFile(t: ClientToken, f: DocItem) {
  Object.assign(fileForm, { open: true, mode: 'replace', tokenId: t.id, tokenLabel: t.label, recordId: f.recordId, file: null, nom: f.title, description: '', saving: false, progress: 0, error: '' })
}
watch(() => fileForm.file, (f) => {
  if (f && fileForm.mode === 'add' && !fileForm.nom) fileForm.nom = f.name.replace(/\.[^.]+$/, '')
})

const fileFormTitle = computed(() => ({
  add: `Ajouter un fichier · ${fileForm.tokenLabel}`,
  edit: 'Modifier le document',
  replace: `Remplacer le fichier · ${fileForm.nom}`
})[fileForm.mode])

async function saveFile() {
  if (fileForm.saving) return
  fileForm.saving = true
  fileForm.error = ''
  try {
    if (fileForm.mode === 'edit') {
      await api.post('doc_admin_edit_client_file', asAdmin({ recordId: fileForm.recordId, nom: fileForm.nom, description: fileForm.description }))
      toast.success('Document mis à jour.')
    } else {
      if (!fileForm.file) throw { data: { message: 'Choisissez un fichier.' } }
      if (fileForm.mode === 'add') {
        await api.upload('doc_admin_add_client_file', asAdmin({ clientId: fileForm.tokenId, nom: fileForm.nom, description: fileForm.description }), fileForm.file, p => (fileForm.progress = p))
        toast.success('Fichier ajouté et enregistré dans FileMaker.')
      } else {
        await api.upload('doc_admin_replace_client_file', asAdmin({ recordId: fileForm.recordId }), fileForm.file, p => (fileForm.progress = p))
        toast.success('Fichier remplacé.')
      }
    }
    fileForm.open = false
  } catch (e) {
    fileForm.error = errorMessage(e)
  } finally {
    // Toujours resynchroniser avec le serveur, même après une erreur
    load()
    fileForm.saving = false
  }
}

async function removeFile(f: DocItem) {
  const ok = await confirm({ title: `Supprimer « ${f.title} » ?`, message: 'Le document passera en isDelete = 1 et son fichier sera supprimé de Dropbox.', confirmLabel: 'Supprimer', danger: true })
  if (!ok) return
  try {
    await api.post('doc_admin_delete_client_file', asAdmin({ recordId: f.recordId }))
    toast.success('Document supprimé.')
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    await load()
  }
}
</script>

<template>
  <div class="stack">
    <div v-if="fmError" class="alert alert-warning"><AppIcon name="database" :size="17" /><span><strong>FileMaker :</strong> {{ fmError }}</span></div>

    <div class="stats">
      <div class="stat card"><span class="faint">Clients</span><strong>{{ stats.clients }}</strong></div>
      <div class="stat card"><span class="faint">Accès actifs</span><strong>{{ stats.active }}</strong></div>
      <div class="stat card"><span class="faint">Fichiers</span><strong>{{ stats.files }}</strong></div>
    </div>

    <div class="toolbar">
      <div class="input-icon grow">
        <AppIcon name="search" />
        <input v-model="search" class="input" type="search" placeholder="Rechercher un client, un code, un fichier…">
      </div>
      <button class="btn btn-primary" type="button" @click="openCreate"><AppIcon name="plus" :size="17" /><span>Nouveau client</span></button>
    </div>
    <div class="refresh-bar" :class="{ active: refreshing && !loading }" aria-hidden="true"><span /></div>

    <div v-if="loading" class="stack"><div v-for="i in 3" :key="i" class="skeleton" style="height: 76px" /></div>

    <div v-else-if="!filtered.length" class="card empty">
      <AppIcon name="users" :size="34" />
      <h3>{{ search ? 'Aucun résultat' : 'Aucun client' }}</h3>
      <p>{{ search ? 'Essayez un autre mot-clé.' : 'Créez un client pour lui partager des documents privés.' }}</p>
    </div>

    <ul v-else :class="{ 'is-refreshing': refreshing && !loading }" class="clients">
      <li v-for="t in filtered" :key="t.id" class="client card" :class="{ open: expanded === t.id }">
        <button type="button" class="client-head" :aria-expanded="expanded === t.id" @click="expanded = expanded === t.id ? null : t.id">
          <span class="avatar" :class="`is-${t.status}`">{{ initials(t.label) }}</span>
          <span class="grow">
            <span class="name-row">
              <strong class="truncate">{{ t.label }}</strong>
              <span class="badge" :class="statusBadge[t.status].cls">{{ statusBadge[t.status].text }}</span>
            </span>
            <span class="sub faint">
              {{ t.files.length }} fichier{{ t.files.length > 1 ? 's' : '' }}
              <template v-if="t.expiresAt"> · expire le {{ formatDate(t.expiresAt) }}</template>
              <template v-if="t.lastUsedAt"> · utilisé le {{ formatDate(t.lastUsedAt) }}</template>
            </span>
          </span>
          <AppIcon name="chevron-down" class="chev" />
        </button>

        <div v-if="expanded === t.id" class="client-body">
          <div class="code-row">
            <span class="label">Code</span>
            <code class="mono code">{{ revealed.has(t.id) ? t.value : masked(t.value) }}</code>
            <button type="button" class="btn btn-ghost btn-icon btn-sm" :aria-label="revealed.has(t.id) ? 'Masquer' : 'Afficher'" @click="toggleReveal(t.id)"><AppIcon :name="revealed.has(t.id) ? 'eye-off' : 'eye'" :size="16" /></button>
            <button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="Copier le code" @click="copy(t.value)"><AppIcon name="copy" :size="16" /></button>
            <span v-if="t.source === 'filemaker'" class="badge" title="USER_TOKEN créé directement dans FileMaker"><AppIcon name="database" :size="12" />FileMaker</span>
          </div>
          <p v-if="t.note" class="note muted">{{ t.note }}</p>

          <div class="client-actions">
            <button type="button" class="btn btn-sm" @click="openEdit(t)"><AppIcon name="edit" :size="15" />Modifier</button>
            <label class="switch btn btn-sm">
              <input type="checkbox" :checked="t.active" @change="toggleActive(t)">
              <span>{{ t.active ? 'Actif' : 'Désactivé' }}</span>
            </label>
            <button type="button" class="btn btn-sm" @click="regenerate(t)"><AppIcon name="refresh" :size="15" />Nouveau code</button>
            <button type="button" class="btn btn-sm btn-danger" @click="removeClient(t)"><AppIcon name="trash" :size="15" />Supprimer</button>
          </div>

          <div class="files-head">
            <h3>Documents</h3>
            <button type="button" class="btn btn-sm btn-primary" @click="openAddFile(t)"><AppIcon name="upload" :size="15" />Ajouter un fichier</button>
          </div>
          <p v-if="!t.files.length" class="hint">Aucun document pour ce client.</p>
          <ul v-else class="files">
            <li v-for="f in t.files" :key="f.id" class="file">
              <FileBadge :file="f.file" size="sm" />
              <div class="grow">
                <div class="truncate file-title">{{ f.title }}</div>
                <div class="hint truncate">
                  <span v-if="f.file.missing" class="badge badge-danger">Fichier manquant</span>
                  {{ [f.file.name, formatSize(f.file.size), formatDate(f.createdAt)].filter(Boolean).join(' · ') }}
                </div>
              </div>
              <div class="file-actions">
                <a v-if="!f.file.missing" :href="f.fileUrl" target="_blank" rel="noopener" class="btn btn-ghost btn-icon btn-sm" aria-label="Ouvrir"><AppIcon name="external" :size="16" /></a>
                <button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="Modifier" @click="openEditFile(t, f)"><AppIcon name="edit" :size="16" /></button>
                <button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="Remplacer le fichier" @click="openReplaceFile(t, f)"><AppIcon name="upload" :size="16" /></button>
                <button type="button" class="btn btn-ghost btn-icon btn-sm btn-danger" aria-label="Supprimer" @click="removeFile(f)"><AppIcon name="trash" :size="16" /></button>
              </div>
            </li>
          </ul>
        </div>
      </li>
    </ul>

    <!-- Fiche client -->
    <AppModal :open="form.open" :title="created ? 'Client créé' : form.id ? 'Modifier le client' : 'Nouveau client'" @close="form.open = false">
      <div v-if="created" class="stack">
        <p class="muted">Transmettez ce code à <strong>{{ created.label }}</strong>. Il lui permettra d'afficher ses documents.</p>
        <div class="created-code">
          <code class="mono">{{ created.value }}</code>
          <button type="button" class="btn btn-sm" @click="copy(created.value)"><AppIcon name="copy" :size="15" />Copier</button>
        </div>
        <div class="row created-actions">
          <button type="button" class="btn" @click="form.open = false">Fermer</button>
          <button type="button" class="btn btn-primary" @click="form.open = false; openAddFile(created)"><AppIcon name="upload" :size="16" />Ajouter un fichier</button>
        </div>
      </div>
      <form v-else id="client-form" class="stack" @submit.prevent="saveClient">
        <div class="field">
          <label class="label" for="c-label">Nom du client</label>
          <input id="c-label" v-model="form.label" class="input" required maxlength="120" placeholder="Ex. Garage Martin" autofocus>
        </div>
        <div class="field">
          <label class="label" for="c-note">Note interne <span class="faint">(facultatif)</span></label>
          <textarea id="c-note" v-model="form.note" class="textarea" maxlength="1000" placeholder="N° client, contrat…" />
        </div>
        <div class="two">
          <div class="field">
            <label class="label" for="c-exp">Expire le <span class="faint">(facultatif)</span></label>
            <input id="c-exp" v-model="form.expires" class="input" type="date">
          </div>
          <div class="field">
            <span class="label">Accès</span>
            <label class="switch switch-field"><input v-model="form.active" type="checkbox"><span>{{ form.active ? 'Actif' : 'Désactivé' }}</span></label>
          </div>
        </div>
        <template v-if="!form.id">
          <button v-if="!form.advanced" type="button" class="link-btn" @click="form.advanced = true">Choisir le code moi-même</button>
          <div v-else class="field">
            <label class="label" for="c-code">Code personnalisé</label>
            <input id="c-code" v-model="form.customValue" class="input mono" maxlength="64" placeholder="Laisser vide pour un code généré" autocomplete="off">
            <span class="hint">Au moins 6 caractères, dont une lettre, un chiffre et un caractère spécial (! ? @ # - _ …), sans espace.</span>
          </div>
        </template>
        <div v-if="form.error" class="alert alert-danger"><AppIcon name="alert" :size="17" />{{ form.error }}</div>
      </form>
      <template v-if="!created" #footer>
        <button type="button" class="btn" @click="form.open = false">Annuler</button>
        <button type="submit" form="client-form" class="btn btn-primary" :disabled="!form.label.trim() || form.saving">
          <AppIcon v-if="form.saving" name="loader" :size="16" />{{ form.id ? 'Enregistrer' : 'Créer le client' }}
        </button>
      </template>
    </AppModal>

    <!-- Fichier client -->
    <AppModal :open="fileForm.open" :title="fileFormTitle" @close="!fileForm.saving && (fileForm.open = false)">
      <form id="file-form" class="stack" @submit.prevent="saveFile">
        <FileDrop v-if="fileForm.mode !== 'edit'" v-model="fileForm.file" :label="fileForm.mode === 'replace' ? 'Choisir le nouveau fichier' : undefined" />
        <template v-if="fileForm.mode !== 'replace'">
          <div class="field">
            <label class="label" for="f-nom">Nom affiché</label>
            <input id="f-nom" v-model="fileForm.nom" class="input" maxlength="200" :required="fileForm.mode === 'edit'" placeholder="Nom du document">
          </div>
          <div class="field">
            <label class="label" for="f-desc">Description <span class="faint">(facultatif)</span></label>
            <textarea id="f-desc" v-model="fileForm.description" class="textarea" maxlength="2000" />
          </div>
        </template>
        <p v-if="fileForm.mode === 'add'" class="hint"><AppIcon name="database" :size="13" /> Un enregistrement sera créé dans WEB_DOCUMENTATION avec ce code client.</p>
        <div v-if="fileForm.saving && fileForm.mode !== 'edit'" class="progress"><span :style="{ width: `${fileForm.progress}%` }" /></div>
        <div v-if="fileForm.error" class="alert alert-danger"><AppIcon name="alert" :size="17" />{{ fileForm.error }}</div>
      </form>
      <template #footer>
        <button type="button" class="btn" :disabled="fileForm.saving" @click="fileForm.open = false">Annuler</button>
        <button type="submit" form="file-form" class="btn btn-primary" :disabled="fileForm.saving || (fileForm.mode !== 'edit' && !fileForm.file)">
          <AppIcon v-if="fileForm.saving" name="loader" :size="16" />
          {{ fileForm.mode === 'edit' ? 'Enregistrer' : fileForm.mode === 'replace' ? 'Remplacer' : 'Ajouter' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.stat { padding: 12px 14px; display: flex; flex-direction: column; gap: 2px; }
.stat span { font-size: 12.5px; }
.stat strong { font-size: 22px; letter-spacing: -.02em; }
.toolbar { display: flex; gap: 8px; }
.toolbar .btn span { display: none; }
@media (min-width: 640px) { .toolbar .btn span { display: inline; } }
.toolbar .btn { flex: none; min-width: 44px; padding: 0 12px; }
@media (min-width: 640px) { .toolbar .btn { padding: 0 16px; } }

.clients { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.client { overflow: hidden; }
.client.open { box-shadow: var(--shadow); }
.client-head {
  width: 100%; display: flex; align-items: center; gap: 12px; padding: 14px 16px;
  border: 0; background: transparent; text-align: left; cursor: pointer;
}
.client-head:hover { background: var(--surface-2); }
.avatar { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; flex: none; font-weight: 700; font-size: 14px; background: var(--primary-soft); color: var(--primary); }
.avatar.is-disabled { background: var(--surface-2); color: var(--faint); }
.avatar.is-expired { background: var(--warning-soft); color: var(--warning); }
.name-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.name-row strong { font-size: 15px; }
.sub { display: block; font-size: 12.5px; margin-top: 2px; }
.chev { color: var(--faint); transition: transform .2s; flex: none; }
.open .chev { transform: rotate(180deg); }

.client-body { padding: 4px 16px 16px; display: flex; flex-direction: column; gap: 12px; border-top: 1px solid var(--border); padding-top: 14px; }
.code-row { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.code-row .label { margin-right: 6px; }
.code { font-size: 14px; padding: 4px 10px; background: var(--surface-2); border-radius: 6px; word-break: break-all; }
.note { font-size: 13.5px; white-space: pre-line; }
.client-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.client-actions .switch input { width: 32px; height: 20px; }
.client-actions .switch input::after { width: 14px; height: 14px; }
.client-actions .switch input:checked::after { transform: translateX(12px); }

.files-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px; }
.files-head h3 { font-size: 14.5px; }
.files { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: var(--radius-sm); }
.file { display: flex; align-items: center; gap: 10px; padding: 10px 8px 10px 12px; flex-wrap: wrap; }
.file + .file { border-top: 1px solid var(--border); }
.file .grow { flex-basis: 140px; }
.file-title { font-weight: 600; font-size: 14px; }
.file-actions { display: flex; gap: 2px; margin-left: auto; }

.two { display: grid; grid-template-columns: 1fr; gap: 16px; }
@media (min-width: 480px) { .two { grid-template-columns: 1fr 1fr; } }
.switch-field { min-height: 44px; }
.link-btn { align-self: flex-start; border: 0; background: none; padding: 0; color: var(--primary); font-weight: 500; font-size: 14px; cursor: pointer; }
.created-code { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; background: var(--primary-soft); border-radius: var(--radius); }
.created-code code { font-size: 18px; font-weight: 600; color: var(--primary); word-break: break-all; }
.created-actions { justify-content: flex-end; flex-wrap: wrap; }
.progress { height: 6px; border-radius: 99px; background: var(--surface-2); overflow: hidden; }
.progress span { display: block; height: 100%; background: var(--primary); transition: width .2s; }
.refresh-bar { height: 3px; margin: -10px 0 -6px; border-radius: 99px; overflow: hidden; opacity: 0; transition: opacity .2s; }
.refresh-bar.active { opacity: 1; }
.refresh-bar span { display: block; height: 100%; width: 35%; border-radius: 99px; background: var(--primary); animation: refresh-slide 1s ease-in-out infinite; }
@keyframes refresh-slide { from { transform: translateX(-100%); } to { transform: translateX(290%); } }
.is-refreshing { opacity: .55; pointer-events: none; transition: opacity .2s; }
</style>
