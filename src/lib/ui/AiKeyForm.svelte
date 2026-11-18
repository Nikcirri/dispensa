<script lang="ts">
  import { db } from '../db';
  import { reportError } from '../errors';
  import { looksLikeGeminiKey } from '../logic/gemini';
  import { openExternal } from '../platform';
  import { setAiKey } from '../repo';
  import { checkKey } from '../services/gemini';
  import { showToast } from '../state/ui.svelte';

  // Come collegare Gemini: link per creare la chiave e campo per incollarla.
  let { onsaved }: { onsaved: (key: string) => void } = $props();

  const KEY_PAGE = 'https://aistudio.google.com/apikey';
  let key = $state('');
  let checking = $state(false);
  const shapeOk = $derived(looksLikeGeminiKey(key));

  async function save() {
    const k = key.trim();
    if (!k) return;
    checking = true;
    try {
      const result = await checkKey(k);
      if (result === 'invalid') {
        showToast('Gemini dice che questa chiave non è valida: ricopiala tutta.', { duration: 4500 });
        return;
      }
      await setAiKey(db, k);
      showToast(result === 'ok' ? 'Gemini collegato' : 'Chiave salvata (non sono riuscito a provarla adesso)');
      key = '';
      onsaved(k);
    } catch (e) {
      reportError(e);
    } finally {
      checking = false;
    }
  }
</script>

<div class="steps">
  <p class="lead">Per leggere le etichette e proporre ricette l’app usa <strong>Google Gemini</strong>. Serve una chiave gratuita, una volta sola:</p>
  <ol>
    <li>Apri <button class="link" onclick={() => openExternal(KEY_PAGE)}>aistudio.google.com/apikey</button> e accedi con il tuo account Google.</li>
    <li>Tocca <strong>Create API key</strong> (o “Crea chiave API”), poi copia la <strong>Chiave API</strong> con l’icona accanto: inizia con <strong>AQ.</strong> (o con AIza se è vecchia).</li>
    <li>Torna qui e incollala qui sotto.</li>
  </ol>
  <p class="note">Hai già una chiave (per esempio quella dell’app Nutrizione)? Va bene la stessa: la ritrovi nella stessa pagina.</p>
  <label class="field">
    <span>Chiave di Gemini</span>
    <input
      class="input"
      type="password"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      placeholder="AQ.…"
      bind:value={key}
      enterkeyhint="done"
      onkeydown={(e) => {
        // Invio sulla tastiera = "Salva la chiave".
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault();
        (e.currentTarget as HTMLInputElement).blur();
        if (key.trim() && !checking) void save();
      }}
    />
  </label>
  {#if key.trim() && !shapeOk}<p class="note">La chiave di solito inizia con “AQ.” (o “AIza”): controlla di aver copiato la Chiave API e non il nome o il numero del progetto.</p>{/if}
  <button class="btn btn-primary btn-block" disabled={!key.trim() || checking} onclick={save}>{checking ? 'Controllo…' : 'Salva la chiave'}</button>
  <p class="note">
    La chiave resta solo su questo telefono (non va nei backup). È gratuita: Google dà circa 20 richieste al giorno per modello, più che sufficienti. Con il piano
    gratuito Google può usare le foto per migliorare i suoi servizi: non fotografare cose private.
  </p>
</div>

<style>
  .steps {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .lead {
    margin: 0;
    line-height: 1.5;
  }
  ol {
    margin: 0;
    padding-left: 22px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    line-height: 1.5;
  }
  .note {
    margin: 0;
  }
</style>
