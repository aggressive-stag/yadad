// Allowed: tests may import @yadad/testing (no violation expected).
import "../../../testing/src/index";
// renderer-imports-core-runtime-only-in-tests: but not other packages.
import "../../theme/src/index";
