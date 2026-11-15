<script lang="ts">
  import { app, sheets } from '../../lib/state/app.svelte';
  import AiKeyForm from '../../lib/ui/AiKeyForm.svelte';
  import Sheet from '../../lib/ui/Sheet.svelte';

  function close() {
    sheets.aiKey = false;
  }
</script>

<Sheet title="Collega Gemini" onclose={close}>
  <AiKeyForm
    onsaved={(k) => {
      app.aiKey = k;
      close();
    }}
  />
</Sheet>
