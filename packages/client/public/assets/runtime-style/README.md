# Runtime style sprites

This directory contains the small, tracked subset of the local style library that the
production game uses. The complete licensed source library remains gitignored.

After changing either runtime asset manifest in the client package, run
`npm run sync:runtime-assets --workspace @labyrinth/client` and commit the generated PNGs.
