<script setup lang="ts">
const { session, tokenDialogOpen, refresh } = useAccess()
const route = useRoute()
const { theme, toggle: toggleTheme } = useTheme()

onMounted(() => { if (!session.value) refresh().catch(() => {}) })

const tokenCount = computed(() => session.value?.tokens.length ?? 0)
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="container bar">
        <NuxtLink to="/" class="brand" aria-label="Accueil documentation">
          <span class="logo"><AppIcon name="book" :size="18" /></span>
          <span class="brand-text"><strong>Accen</strong><span class="faint"> · Documentation</span></span>
        </NuxtLink>
        <nav class="actions">
          <button
            class="btn btn-ghost btn-icon btn-sm" type="button" @click="toggleTheme"
            :aria-label="theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'"
            :title="theme === 'dark' ? 'Mode clair' : 'Mode sombre'"
          >
            <AppIcon :name="theme === 'dark' ? 'sun' : 'moon'" :size="17" />
          </button>
          <NuxtLink v-if="session?.isAdmin && route.path !== '/admin'" to="/admin" class="btn btn-ghost btn-sm">
            <AppIcon name="shield" :size="16" /><span class="hide-sm">Administration</span>
          </NuxtLink>
          <button class="btn btn-sm" :class="tokenCount ? '' : 'btn-primary'" type="button" @click="tokenDialogOpen = true">
            <AppIcon name="key" :size="16" />
            <span>{{ tokenCount ? 'Ajouter un code' : 'Code d\'accès' }}</span>
          </button>
        </nav>
      </div>
    </header>
    <main class="main">
      <slot />
    </main>
    <footer class="footer container">
      <span class="faint">© {{ new Date().getFullYear() }} Accen</span>
      <NuxtLink to="/admin" class="faint">Administration</NuxtLink>
    </footer>
  </div>
</template>

<style scoped>
.shell { min-height: 100dvh; display: flex; flex-direction: column; }
.topbar {
  position: sticky; top: 0; z-index: 20;
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  backdrop-filter: saturate(1.4) blur(12px);
  border-bottom: 1px solid var(--border);
  padding-top: env(safe-area-inset-top);
}
.bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 60px; }
.brand { display: flex; align-items: center; gap: 10px; color: var(--text); min-width: 0; }
.logo { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: var(--primary); color: var(--primary-ink); flex: none; }
.brand-text { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.brand-text .faint { display: none; }
.actions { display: flex; align-items: center; gap: 6px; }
.hide-sm { display: none; }
@media (min-width: 640px) {
  .brand-text .faint, .hide-sm { display: inline; }
}
.main { flex: 1; }
.footer { display: flex; justify-content: space-between; gap: 12px; padding-top: 32px; padding-bottom: calc(24px + env(safe-area-inset-bottom)); font-size: 13px; }
</style>
