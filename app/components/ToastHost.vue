<script setup lang="ts">
const { toasts, dismiss } = useToast()
const icons = { success: 'check', error: 'alert', info: 'key' } as const
</script>

<template>
  <Teleport to="body">
    <div class="toasts" aria-live="polite">
      <TransitionGroup name="toast">
        <div v-for="t in toasts" :key="t.id" class="toast" :class="`is-${t.type}`" @click="dismiss(t.id)">
          <AppIcon :name="icons[t.type]" :size="17" />
          <span>{{ t.message }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toasts {
  position: fixed; z-index: 60; left: 16px; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom));
  display: flex; flex-direction: column; gap: 8px; align-items: center; pointer-events: none;
}
.toast {
  pointer-events: auto; cursor: pointer;
  display: flex; align-items: center; gap: 10px; max-width: 440px; width: 100%;
  padding: 12px 16px; border-radius: var(--radius); font-size: 14px; font-weight: 500;
  background: var(--text); color: var(--bg); box-shadow: var(--shadow-lg);
}
.is-success svg { color: #4cc79a; }
.is-error { background: var(--danger); color: #fff; }
.is-info svg { color: var(--primary-soft); }
@media (min-width: 640px) { .toasts { left: auto; right: 24px; bottom: 24px; align-items: flex-end; } .toast { width: auto; } }
.toast-enter-active, .toast-leave-active { transition: all .22s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(10px); }
</style>
