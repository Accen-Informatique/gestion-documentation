<script setup lang="ts">
const { pending, answer } = useConfirm()
</script>

<template>
  <AppModal :open="!!pending" :title="pending?.title" :width="420" @close="answer(false)">
    <p v-if="pending?.message" class="muted">{{ pending.message }}</p>
    <template #footer>
      <button class="btn" type="button" @click="answer(false)">Annuler</button>
      <button class="btn" :class="pending?.danger ? 'btn-danger-solid' : 'btn-primary'" type="button" autofocus @click="answer(true)">
        {{ pending?.confirmLabel || 'Confirmer' }}
      </button>
    </template>
  </AppModal>
</template>
