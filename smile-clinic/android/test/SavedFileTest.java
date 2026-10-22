import com.smileclinic.app.SavedFileTestAccess;

/**
 * The two places a file name chosen by the web page ends up somewhere it
 * matters: a path on the phone, and a line of JavaScript.
 */
public class SavedFileTest {
    private static int failures = 0;

    private static void check(String what, String actual, String expected) {
        boolean ok = expected == null ? actual == null : expected.equals(actual);
        System.out.println((ok ? "  ok    " : "  FAIL  ") + what
                + (ok ? "" : "  ->  " + actual + "  (wanted " + expected + ")"));
        if (!ok) failures += 1;
    }

    public static void main(String[] args) {
        // Ordinary names survive untouched.
        check("a backup file name", SavedFileTestAccess.safeName("clinic-backup-2026-10-22.db"),
                "clinic-backup-2026-10-22.db");
        check("a csv export", SavedFileTestAccess.safeName("patients.csv"), "patients.csv");
        check("Arabic in the name", SavedFileTestAccess.safeName("مرضى.csv"), "مرضى.csv");

        // Nothing may name a folder.
        check("a path is flattened", SavedFileTestAccess.safeName("../../etc/passwd"), "etcpasswd");
        check("a windows path too", SavedFileTestAccess.safeName("..\\\\secrets\\\\x.db"), "secretsx.db");
        check("a leading dot is dropped", SavedFileTestAccess.safeName(".hidden"), "hidden");
        check("dots alone", SavedFileTestAccess.safeName("..."), "smile-clinic-download");
        check("nothing at all", SavedFileTestAccess.safeName(""), "smile-clinic-download");
        check("no name given", SavedFileTestAccess.safeName(null), "smile-clinic-download");
        check("a newline in the name", SavedFileTestAccess.safeName("a\nb.csv"), "ab.csv");

        // Quoting: a name can never close the string and become code.
        check("a plain name", SavedFileTestAccess.quote("a.csv"), "\"a.csv\"");
        check("a quote in the name", SavedFileTestAccess.quote("a\".csv"), "\"a\\\".csv\"");
        check("a backslash", SavedFileTestAccess.quote("a\\b"), "\"a\\\\b\"");
        check("an attempt to break out",
                SavedFileTestAccess.quote("\");alert(1);//"),
                "\"\\\");alert(1);//\"");
        check("a newline is escaped", SavedFileTestAccess.quote("a\nb"), "\"a\\u000ab\"");
        check("Arabic is escaped, not passed through",
                SavedFileTestAccess.quote("م"), "\"\\u0645\"");

        check("a backup is a file, not text",
                SavedFileTestAccess.mimeFor("clinic.db"), "application/octet-stream");
        check("a csv says so", SavedFileTestAccess.mimeFor("patients.CSV"), "text/csv");

        if (failures > 0) {
            System.out.println("\n" + failures + " failure(s)");
            System.exit(1);
        }
        System.out.println("SavedFile: all checks passed");
    }
}
