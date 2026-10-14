<script setup lang="ts">
// Saisie d'un code d'accès client
const { tokenDialogOpen, addCode } = useAccess()
const toast = useToast()
const emit = defineEmits<{ unlocked: [] }>()

const code = ref('')
const error = ref('')
const loading = ref(false)

watch(tokenDialogOpen, (open) => {
  if (open) { code.value = ''; error.value = '' }
})

async function submit() {
  if (!code.value.trim() || loading.value) return
  loading.value = true
  error.value = ''
  try {
    const res = await addCode(code.value.trim())
    tokenDialogOpen.value = false
    toast.success(res.documentCount
      ? `Accès ouvert : ${res.documentCount} document${res.documentCount > 1 ? 's' : ''} disponible${res.documentCount > 1 ? 's' : ''}.`
      : 'Accès ouvert. Aucun document pour le moment.')
    emit('unlocked')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <AppModal :open="tokenDialogOpen" title="Accéder à mes documents" :width="440" @close="tokenDialogOpen = false">
    <form class="stack" @submit.prevent="submit">
      <p class="muted">Saisissez le code d'accès qui vous a été transmis pour afficher les documents qui vous sont réservés.</p>
      <div class="field">
        <label class="label" for="client-code">Code d'accès</label>
        <div class="input-icon">
          <AppIcon name="key" />
          <input
            id="client-code" v-model="code" class="input mono" type="text" placeholder="XXXX-XXXX-XXXX-XXXX"
            autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" autofocus
          >
        </div>
      </div>
      <div v-if="error" class="alert alert-danger" role="alert"><AppIcon name="alert" :size="17" />{{ error }}</div>
      <button class="btn btn-primary btn-block" type="submit" :disabled="!code.trim() || loading">
        <AppIcon :name="loading ? 'loader' : 'lock'" :size="17" />
        Débloquer
      </button>
    </form>
  </AppModal>
</template>
