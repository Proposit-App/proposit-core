import { defineConfig } from "vitest/config"

export default defineConfig({
    test: {
        exclude: [".untracked/**", ".worktrees/**", "node_modules/**"],
    },
})
