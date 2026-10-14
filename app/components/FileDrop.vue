<script setup lang="ts">
// Zone de dépôt de fichier (glisser-déposer ou sélection)
const model = defineModel<File | null>({ default: null })
defineProps<{ label?: string }>()

const input = ref<HTMLInputElement | null>(null)
const over = ref(false)

function pick(files: FileList | null | undefined) {
  if (files?.length) model.value = files[0]
}
function onDrop(e: DragEvent) {
  over.value = false
  pick(e.dataTransfer?.files)
}
const ext = computed(() => (model.value?.name.split('.').pop() || '').toLowerCase())
</script>

<template>
  <div
    class="drop" :class="{ over, filled: !!model }" role="button" tabindex="0"
    @click="input?.click()" @keydown.enter.prevent="input?.click()" @keydown.space.prevent="input?.click()"
    @dragover.prevent="over = true" @dragleave.prevent="over = false" @drop.prevent="onDrop"
  >
    <input ref="input" type="file" class="sr-only" tabindex="-1" @change="pick(($event.target as HTMLInputElement).files)">
    <template v-if="model">
      <FileBadge :file="{ name: model.name, mimeType: model.type, size: model.size, ext }" size="sm" />
      <div class="grow">
        <div class="truncate name">{{ model.name }}</div>
        <div class="hint">{{ formatSize(model.size) }} · cliquer pour changer</div>
      </div>
      <button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="Retirer le fichier" @click.stop="model = null"><AppIcon name="x" /></button>
    </template>
    <template v-else>
      <span class="icon"><AppIcon name="upload" :size="20" /></span>
      <div class="grow">
        <div class="name">{{ label || 'Choisir un fichier' }}</div>
        <div class="hint">Glissez-déposez ou touchez pour parcourir</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.drop {
  display: flex; align-items: center; gap: 12px; padding: 16px;
  border: 1.5px dashed var(--border); border-radius: var(--radius); cursor: pointer;
  background: var(--surface-2); transition: border-color .15s, background .15s;
}
.drop:hover, .drop.over { border-color: var(--primary); background: var(--primary-soft); }
.drop.filled { border-style: solid; background: var(--surface); }
.icon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 10px; background: var(--surface); color: var(--primary); flex: none; }
.name { font-weight: 600; font-size: 14px; }
</style>
