<script setup lang="ts">
import type { DocFile, FileKind } from '../utils/format'

const props = withDefaults(defineProps<{ file: DocFile, size?: 'sm' | 'md' | 'lg' }>(), { size: 'md' })

const palette: Record<FileKind, string> = {
  pdf: '#e5484d', image: '#8e4ec6', video: '#d6409f', audio: '#e54666', text: '#6b7280',
  word: '#2f6fe4', excel: '#1f9d55', slides: '#e5701b', archive: '#a0742a', other: '#64748b'
}
const color = computed(() => palette[fileKind(props.file)])
const label = computed(() => (props.file.ext || 'fichier').slice(0, 4).toUpperCase())
</script>

<template>
  <span class="file-badge" :class="`is-${size}`" :style="{ '--c': color }">
    <AppIcon name="file" :size="size === 'lg' ? 30 : size === 'sm' ? 16 : 22" />
    <span class="ext">{{ label }}</span>
  </span>
</template>

<style scoped>
.file-badge {
  position: relative; flex: none; display: inline-grid; place-items: center;
  width: 44px; height: 48px; border-radius: 10px;
  background: color-mix(in srgb, var(--c) 12%, var(--surface));
  color: var(--c);
}
.ext {
  position: absolute; bottom: 5px; left: 50%; transform: translateX(-50%);
  font-size: 8.5px; font-weight: 700; letter-spacing: .04em;
  background: var(--c); color: #fff; padding: 0 4px; border-radius: 3px; line-height: 13px;
}
.is-sm { width: 34px; height: 38px; border-radius: 8px; }
.is-sm .ext { display: none; }
.is-lg { width: 64px; height: 72px; border-radius: 14px; }
.is-lg .ext { font-size: 10px; line-height: 15px; bottom: 8px; }
</style>
