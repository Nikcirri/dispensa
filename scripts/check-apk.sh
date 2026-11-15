#!/usr/bin/env bash
# Controlla l'APK finito (dopo la build Android, in GitHub Actions):
#  - scrive nel riepilogo della build dimensione, permessi e parti più pesanti;
#  - avvisa (senza fermare la build) se compare un permesso che l'app non dovrebbe avere.
# Uso: scripts/check-apk.sh percorso/app.apk
set -euo pipefail

APK="$1"
# Permessi previsti: internet (IA, codici a barre, aggiornamenti), fotocamera (mirino), installazione degli
# aggiornamenti, notifiche delle scadenze (con riavvio del telefono e sveglie), vibrazione, stato della rete.
EXPECTED="INTERNET REQUEST_INSTALL_PACKAGES CAMERA POST_NOTIFICATIONS RECEIVE_BOOT_COMPLETED WAKE_LOCK SCHEDULE_EXACT_ALARM VIBRATE ACCESS_NETWORK_STATE DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"

BUILD_TOOLS=$(ls -d "$ANDROID_HOME"/build-tools/*/ | sort -V | tail -n 1)
AAPT2="${BUILD_TOOLS}aapt2"

PERMS=$("$AAPT2" dump permissions "$APK" | grep -o "name='[^']*'" | sed "s/name='//; s/'//" | sed 's/.*\.//' | sort -u || true)

EXTRA=""
for p in $PERMS; do
  if [[ " $EXPECTED " != *" $p "* ]]; then EXTRA="$EXTRA $p"; fi
done

SIZE=$(du -k "$APK" | cut -f1)
{
  echo "### APK"
  echo "- Dimensione: $((SIZE / 1024)) MB ($SIZE KB)"
  echo "- Permessi: $(echo $PERMS)"
  echo ""
  echo "Parti più pesanti:"
  echo '```'
  # awk legge tutto (con "head" sort si interromperebbe con un errore).
  unzip -l "$APK" | sort -k1 -n -r | awk 'NR <= 12'
  echo '```'
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

if [ -n "$EXTRA" ]; then
  echo "::warning title=Permessi non previsti::$EXTRA"
fi
echo "APK controllato: $((SIZE / 1024)) MB, permessi: $(echo $PERMS)"
