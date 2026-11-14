# @yadad/cli

## 0.1.0

### Minor Changes

- 6735800: New package: the `ydcli` command (RFC 0012). `ydcli validate <files or directories> [--json] [--strict]` migrates and validates documents against the installed `@yadad/core` and reports every error with its file, JSON pointer, code and hint (exit 0 valid, 1 invalid or not JSON, 2 could not run). `ydcli describe [--json | --kind <kind> | --example <kind>]` prints what that version of `@yadad/core` accepts. Requires `@yadad/core` 0.19.0 or newer as a peer dependency.
