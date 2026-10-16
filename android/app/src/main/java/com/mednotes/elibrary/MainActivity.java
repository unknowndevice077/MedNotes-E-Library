package com.mednotes.elibrary;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Screenshots are blocked by the reader through ScreenGuard, not app-wide,
        // so buyers can still screenshot things like the payment QR.
        registerPlugin(ScreenGuardPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
