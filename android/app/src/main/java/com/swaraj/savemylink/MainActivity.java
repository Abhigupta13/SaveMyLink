package com.swaraj.savemylink;

import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Message;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * The app is a remote-URL Capacitor shell, so this WebView is the entire UI. A stock WebView is
 * missing two things a browser does for free, and both failed silently — nothing happened, no
 * error, nothing in the console:
 *
 *   1. Downloads. A WebView drops them on the floor unless a DownloadListener is attached. Every
 *      Digi Locker file link and every note attachment did nothing when tapped, as did the
 *      "Get the Android app" link the onboarding checklist shows inside the app itself.
 *   2. window.open / target="_blank". Without multiple-window support the call is discarded, so
 *      opening a saved link from search did nothing.
 *
 * Silent no-ops are the expensive kind of bug: there is nothing to search for and nothing to
 * report, so it reads as "the app is broken" with no detail attached.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Bridge bridge = getBridge();
        WebView webView = bridge.getWebView();

        // Capacitor installs its own BridgeWebChromeClient during bridge init, and that class is
        // what bridges getUserMedia to the RECORD_AUDIO runtime permission (onPermissionRequest)
        // and <input type="file"> to the system picker and camera (onShowFileChooser). Replacing
        // it wholesale would silently kill the mic and every upload, so subclass it instead.
        webView.getSettings().setSupportMultipleWindows(true);
        webView.getSettings().setJavaScriptCanOpenWindowsAutomatically(true);
        webView.setWebChromeClient(new ExternalWindowChromeClient(bridge));

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) ->
            startDownload(url, userAgent, contentDisposition, mimeType));
    }

    /**
     * Hand the download to Android's DownloadManager, which gives the user the notification and
     * the retry they expect.
     *
     * The cookie header is the part that is easy to miss: /api/files/[...key] is session-gated, and
     * DownloadManager runs outside the WebView, so without copying the session cookie across every
     * document download would come back as the sign-in page saved to disk under the right filename.
     */
    private void startDownload(String url, String userAgent, String contentDisposition, String mimeType) {
        // blob: and data: URLs are built inside the page and have no meaning to a system-level
        // downloader. Nothing in this app produces one today; saying so beats a silent no-op if
        // that ever changes.
        if (url == null || url.startsWith("blob:") || url.startsWith("data:")) {
            Toast.makeText(this, "This file cannot be saved from the app. Open it in a browser.", Toast.LENGTH_LONG).show();
            return;
        }

        try {
            String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));

            request.setMimeType(mimeType);
            request.addRequestHeader("User-Agent", userAgent);
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) request.addRequestHeader("Cookie", cookie);

            request.setTitle(fileName);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);

            // The public Downloads folder needs WRITE_EXTERNAL_STORAGE below API 29. Rather than
            // ask for a storage permission the download page promises this app never requests,
            // older devices get the app-private Downloads directory — still reachable from the
            // DownloadManager notification, and no permission prompt on any Android version.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            } else {
                request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, fileName);
            }

            DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            if (manager == null) {
                Toast.makeText(this, "Downloads are unavailable on this device.", Toast.LENGTH_LONG).show();
                return;
            }
            manager.enqueue(request);
            Toast.makeText(this, "Downloading " + fileName, Toast.LENGTH_SHORT).show();
        } catch (RuntimeException e) {
            // A failed download must say so. The whole point of this class is that it used to not.
            Toast.makeText(this, "Could not start the download.", Toast.LENGTH_LONG).show();
        }
    }

    /** Send a link the page opened in a new window to the real browser, where it belongs. */
    private void openExternally(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app can open that link.", Toast.LENGTH_SHORT).show();
        }
    }

    private class ExternalWindowChromeClient extends BridgeWebChromeClient {

        ExternalWindowChromeClient(Bridge bridge) {
            super(bridge);
        }

        /**
         * A page calling window.open() or following target="_blank" lands here. There is no second
         * WebView to show it in and no tab UI, so the link goes to the system browser.
         *
         * The throwaway WebView is the standard way to learn the target URL: WebView hands the new
         * window a transport rather than a URL, so the destination only becomes visible when that
         * window tries to navigate. It never loads anything — shouldOverrideUrlLoading intercepts
         * the first navigation and that is the URL we wanted.
         */
        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            if (resultMsg == null || !(resultMsg.obj instanceof WebView.WebViewTransport)) return false;

            WebView probe = new WebView(view.getContext());
            probe.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView probeView, WebResourceRequest request) {
                    openExternally(request.getUrl());
                    probeView.destroy();
                    return true;
                }
            });

            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(probe);
            resultMsg.sendToTarget();
            return true;
        }
    }
}
