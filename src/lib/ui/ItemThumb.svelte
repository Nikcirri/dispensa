<script lang="ts">
  // Foto o icona del prodotto: la miniatura scattata, poi la foto di Open Food Facts (serve internet), poi l'emoji.
  let {
    emoji,
    thumb,
    imageUrl,
    size = 56,
    tone = '',
  }: { emoji: string; thumb?: string; imageUrl?: string; size?: number; tone?: string } = $props();
  let broken = $state(false);
  const src = $derived(thumb || (!broken ? imageUrl : undefined));
</script>

<span class="thumb {tone}" style:width="{size}px" style:height="{size}px" style:font-size="{Math.round(size * 0.52)}px">
  {#if src}
    <img {src} alt="" loading="lazy" onerror={() => (broken = true)} />
  {:else}
    <span aria-hidden="true">{emoji || '🛒'}</span>
  {/if}
</span>

<style>
  .thumb {
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 16px;
    background: var(--surface-2);
    overflow: hidden;
    line-height: 1;
  }
  /* Colore del riquadro secondo l'urgenza (come le icone dei pasti di Nutrizione). */
  .rosso,
  .scaduto {
    background: var(--red-soft);
  }
  .arancione {
    background: var(--amber-soft);
  }
  .verde {
    background: var(--accent-soft);
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    background: #fff;
  }
</style>
