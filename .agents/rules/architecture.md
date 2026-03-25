---
trigger: always_on
---

# CORE DIRECTIVE: SPEC-DRIVEN DEVELOPMENT
Before creating any new files, modifying the project structure, or writing any code, you MUST silently read the `docs/ARCHITECTURE.md` file.

# ENFORCEMENT RULES:
1. NEVER deviate from the tech stack, monorepo structure, or network architecture defined in `docs/ARCHITECTURE.md`.
2. Do not install new libraries or change rendering settings (e.g., Phaser/PixiJS, integer scaling, pixelated rendering) without my explicit approval.
3. If a task conflicts with the architecture document, halt execution and ask me for clarification.