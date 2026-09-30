// Runs an incremental expression-tree build with auto-normalization
// switched off, then normalizes the finished tree once. Internal to the
// library; not exported from the package.

import type { ArgumentEngine } from "../core/argument-engine.js"

type TBehaviorSwitchableEngine = Pick<
    ArgumentEngine,
    "behavior" | "setBehavior" | "normalize"
>

/**
 * Run `build` with the engine's auto-normalization disabled, then
 * normalize the finished tree once.
 *
 * An incremental tree build passes through states where an operator has
 * no children yet. In `assistive` mode the post-mutation
 * auto-normalization hook would delete such an operator (AN-3) between
 * two `addExpression` calls, and the next call adding a child to it would
 * fail. So when the engine starts out `assistive`, it is switched to
 * `permissive` for the build. After the build succeeds, the behavior is
 * restored and a single `engine.normalize()` runs over the finished tree.
 * An engine that starts out `permissive` is neither switched nor
 * normalized: its caller wants the tree exactly as built.
 *
 * `normalize()` runs only after a successful build, never after a
 * failed one, so it cannot act on a half-built tree and hide the
 * original error. If the build (or the normalize pass) throws, the
 * behavior is still restored before the error is rethrown. The build is
 * not undone: the caller sees whatever partial state it left.
 */
export function buildWithoutAutoNormalization(
    engine: TBehaviorSwitchableEngine,
    build: () => void
): void {
    const savedBehavior = engine.behavior
    if (savedBehavior === "assistive") {
        engine.setBehavior("permissive")
    }
    try {
        build()
        if (savedBehavior === "assistive") {
            engine.setBehavior(savedBehavior)
            engine.normalize()
        }
    } catch (e) {
        if (savedBehavior === "assistive") {
            engine.setBehavior(savedBehavior)
        }
        throw e
    }
}
