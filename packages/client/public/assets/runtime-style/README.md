# Runtime style sprites

This directory contains the small, tracked subset of the local style library that the
production game uses. The complete licensed source library remains gitignored.

After changing a runtime asset manifest in the client package, run
`npm run sync:runtime-assets --workspace @labyrinth/client` and commit the generated PNGs.

Sword fields use `src/assets/swordFieldRuntimeAssets.json` as both their typed asset
registry and their export manifest. Add new logical sprite names there; the client
typecheck rejects unregistered names, and the production build verifies that every
registered file was synced into this directory.
