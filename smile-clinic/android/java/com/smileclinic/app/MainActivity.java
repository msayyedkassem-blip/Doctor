package com.smileclinic.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.WebResourceResponse;
import android.webkit.URLUtil;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Smile Clinic for Android.
 *
 * The clinic's server runs on a computer in the practice; this app is the
 * window onto it. It is deliberately thin — all the logic, data and updates
 * live on the server, so updating the server updates every phone at once.
 *
 * What it adds over opening the address in a browser:
 *   - a launcher icon and no browser chrome
 *   - the server address is remembered, and checked before it is accepted
 *   - WhatsApp links leave the app and open the real WhatsApp
 *   - CSV exports go to the phone's Downloads instead of doing nothing
 *   - a real error screen when the clinic computer is off or asleep
 */
public class MainActivity extends Activity {

    private static final String PREFS = "smile_clinic";
    private static final String KEY_SERVER = "server_url";
    private static final String KEY_MODE = "mode";
    private static final String MODE_LOCAL = "local";
    private static final String MODE_SERVER = "server";
    private static final int BRAND = 0xFF0F7B8A;

    private WebView web;
    private SharedPreferences prefs;
    private AssetServer assetServer;
    private boolean showingError = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        assetServer = new AssetServer(getAssets());

        String mode = prefs.getString(KEY_MODE, null);
        String server = prefs.getString(KEY_SERVER, null);

        if (MODE_LOCAL.equals(mode)) {
            showWeb(AssetServer.START_PAGE);
        } else if (MODE_SERVER.equals(mode) && server != null && !server.isEmpty()) {
            showWeb(server);
        } else {
            showModeChoice();
        }
    }

    // ----------------------------------------------------------- first run

    /**
     * The one decision that shapes everything else: does this phone hold the
     * records itself, or read them from a clinic computer?
     */
    private void showModeChoice() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(themeBackground());
        int pad = dp(24);
        root.setPadding(pad, dp(56), pad, pad);

        TextView title = new TextView(this);
        title.setText("Smile Clinic");
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 28);
        title.setTextColor(BRAND);
        title.setGravity(Gravity.CENTER_HORIZONTAL);

        TextView blurb = new TextView(this);
        blurb.setText("Where should this phone keep its records?");
        blurb.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        blurb.setTextColor(themeText());
        blurb.setGravity(Gravity.CENTER_HORIZONTAL);
        blurb.setPadding(0, dp(14), 0, dp(28));

        Button onPhone = new Button(this);
        onPhone.setText("On this phone");
        onPhone.setAllCaps(false);
        onPhone.setTextColor(Color.WHITE);
        onPhone.setBackgroundColor(BRAND);
        onPhone.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                prefs.edit().putString(KEY_MODE, MODE_LOCAL).apply();
                showWeb(AssetServer.START_PAGE);
            }
        });

        TextView onPhoneHelp = new TextView(this);
        onPhoneHelp.setText("Works with no Wi-Fi and no computer. The records live here, "
                + "on this phone, and no other device sees them yet.");
        onPhoneHelp.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f);
        onPhoneHelp.setTextColor(themeMuted());
        onPhoneHelp.setPadding(0, dp(8), 0, dp(28));

        Button onServer = new Button(this);
        onServer.setText("On a clinic computer");
        onServer.setAllCaps(false);
        onServer.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                prefs.edit().putString(KEY_MODE, MODE_SERVER).apply();
                showSetup(null);
            }
        });

        TextView onServerHelp = new TextView(this);
        onServerHelp.setText("Everyone connecting to that computer sees the same records. "
                + "Needs the computer switched on and the same Wi-Fi.");
        onServerHelp.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f);
        onServerHelp.setTextColor(themeMuted());
        onServerHelp.setPadding(0, dp(8), 0, 0);

        TextView footer = new TextView(this);
        footer.setText("You can change this later from the back button menu.");
        footer.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        footer.setTextColor(themeMuted());
        footer.setGravity(Gravity.CENTER_HORIZONTAL);
        footer.setPadding(0, dp(36), 0, 0);

        root.addView(title);
        root.addView(blurb);
        root.addView(onPhone, matchWidth());
        root.addView(onPhoneHelp);
        root.addView(onServer, matchWidth());
        root.addView(onServerHelp);
        root.addView(footer);

        ScrollView scroller = new ScrollView(this);
        scroller.addView(root);
        setContentView(scroller);
    }

    // ---------------------------------------------------------------- setup

    /** First-run screen, also reachable later to point the app somewhere else. */
    private void showSetup(final String problem) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(themeBackground());
        int pad = dp(24);
        root.setPadding(pad, dp(48), pad, pad);

        TextView title = new TextView(this);
        title.setText("Smile Clinic");
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
        title.setTextColor(BRAND);
        title.setGravity(Gravity.CENTER_HORIZONTAL);

        TextView blurb = new TextView(this);
        blurb.setText("Enter the address shown on the clinic computer under "
                + "Settings → Clinic, or from \"npm run address\".");
        blurb.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        blurb.setTextColor(themeMuted());
        blurb.setGravity(Gravity.CENTER_HORIZONTAL);
        blurb.setPadding(0, dp(12), 0, dp(24));

        final EditText input = new EditText(this);
        input.setHint("192.168.1.42:4000");
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setTextColor(themeText());
        String existing = prefs.getString(KEY_SERVER, "");
        if (!existing.isEmpty()) input.setText(existing);

        final TextView status = new TextView(this);
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        status.setPadding(0, dp(12), 0, 0);
        status.setGravity(Gravity.CENTER_HORIZONTAL);
        if (problem != null) {
            status.setText(problem);
            status.setTextColor(0xFFB3261E);
        }

        final Button connect = new Button(this);
        connect.setText("Connect");
        connect.setAllCaps(false);
        connect.setTextColor(Color.WHITE);
        connect.setBackgroundColor(BRAND);

        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        buttonParams.topMargin = dp(20);
        connect.setLayoutParams(buttonParams);

        connect.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                final String url = ServerAddress.normalise(input.getText().toString());
                if (url == null) {
                    status.setText("That does not look like an address.");
                    status.setTextColor(0xFFB3261E);
                    return;
                }
                connect.setEnabled(false);
                status.setTextColor(themeMuted());
                status.setText("Checking …");
                checkThenSave(url, status, connect);
            }
        });

        TextView help = new TextView(this);
        help.setText("The phone must be on the same Wi-Fi as the clinic computer, "
                + "and the clinic app must be running on it.");
        help.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        help.setTextColor(themeMuted());
        help.setGravity(Gravity.CENTER_HORIZONTAL);
        help.setPadding(0, dp(28), 0, 0);

        root.addView(title);
        root.addView(blurb);
        root.addView(input);
        root.addView(connect);
        root.addView(status);
        root.addView(help);

        ScrollView scroller = new ScrollView(this);
        scroller.addView(root);
        setContentView(scroller);
    }

    /**
     * Confirms something is actually listening before the address is stored, so
     * a typo is caught here rather than becoming a blank screen later.
     */
    private void checkThenSave(final String url, final TextView status, final Button button) {
        final Handler ui = new Handler(Looper.getMainLooper());
        new Thread(new Runnable() {
            @Override public void run() {
                String failure = null;
                HttpURLConnection connection = null;
                try {
                    connection = (HttpURLConnection) new URL(url + "/api/health").openConnection();
                    connection.setConnectTimeout(5000);
                    connection.setReadTimeout(5000);
                    connection.setRequestProperty("Accept", "application/json");
                    int code = connection.getResponseCode();
                    if (code != 200) failure = "The address answered with error " + code + ".";
                } catch (IOException e) {
                    failure = "Could not reach " + url + ".\nIs the clinic computer on, "
                            + "and is this phone on the same Wi-Fi?";
                } finally {
                    if (connection != null) connection.disconnect();
                }

                final String problem = failure;
                ui.post(new Runnable() {
                    @Override public void run() {
                        button.setEnabled(true);
                        if (problem != null) {
                            status.setText(problem);
                            status.setTextColor(0xFFB3261E);
                            return;
                        }
                        prefs.edit()
                                .putString(KEY_SERVER, url)
                                .putString(KEY_MODE, MODE_SERVER)
                                .apply();
                        showWeb(url);
                    }
                });
            }
        }).start();
    }

    // ------------------------------------------------------------------ web

    private void showWeb(final String server) {
        showingError = false;

        FrameLayoutCompat container = new FrameLayoutCompat(this);
        web = new WebView(this);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        // The web app keeps preferences in localStorage.
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // The bundled app is served from an https address inside the APK, while a
        // clinic server on the local network is plain http. Without this, the
        // browser blocks the app from reaching it and sync fails with nothing
        // more useful than "failed to fetch".
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        CookieManager.getInstance().setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        }

        final String host = hostOf(server);

        final boolean local = server.startsWith(AssetServer.ORIGIN);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view,
                                                              WebResourceRequest request) {
                // The bundled app answers itself; nothing leaves the phone.
                if (AssetServer.handles(request.getUrl())) {
                    return assetServer.serve(request.getUrl());
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl().toString(), host);
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(url, host);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        android.webkit.WebResourceError error) {
                // Only a failure of the page itself is worth a whole error screen,
                // and a bundled page cannot fail for want of a network.
                if (request.isForMainFrame() && !local) showError(server);
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(WebView view, int errorCode, String description,
                                        String failingUrl) {
                if (!local && failingUrl != null && failingUrl.startsWith(server)) showError(server);
            }
        });

        // CSV exports are ordinary downloads; without this they silently do nothing.
        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                        String mimeType, long contentLength) {
                try {
                    DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                    String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
                    request.setTitle(name);
                    request.addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url));
                    request.setNotificationVisibility(
                            DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                    DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                    manager.enqueue(request);
                    Toast.makeText(MainActivity.this, "Saving " + name + " to Downloads",
                            Toast.LENGTH_LONG).show();
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Could not download that file",
                            Toast.LENGTH_LONG).show();
                }
            }
        });

        container.addView(web, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(container);
        web.loadUrl(server);
    }

    /**
     * Decides whether a link belongs inside the app. Anything that is not the
     * clinic server — a wa.me link, a phone number, an email — is handed to the
     * app that owns it, which is what makes the WhatsApp button work.
     */
    private boolean handleUrl(String url, String host) {
        if (url == null) return false;

        if (url.startsWith("http://") || url.startsWith("https://")) {
            String target = hostOf(url);
            if (target != null && target.equals(host)) return false; // stay in the app
            return openExternally(url);
        }
        // tel:, mailto:, sms:, whatsapp:, intent: and anything else.
        return openExternally(url);
    }

    private boolean openExternally(String url) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            return true;
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Nothing on this phone can open that link",
                    Toast.LENGTH_LONG).show();
            return true;
        }
    }

    private static String hostOf(String url) {
        try {
            return new URL(url).getHost();
        } catch (Exception e) {
            return null;
        }
    }

    // ---------------------------------------------------------------- error

    private void showError(final String server) {
        if (showingError) return;
        showingError = true;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(themeBackground());
        int pad = dp(28);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText("Cannot reach the clinic");
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        title.setTextColor(themeText());
        title.setGravity(Gravity.CENTER);

        TextView detail = new TextView(this);
        detail.setText("Tried " + server + "\n\n"
                + "• Is the clinic computer switched on and awake?\n"
                + "• Is this phone on the clinic Wi-Fi?\n"
                + "• Has the address changed? The router can hand out a new one.");
        detail.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        detail.setTextColor(themeMuted());
        detail.setPadding(0, dp(16), 0, dp(24));

        Button retry = new Button(this);
        retry.setText("Try again");
        retry.setAllCaps(false);
        retry.setTextColor(Color.WHITE);
        retry.setBackgroundColor(BRAND);
        retry.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showWeb(server); }
        });

        Button change = new Button(this);
        change.setText("Change address");
        change.setAllCaps(false);
        change.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showSetup(null); }
        });

        root.addView(title);
        root.addView(detail);
        root.addView(retry, matchWidth());
        root.addView(change, matchWidth());
        setContentView(root);
    }

    // ----------------------------------------------------------- navigation

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        // At the first page, offer the things there is otherwise no room for.
        // Written as an anonymous class, not a lambda: android.jar carries no
        // LambdaMetafactory, so lambdas cannot be compiled against it directly.
        new AlertDialog.Builder(this)
                .setTitle("Smile Clinic")
                .setItems(new CharSequence[]{"Reload", "Where records are kept", "Close app"},
                        new android.content.DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(android.content.DialogInterface dialog, int which) {
                                if (which == 0 && web != null) web.reload();
                                else if (which == 1) showModeChoice();
                                else if (which == 2) finish();
                            }
                        })
                .setNegativeButton("Cancel", null)
                .show();
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Keep the session cookie if the phone is killed while the app is open.
        CookieManager.getInstance().flush();
    }

    // ------------------------------------------------------------- plumbing

    private LinearLayout.LayoutParams matchWidth() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(10);
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private boolean isDark() {
        int mode = getResources().getConfiguration().uiMode
                & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
        return mode == android.content.res.Configuration.UI_MODE_NIGHT_YES;
    }

    private int themeBackground() { return isDark() ? 0xFF10181D : 0xFFF4F6F8; }
    private int themeText()       { return isDark() ? 0xFFE4ECF1 : 0xFF16242E; }
    private int themeMuted()      { return isDark() ? 0xFF9BB0BE : 0xFF5C7080; }

    /** A plain container; avoids pulling in any support library for one view. */
    private static class FrameLayoutCompat extends android.widget.FrameLayout {
        FrameLayoutCompat(Context context) { super(context); }
    }
}
