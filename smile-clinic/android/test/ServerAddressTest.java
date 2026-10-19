import com.smileclinic.app.ServerAddress;

/**
 * Plain-JVM checks for the one piece of real logic in the Android app.
 * Run with: ./android/test.sh
 */
public class ServerAddressTest {

    private static int failures = 0;

    public static void main(String[] args) {
        // Bare host and port combinations the clinic is likely to type.
        expect("192.168.1.42", "http://192.168.1.42:4000");
        expect("192.168.1.42:4000", "http://192.168.1.42:4000");
        expect("192.168.1.42:8080", "http://192.168.1.42:8080");
        expect("http://192.168.1.42:4000", "http://192.168.1.42:4000");
        expect("http://192.168.1.42", "http://192.168.1.42:4000");

        // Tidying up.
        expect("  192.168.1.42:4000  ", "http://192.168.1.42:4000");
        expect("192.168.1.42:4000/", "http://192.168.1.42:4000");
        expect("192.168.1.42:4000///", "http://192.168.1.42:4000");
        expect("192.168.1. 42:4000", "http://192.168.1.42:4000");

        // Host names work as well as numbers.
        expect("clinic-mac.local", "http://clinic-mac.local:4000");
        expect("clinic-mac.local:4000", "http://clinic-mac.local:4000");

        // HTTPS keeps its own default port rather than being forced to 4000.
        expect("https://clinic.example.com", "https://clinic.example.com");

        // Things that are not a server address.
        expect("", null);
        expect("   ", null);
        expect(null, null);
        expect("://nonsense", null);
        expect("ftp://192.168.1.42", null);
        expect("http://192.168.1.42:4000/patients", null);
        expect("http://192.168.1.42:4000?q=1", null);

        if (failures == 0) {
            System.out.println("ServerAddress: all checks passed");
        } else {
            System.out.println("ServerAddress: " + failures + " check(s) FAILED");
            System.exit(1);
        }
    }

    private static void expect(String input, String want) {
        String got = ServerAddress.normalise(input);
        boolean ok = want == null ? got == null : want.equals(got);
        if (!ok) {
            failures++;
            System.out.println("  FAIL  " + quote(input) + "  ->  " + quote(got)
                    + "   (expected " + quote(want) + ")");
        } else {
            System.out.println("  ok    " + quote(input) + "  ->  " + quote(got));
        }
    }

    private static String quote(String value) {
        return value == null ? "null" : "\"" + value + "\"";
    }
}
