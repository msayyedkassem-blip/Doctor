package com.smileclinic.app;

/**
 * The fiddly parts of saving a file the web app made.
 *
 * Separate from the activity so they can be tested on a plain JVM: both take
 * a name chosen by the page and put it somewhere it matters — one into a file
 * path, the other into a line of JavaScript — and neither is a good place to
 * be guessing.
 */
final class SavedFile {

    private SavedFile() { }

    /** No directories, no control characters: a plain file name or a plain default. */
    static String safeName(String name) {
        if (name == null) return "smile-clinic-download";
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < name.length(); i += 1) {
            char c = name.charAt(i);
            if (c == '/' || c == '\\' || c < 0x20 || c == 0x7f) continue;
            out.append(c);
        }
        // "..", "." and anything that is only dots name a directory, not a file.
        String cleaned = out.toString().trim();
        while (cleaned.startsWith(".")) cleaned = cleaned.substring(1);
        cleaned = cleaned.trim();
        if (cleaned.length() == 0) return "smile-clinic-download";
        return cleaned.length() > 120 ? cleaned.substring(cleaned.length() - 120) : cleaned;
    }

    /**
     * A JavaScript string literal, with the quotes and the escaping.
     *
     * Everything outside plain printable ASCII is escaped rather than passed
     * through, so a file name cannot close the string and become code.
     */
    static String quote(String value) {
        StringBuilder out = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i += 1) {
            char c = value.charAt(i);
            if (c == '"' || c == '\\') out.append('\\').append(c);
            else if (c < 0x20 || c > 0x7e) out.append(String.format("\\u%04x", (int) c));
            else out.append(c);
        }
        return out.append('"').toString();
    }

    static String mimeFor(String name) {
        String lower = name.toLowerCase();
        if (lower.endsWith(".csv")) return "text/csv";
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }
}
