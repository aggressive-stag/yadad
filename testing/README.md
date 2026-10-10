# @yadad/testing

Test support for yadad: a mock registry (unstyled stub components with `data-testid` hooks) as the main entry, and the registry contract test kit (`describeRegistryContract`) under `@yadad/testing/contract-kit` — renders with fixture options, emits the right JSON type on change, shows an error, passes axe.

Engine packages' test files import it (D20); the components repo runs the kit against its registry. See the repo [README](https://github.com/aggressive-stag/yadad) and [ARCHITECTURE.md](https://github.com/aggressive-stag/yadad/blob/main/ARCHITECTURE.md) (§12) for the design.
