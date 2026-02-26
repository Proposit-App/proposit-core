import type {
    TCoreArgumentDiff,
    TCoreEntitySetDiff,
    TCoreFieldChange,
    TCorePremiseDiff,
} from "../../lib/types/diff.js"
import { printLine } from "../output.js"

export function isDiffEmpty(diff: TCoreArgumentDiff): boolean {
    return (
        diff.argument.changes.length === 0 &&
        diff.variables.added.length === 0 &&
        diff.variables.removed.length === 0 &&
        diff.variables.modified.length === 0 &&
        diff.premises.added.length === 0 &&
        diff.premises.removed.length === 0 &&
        diff.premises.modified.length === 0 &&
        diff.roles.conclusion.before === diff.roles.conclusion.after &&
        diff.roles.supportingAdded.length === 0 &&
        diff.roles.supportingRemoved.length === 0
    )
}

function formatValue(value: unknown): string {
    if (value === undefined) return "undefined"
    if (value === null) return "null"
    return JSON.stringify(value)
}

function renderFieldChanges(changes: TCoreFieldChange[], indent: string): void {
    for (const change of changes) {
        printLine(
            `${indent}${change.field}: ${formatValue(change.before)} → ${formatValue(change.after)}`
        )
    }
}

function renderEntitySetDiff<T extends { id: string }>(
    diff: TCoreEntitySetDiff<T>,
    indent: string
): void {
    for (const item of diff.added) {
        printLine(`${indent}+ ${item.id} (added)`)
    }
    for (const item of diff.removed) {
        printLine(`${indent}- ${item.id} (removed)`)
    }
    for (const mod of diff.modified) {
        printLine(`${indent}~ ${mod.before.id}:`)
        renderFieldChanges(mod.changes, indent + "  ")
    }
}

function renderPremiseModified(mod: TCorePremiseDiff, indent: string): void {
    printLine(`${indent}~ ${mod.before.id}:`)
    renderFieldChanges(mod.changes, indent + "  ")
    const exprDiff = mod.expressions
    const hasExprChanges =
        exprDiff.added.length > 0 ||
        exprDiff.removed.length > 0 ||
        exprDiff.modified.length > 0
    if (hasExprChanges) {
        printLine(`${indent}  Expressions:`)
        renderEntitySetDiff(exprDiff, indent + "    ")
    }
}

export function renderDiff(diff: TCoreArgumentDiff): void {
    if (isDiffEmpty(diff)) {
        printLine("No differences.")
        return
    }

    // Argument section
    if (diff.argument.changes.length > 0) {
        printLine("Argument:")
        renderFieldChanges(diff.argument.changes, "  ")
    }

    // Variables section
    const hasVarChanges =
        diff.variables.added.length > 0 ||
        diff.variables.removed.length > 0 ||
        diff.variables.modified.length > 0
    if (hasVarChanges) {
        printLine("Variables:")
        renderEntitySetDiff(diff.variables, "  ")
    }

    // Premises section
    const hasPremiseChanges =
        diff.premises.added.length > 0 ||
        diff.premises.removed.length > 0 ||
        diff.premises.modified.length > 0
    if (hasPremiseChanges) {
        printLine("Premises:")
        for (const item of diff.premises.added) {
            printLine(`  + ${item.id} (added)`)
        }
        for (const item of diff.premises.removed) {
            printLine(`  - ${item.id} (removed)`)
        }
        for (const mod of diff.premises.modified) {
            renderPremiseModified(mod, "  ")
        }
    }

    // Roles section
    const conclusionChanged =
        diff.roles.conclusion.before !== diff.roles.conclusion.after
    const hasRoleChanges =
        conclusionChanged ||
        diff.roles.supportingAdded.length > 0 ||
        diff.roles.supportingRemoved.length > 0
    if (hasRoleChanges) {
        printLine("Roles:")
        if (conclusionChanged) {
            printLine(
                `  conclusion: ${formatValue(diff.roles.conclusion.before)} → ${formatValue(diff.roles.conclusion.after)}`
            )
        }
        for (const id of diff.roles.supportingAdded) {
            printLine(`  + support: ${id} (added)`)
        }
        for (const id of diff.roles.supportingRemoved) {
            printLine(`  - support: ${id} (removed)`)
        }
    }
}
