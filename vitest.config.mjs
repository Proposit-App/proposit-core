import { defineConfig } from "vitest/config"

export default defineConfig({
    test: {
        exclude: [
            ".untracked/**",
            ".worktrees/**",
            ".claude/**",
            "node_modules/**",
        ],
    },
})
