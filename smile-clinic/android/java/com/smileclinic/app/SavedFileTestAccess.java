package com.smileclinic.app;

/**
 * Opens SavedFile to the test runner, which lives outside this package.
 *
 * Kept to this one purpose so SavedFile itself stays package-private: nothing
 * in the app needs it from elsewhere.
 */
public final class SavedFileTestAccess {
    private SavedFileTestAccess() { }

    public static String safeName(String name) { return SavedFile.safeName(name); }

    public static String quote(String value) { return SavedFile.quote(value); }

    public static String mimeFor(String name) { return SavedFile.mimeFor(name); }
}
