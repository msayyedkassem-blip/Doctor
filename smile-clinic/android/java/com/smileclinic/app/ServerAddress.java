package com.smileclinic.app;

import java.net.URL;

/**
 * Turns whatever the clinic types into the URL the app should load.
 *
 * Kept free of Android imports on purpose: this is the only real logic in the
 * app, and this way it can be unit tested on an ordinary JVM.
 */
public final class ServerAddress {

    /** The port the clinic server listens on unless told otherwise. */
    private static final int DEFAULT_PORT = 4000;

    private ServerAddress() { }

    /**
     * Accepts "192.168.1.42", "192.168.1.42:4000", "http://192.168.1.42:4000/"
     * and returns a normalised base URL, or null if it is not usable.
     */
    public static String normalise(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) return null;

        value = value.replaceAll("\\s+", "");
        if (value.startsWith("://")) return null;
        if (!value.startsWith("http://") && !value.startsWith("https://")) {
            // Reject anything carrying some other scheme rather than glue http
            // onto it and produce nonsense like http://ftp://host.
            int scheme = value.indexOf("://");
            if (scheme >= 0) return null;
            value = "http://" + value;
        }

        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);

        try {
            URL parsed = new URL(value);
            String host = parsed.getHost();
            if (host == null || host.isEmpty()) return null;
            // A path, query or fragment is not part of a server address.
            if (parsed.getPath() != null && !parsed.getPath().isEmpty()) return null;
            if (parsed.getQuery() != null || parsed.getRef() != null) return null;
            if (parsed.getPort() == -1 && "http".equals(parsed.getProtocol())) {
                value = value + ":" + DEFAULT_PORT;
            }
        } catch (Exception e) {
            return null;
        }
        return value;
    }
}
