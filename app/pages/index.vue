<script setup lang="ts">
import type { DocItem } from '../utils/format'

useHead({ title: 'Documentation · Accen' })

const { session, tokenDialogOpen, removeToken, refresh, syncCodes, withAccess } = useAccess()
const api = useApi()
const { confirm } = useConfirm()
const toast = useToast()

const data = ref<{ publicDocs: DocItem[], privateDocs: DocItem[], clientError: string | null } | null>(null)
const loading = ref(true)
const loadError = ref('')
const search = ref('')
const category = ref('')

async function load() {
  loadError.value = ''
  try {
    if (!session.value) await refresh()
    const res = await api.post<{ publicDocs: DocItem[], privateDocs: DocItem[], clientError: string | null, codes: { code: string, label: string, expiresAt: string | null }[] }>('doc_get_documents', withAccess())
    syncCodes(res.codes)
    data.value = res
  } catch (e) {
    loadError.value = errorMessage(e, 'Impossible de charger la documentation.')
  } finally {
    loading.value = false
  }
}

onMounted(load)
// Recharge dès qu'un code est ajouté ou retiré
watch(() => session.value?.tokens.map(t => t.ref).join(','), (v, old) => { if (old !== undefined) load() })

const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
function matches(d: DocItem) {
  const q = normalize(search.value.trim())
  if (!q) return true
  return normalize(`${d.title} ${d.description} ${d.category} ${d.file.name}`).includes(q)
}

const categories = computed(() => [...new Set((data.value?.publicDocs ?? []).map(d => d.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')))
const privateDocs = computed(() => (data.value?.privateDocs ?? []).filter(matches))
const publicDocs = computed(() => (data.value?.publicDocs ?? []).filter(d => matches(d) && (!category.value || d.category === category.value)))
const hasTokens = computed(() => (session.value?.tokens.length ?? 0) > 0)

async function forget(ref: string, label: string) {
  const ok = await confirm({ title: 'Retirer cet accès ?', message: `Les documents de « ${label} » ne seront plus affichés sur cet appareil. Vous pourrez les retrouver en saisissant à nouveau le code.`, confirmLabel: 'Retirer' })
  if (!ok) return
  try {
    await removeToken(ref)
    toast.info('Accès retiré de cet appareil.')
  } catch (e) {
    toast.error(errorMessage(e))
  }
}
</script>

<template>
  <div>
    <section class="hero">
      <div class="container">
        <h1>Centre de documentation</h1>
        <p class="lead muted">Guides, notices et documents utiles. Vous avez reçu un code ? Il débloque vos documents personnels.</p>
        <div class="search input-icon">
          <AppIcon name="search" />
          <input v-model="search" class="input" type="search" placeholder="Rechercher un document…" aria-label="Rechercher un document">
        </div>
      </div>
    </section>

    <div class="container stack page">
      <div v-if="loadError" class="alert alert-danger"><AppIcon name="alert" :size="17" />{{ loadError }}</div>

      <!-- Documents privés -->
      <section v-if="hasTokens" class="section">
        <div class="section-head">
          <div>
            <h2><AppIcon name="lock" :size="18" class="accent" /> Vos documents</h2>
            <div class="access-list">
              <span v-for="t in session!.tokens" :key="t.ref" class="badge badge-primary access">
                <AppIcon name="key" :size="13" />{{ t.label }}
                <button type="button" :aria-label="`Retirer l'accès ${t.label}`" @click="forget(t.ref, t.label)"><AppIcon name="x" :size="13" /></button>
              </span>
            </div>
          </div>
        </div>
        <div v-if="data?.clientError" class="alert alert-warning"><AppIcon name="alert" :size="17" />{{ data.clientError }}</div>
        <div v-if="loading" class="grid"><div v-for="i in 2" :key="i" class="skeleton sk-card" /></div>
        <div v-else-if="privateDocs.length" class="grid">
          <DocCard v-for="d in privateDocs" :key="d.id" :doc="d" />
        </div>
        <div v-else class="card empty small">
          <p>{{ search ? 'Aucun document privé ne correspond à votre recherche.' : 'Aucun document ne vous est encore partagé.' }}</p>
        </div>
      </section>

      <!-- Appel à saisir un code -->
      <button v-else type="button" class="unlock card" @click="tokenDialogOpen = true">
        <span class="unlock-icon"><AppIcon name="key" :size="20" /></span>
        <span class="grow">
          <strong>Vous avez un code d'accès ?</strong>
          <span class="muted">Saisissez-le pour afficher les documents qui vous sont réservés.</span>
        </span>
        <AppIcon name="chevron-down" class="chev" />
      </button>

      <!-- Documentation publique -->
      <section class="section">
        <div class="section-head">
          <h2>Documentation</h2>
          <span v-if="!loading" class="faint count">{{ publicDocs.length }} document{{ publicDocs.length > 1 ? 's' : '' }}</span>
        </div>
        <div v-if="categories.length" class="scroll-x" role="tablist" aria-label="Catégories">
          <button type="button" class="chip" :class="{ 'is-active': !category }" @click="category = ''">Tous</button>
          <button v-for="c in categories" :key="c" type="button" class="chip" :class="{ 'is-active': category === c }" @click="category = c">{{ c }}</button>
        </div>
        <div v-if="loading" class="grid"><div v-for="i in 6" :key="i" class="skeleton sk-card" /></div>
        <div v-else-if="publicDocs.length" class="grid">
          <DocCard v-for="d in publicDocs" :key="d.id" :doc="d" />
        </div>
        <div v-else class="card empty">
          <AppIcon name="folder" :size="34" />
          <h3>{{ search || category ? 'Aucun résultat' : 'Pas encore de documentation' }}</h3>
          <p>{{ search || category ? 'Essayez un autre mot-clé ou une autre catégorie.' : 'Les documents publiés apparaîtront ici.' }}</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.hero { padding: 36px 0 28px; background: radial-gradient(1200px 300px at 50% -80px, var(--primary-soft), transparent 70%); }
.hero h1 { font-size: clamp(26px, 6vw, 38px); font-weight: 700; }
.lead { margin-top: 8px; max-width: 560px; font-size: 15.5px; }
.search { margin-top: 20px; max-width: 560px; }
.search .input { min-height: 50px; border-radius: var(--radius); box-shadow: var(--shadow); }
.page { gap: 32px; padding-top: 8px; }
.section { display: flex; flex-direction: column; gap: 14px; }
.section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.section-head h2 { font-size: 19px; display: flex; align-items: center; gap: 8px; }
.accent { color: var(--primary); }
.count { font-size: 13px; }
.access-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.access { padding-right: 4px; }
.access button { display: grid; place-items: center; width: 20px; height: 20px; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; }
.access button:hover { background: color-mix(in srgb, var(--primary) 18%, transparent); }
.grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
@media (min-width: 640px) { .grid { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1000px) { .grid { grid-template-columns: repeat(3, 1fr); } }
.sk-card { height: 112px; }
.empty.small { padding: 24px 16px; }
.unlock {
  display: flex; align-items: center; gap: 14px; padding: 16px; text-align: left; cursor: pointer;
  border-style: dashed; background: var(--surface); transition: border-color .15s, background .15s;
}
.unlock:hover { border-color: var(--primary); background: var(--primary-soft); }
.unlock strong { display: block; font-size: 15px; }
.unlock .muted { display: block; font-size: 13.5px; }
.unlock-icon { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 12px; background: var(--primary-soft); color: var(--primary); flex: none; }
.chev { transform: rotate(-90deg); color: var(--faint); flex: none; }
</style>
