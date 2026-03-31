import type { TInvariantViolation } from "../types/validation.js"

/**
 * Thrown when a mutation would leave the system in an invalid state.
 * Carries the full list of {@link TInvariantViolation} entries that were detected.
 */
export class InvariantViolationError extends Error {
    public readonly violations: TInvariantViolation[]

    constructor(violations: TInvariantViolation[]) {
        const summary =
            violations.length === 1
                ? violations[0].message
                : `${violations.length} invariant violations detected`
        super(summary)
        this.name = "InvariantViolationError"
        this.violations = violations
    }
}
