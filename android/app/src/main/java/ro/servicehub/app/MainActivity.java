package ro.servicehub.app;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.util.Locale;

/**
 * Keeps the app clear of Android's bars (T20a). Capacitor's own handling (SystemBars, turned off in
 * capacitor.config.ts) replaced the window's inset handling and left the three navigation buttons
 * drawn over the tab bar on some phones (Huawei P30 Pro, Android 10).
 *
 * Before Android 15 the window keeps its normal layout: the system places the app between the bars,
 * which are painted in the app's dark color. From Android 15 every app is drawn behind the bars, so
 * the app's view is padded by them here: the status bar and the sides always, the bottom when the
 * three buttons (or the keyboard) are there. A gesture bar is left to the page, which receives its
 * height as --safe-area-inset-bottom and lets content run under it.
 *
 * The bars always get light icons on the app's dark color, whatever the phone's own light or dark
 * mode. From Android 15 the system also lays a translucent scrim over the three buttons, light when
 * the phone is in light mode (a white bar under the tab bar on a Samsung): it is turned off, so the
 * app's dark background shows behind the buttons.
 */
public class MainActivity extends BridgeActivity {

    private static final int DARK = Color.parseColor("#14161A");
    /** A bottom bar at least this tall (dp) holds the three buttons; a gesture bar is ~16-24 dp. */
    private static final int NAV_BUTTONS_MIN_DP = 40;

    private int gestureBottomDp = 0;

    @Override
    @SuppressWarnings("deprecation")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        View content = findViewById(android.R.id.content);
        content.setBackgroundColor(DARK);
        WindowInsetsControllerCompat appearance = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        appearance.setAppearanceLightStatusBars(false);
        appearance.setAppearanceLightNavigationBars(false);

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            getWindow().setNavigationBarColor(DARK);
            return;
        }
        getWindow().setNavigationBarContrastEnforced(false);

        float density = getResources().getDisplayMetrics().density;
        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            boolean keyboard = insets.isVisible(WindowInsetsCompat.Type.ime());
            int ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
            boolean buttons = bars.bottom >= NAV_BUTTONS_MIN_DP * density;
            int bottom = keyboard ? Math.max(ime, bars.bottom) : buttons ? bars.bottom : 0;
            v.setPadding(bars.left, bars.top, bars.right, bottom);
            gestureBottomDp = keyboard || buttons ? 0 : Math.round(bars.bottom / density);
            injectInsets();
            // What is padded here is not reported again to the page (no double spacing).
            return new WindowInsetsCompat.Builder(insets)
                .setInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout(),
                    Insets.of(0, 0, 0, keyboard || buttons ? 0 : bars.bottom)
                )
                .build();
        });
        // A page that has just loaded gets the values again (no bridge: no WebView on this phone).
        if (getBridge() == null) return;
        getBridge().addWebViewListener(
            new WebViewListener() {
                @Override
                public void onPageCommitVisible(WebView view, String url) {
                    super.onPageCommitVisible(view, url);
                    injectInsets();
                }
            }
        );
    }

    private void injectInsets() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        String script = String.format(
            Locale.US,
            "try{var s=document.documentElement.style;" +
            "s.setProperty('--safe-area-inset-top','0px');s.setProperty('--safe-area-inset-right','0px');" +
            "s.setProperty('--safe-area-inset-left','0px');s.setProperty('--safe-area-inset-bottom','%dpx');}catch(e){}",
            gestureBottomDp
        );
        getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(script, null));
    }
}
