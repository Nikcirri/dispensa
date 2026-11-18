package com.nikcirri.dispensa;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.nikcirri.dispensa.widgets.WidgetsPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin dell'app (non da npm): scarica e installa gli aggiornamenti.
        registerPlugin(AppUpdaterPlugin.class);
        // Widget della schermata Home: prodotti in scadenza e pasti in programma.
        registerPlugin(WidgetsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
