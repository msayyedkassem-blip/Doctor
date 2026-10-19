package com.smileclinic.app;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceResponse;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Serves the bundled app from inside the APK under a made-up https origin.
 *
 * The origin matters: the storage the local database needs is only offered to
 * a secure context, and a file:// page is not one. Answering requests for
 * https://appassets.androidplatform.net/... from the APK's own assets gives the
 * page a proper, secure, same-origin home without any server existing.
 */
final class AssetServer {

    static final String HOST = "appassets.androidplatform.net";
    static final String ORIGIN = "https://" + HOST;
    static final String START_PAGE = ORIGIN + "/index.html";

    private static final String ASSET_ROOT = "web";

    private static final Map<String, String> TYPES = new HashMap<>();
    static {
        TYPES.put("html", "text/html");
        TYPES.put("js", "text/javascript");
        TYPES.put("mjs", "text/javascript");
        TYPES.put("css", "text/css");
        TYPES.put("json", "application/json");
        TYPES.put("webmanifest", "application/manifest+json");
        // Without this exact type the browser refuses to compile the database engine.
        TYPES.put("wasm", "application/wasm");
        TYPES.put("png", "image/png");
        TYPES.put("jpg", "image/jpeg");
        TYPES.put("svg", "image/svg+xml");
        TYPES.put("ico", "image/x-icon");
        TYPES.put("woff2", "font/woff2");
        TYPES.put("sql", "text/plain");
    }

    private final AssetManager assets;

    AssetServer(AssetManager assets) {
        this.assets = assets;
    }

    static boolean handles(Uri uri) {
        return HOST.equals(uri.getHost());
    }

    /**
     * Returns the bundled file for this URL, or null to let the WebView do
     * whatever it would normally do.
     */
    WebResourceResponse serve(Uri uri) {
        String path = uri.getPath();
        if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";

        // Everything is bundled, so anything unknown is a mistake, not a route.
        if (path.contains("..")) return notFound();

        String assetPath = ASSET_ROOT + path;
        String type = TYPES.get(extensionOf(path));
        if (type == null) type = "application/octet-stream";

        try {
            InputStream stream = assets.open(assetPath);
            Map<String, String> headers = new HashMap<>();
            // Same-origin throughout, so nothing here needs relaxing.
            headers.put("Cache-Control", "no-cache");
            WebResourceResponse response = new WebResourceResponse(
                    type, type.startsWith("text/") || type.contains("json") ? "utf-8" : null,
                    stream);
            response.setStatusCodeAndReasonPhrase(200, "OK");
            response.setResponseHeaders(headers);
            return response;
        } catch (IOException e) {
            return notFound();
        }
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8",
                new java.io.ByteArrayInputStream("Not found".getBytes()));
    }

    private static String extensionOf(String path) {
        int dot = path.lastIndexOf('.');
        int slash = path.lastIndexOf('/');
        if (dot < 0 || dot < slash) return "";
        return path.substring(dot + 1).toLowerCase();
    }
}
