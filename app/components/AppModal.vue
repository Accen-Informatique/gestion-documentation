<script setup lang="ts">
// Fenêtre modale : plein écran en bas sur mobile, centrée sur ordinateur
const props = withDefaults(defineProps<{ open: boolean, title?: string, width?: number }>(), { width: 520 })
const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

watch(() => props.open, async (open) => {
  if (!import.meta.client) return
  document.documentElement.style.overflow = open ? 'hidden' : ''
  if (open) {
    window.addEventListener('keydown', onKey)
    await nextTick()
    const target = panel.value?.querySelector<HTMLElement>('[autofocus], input, textarea, select') ?? panel.value
    target?.focus()
  } else {
    window.removeEventListener('keydown', onKey)
  }
}, { immediate: true })

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.documentElement.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="overlay" @mousedown.self="emit('close')">
        <div ref="panel" class="panel" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" :style="{ '--w': `${width}px` }">
          <header v-if="title || $slots.header" class="head">
            <slot name="header"><h2>{{ title }}</h2></slot>
            <button class="btn btn-ghost btn-icon btn-sm" type="button" aria-label="Fermer" @click="emit('close')">
              <AppIcon name="x" />
            </button>
          </header>
          <div class="content"><slot /></div>
          <footer v-if="$slots.footer" class="foot"><slot name="footer" /></footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; z-index: 50;
  display: flex; align-items: flex-end; justify-content: center;
  background: rgb(10 12 18 / .5); backdrop-filter: blur(2px);
}
.panel {
  width: 100%; max-height: 92dvh; display: flex; flex-direction: column;
  background: var(--surface); border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  box-shadow: var(--shadow-lg); outline: none;
  padding-bottom: env(safe-area-inset-bottom);
}
.head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 16px 4px 20px; }
.head h2 { font-size: 17px; }
.content { padding: 12px 20px 20px; overflow-y: auto; }
.foot { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 20px 16px; border-top: 1px solid var(--border); }
.foot :deep(.btn) { flex: 1; }
@media (min-width: 640px) {
  .overlay { align-items: center; padding: 24px; }
  .panel { max-width: var(--w); border-radius: var(--radius-lg); max-height: 88vh; }
  .foot :deep(.btn) { flex: none; }
}
.modal-enter-active, .modal-leave-active { transition: opacity .18s ease; }
.modal-enter-active .panel, .modal-leave-active .panel { transition: transform .22s cubic-bezier(.2, .8, .2, 1); }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .panel, .modal-leave-to .panel { transform: translateY(24px); }
</style>
