<script lang="ts">
  // Foto o icona del prodotto: la miniatura scattata, poi la foto di Open Food Facts (serve internet), poi l'emoji.
  let { emoji, thumb, imageUrl, size = 56 }: { emoji: string; thumb?: string; imageUrl?: string; size?: number } = $props();
  let broken = $state(false);
  const src = $derived(thumb || (!broken ? imageUrl : undefined));
</script>

<span class="thumb" style:width="{size}px" style:height="{size}px" style:font-size="{Math.round(size * 0.52)}px">
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
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    background: #fff;
  }
</style>
