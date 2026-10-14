<script setup lang="ts">
useHead({ title: 'Administration · Documentation' })

const { session, refresh, adminLogin, adminLogout } = useAccess()
const toast = useToast()

const tab = ref<'clients' | 'public'>('clients')
const adminToken = ref('')
const showToken = ref(false)
const loginError = ref('')
const loggingIn = ref(false)
const ready = ref(false)

onMounted(async () => {
  try { await refresh() } catch {}
  ready.value = true
})

async function login() {
  if (!adminToken.value || loggingIn.value) return
  loggingIn.value = true
  loginError.value = ''
  try {
    await adminLogin(adminToken.value)
    adminToken.value = ''
  } catch (e) {
    loginError.value = errorMessage(e)
  } finally {
    loggingIn.value = false
  }
}

async function logout() {
  adminLogout()
  toast.info('Session administrateur fermée.')
}
</script>

<template>
  <div class="container page">
    <div v-if="!ready" class="skeleton" style="height: 240px" />

    <!-- Connexion -->
    <div v-else-if="!session?.isAdmin" class="login card">
      <span class="login-icon"><AppIcon name="shield" :size="24" /></span>
      <h1>Administration</h1>
      <p class="muted">Gestion de la documentation publique et des accès clients.</p>
      <div v-if="session && !session.adminConfigured" class="alert alert-warning">
        <AppIcon name="alert" :size="17" />Aucun token admin n'est configuré sur le serveur (variable NUXT_ADMIN_TOKEN).
      </div>
      <form v-else class="stack" @submit.prevent="login">
        <div class="field">
          <label class="label" for="admin-token">Token administrateur</label>
          <div class="pw">
            <input id="admin-token" v-model="adminToken" class="input mono" :type="showToken ? 'text' : 'password'" autocomplete="current-password" autofocus>
            <button type="button" class="btn btn-ghost btn-icon btn-sm" :aria-label="showToken ? 'Masquer' : 'Afficher'" @click="showToken = !showToken">
              <AppIcon :name="showToken ? 'eye-off' : 'eye'" />
            </button>
          </div>
        </div>
        <div v-if="loginError" class="alert alert-danger" role="alert"><AppIcon name="alert" :size="17" />{{ loginError }}</div>
        <button class="btn btn-primary btn-block" type="submit" :disabled="!adminToken || loggingIn">
          <AppIcon :name="loggingIn ? 'loader' : 'lock'" :size="17" />Se connecter
        </button>
      </form>
    </div>

    <!-- Tableau de bord -->
    <div v-else class="stack">
      <div class="head">
        <div>
          <h1>Administration</h1>
          <p class="muted">Clients (FileMaker) et documentation publique.</p>
        </div>
        <button class="btn btn-sm" type="button" @click="logout"><AppIcon name="logout" :size="16" /><span>Déconnexion</span></button>
      </div>

      <div class="tabs" role="tablist">
        <button role="tab" type="button" :aria-selected="tab === 'clients'" :class="{ active: tab === 'clients' }" @click="tab = 'clients'">
          <AppIcon name="users" :size="16" />Clients
        </button>
        <button role="tab" type="button" :aria-selected="tab === 'public'" :class="{ active: tab === 'public' }" @click="tab = 'public'">
          <AppIcon name="globe" :size="16" />Documentation publique
        </button>
      </div>

      <AdminClients v-if="tab === 'clients'" />
      <AdminPublicDocs v-else />
    </div>
  </div>
</template>

<style scoped>
.page { padding-top: 24px; }
.login { max-width: 420px; margin: 24px auto; padding: 28px 20px; display: flex; flex-direction: column; gap: 12px; text-align: center; }
.login form { text-align: left; margin-top: 8px; }
.login h1 { font-size: 22px; }
.login-icon { display: grid; place-items: center; width: 52px; height: 52px; margin: 0 auto 4px; border-radius: 16px; background: var(--primary-soft); color: var(--primary); }
.pw { position: relative; }
.pw .input { padding-right: 48px; }
.pw .btn { position: absolute; right: 5px; top: 50%; transform: translateY(-50%); }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.head h1 { font-size: clamp(22px, 5vw, 28px); }
.tabs { display: flex; gap: 4px; padding: 4px; background: var(--surface-2); border-radius: var(--radius); border: 1px solid var(--border); }
.tabs button {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 40px; border: 0; border-radius: var(--radius-sm); background: transparent;
  font-weight: 600; font-size: 14px; color: var(--muted); cursor: pointer;
}
.tabs button.active { background: var(--surface); color: var(--text); box-shadow: var(--shadow-sm); }
@media (min-width: 640px) { .tabs { align-self: flex-start; } .tabs button { flex: none; padding: 0 18px; } }
</style>
