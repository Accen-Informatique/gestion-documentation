<script setup lang="ts">
import type { DocItem } from '../utils/format'

defineProps<{ doc: DocItem }>()
</script>

<template>
  <NuxtLink :to="`/docs/${doc.id}`" class="doc-card card">
    <FileBadge :file="doc.file" />
    <div class="body">
      <div class="top">
        <h3 class="title">{{ doc.title }}</h3>
        <AppIcon v-if="doc.visibility === 'private'" name="lock" :size="15" class="lock" />
      </div>
      <p v-if="doc.description" class="desc">{{ doc.description }}</p>
      <div class="meta">
        <span v-if="doc.category" class="badge">{{ doc.category }}</span>
        <span v-if="doc.visibility === 'private' && doc.unlockedBy.length" class="badge badge-primary truncate">{{ doc.unlockedBy[0] }}</span>
        <span class="faint">{{ [formatSize(doc.file.size), formatDate(doc.updatedAt)].filter(Boolean).join(' · ') }}</span>
      </div>
    </div>
  </NuxtLink>
</template>

<style scoped>
.doc-card {
  display: flex; gap: 14px; padding: 16px; color: inherit;
  transition: border-color .15s, box-shadow .15s, transform .15s;
}
.doc-card:hover { border-color: color-mix(in srgb, var(--primary) 40%, var(--border)); box-shadow: var(--shadow); transform: translateY(-1px); }
.body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.top { display: flex; gap: 8px; align-items: flex-start; }
.title { flex: 1; font-size: 15px; font-weight: 600; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.lock { color: var(--primary); flex: none; margin-top: 2px; }
.desc { color: var(--muted); font-size: 13.5px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; font-size: 12.5px; margin-top: auto; padding-top: 2px; }
</style>
