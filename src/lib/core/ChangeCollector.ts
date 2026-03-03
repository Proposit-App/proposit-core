import type {
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCorePremise,
} from "../schemata/index.js"
import type {
    TCoreArgument,
    TCoreArgumentRoleState,
} from "../schemata/argument.js"
import type { TCoreEntityChanges, TCoreChangeset } from "../types/mutation.js"

function emptyEntityChanges<T>(): TCoreEntityChanges<T> {
    return { added: [], modified: [], removed: [] }
}

function isEntityChangesEmpty<T>(ec: TCoreEntityChanges<T>): boolean {
    return (
        ec.added.length === 0 &&
        ec.modified.length === 0 &&
        ec.removed.length === 0
    )
}

/**
 * Internal collector used during a single mutation to accumulate all
 * side-effect changes. Created at the start of a public mutating method,
 * populated by internal helpers, and consumed via toChangeset().
 */
export class ChangeCollector {
    private expressions: TCoreEntityChanges<TCorePropositionalExpression> =
        emptyEntityChanges()
    private variables: TCoreEntityChanges<TCorePropositionalVariable> =
        emptyEntityChanges()
    private premises: TCoreEntityChanges<TCorePremise> = emptyEntityChanges()
    private roles: TCoreArgumentRoleState | undefined = undefined
    private argument: TCoreArgument | undefined = undefined

    addedExpression(expr: TCorePropositionalExpression): void {
        this.expressions.added.push(expr)
    }
    modifiedExpression(expr: TCorePropositionalExpression): void {
        this.expressions.modified.push(expr)
    }
    removedExpression(expr: TCorePropositionalExpression): void {
        this.expressions.removed.push(expr)
    }

    addedVariable(variable: TCorePropositionalVariable): void {
        this.variables.added.push(variable)
    }
    removedVariable(variable: TCorePropositionalVariable): void {
        this.variables.removed.push(variable)
    }

    addedPremise(premise: TCorePremise): void {
        this.premises.added.push(premise)
    }
    removedPremise(premise: TCorePremise): void {
        this.premises.removed.push(premise)
    }

    setRoles(roles: TCoreArgumentRoleState): void {
        this.roles = roles
    }

    setArgument(argument: TCoreArgument): void {
        this.argument = argument
    }

    toChangeset(): TCoreChangeset {
        const cs: TCoreChangeset = {}
        if (!isEntityChangesEmpty(this.expressions))
            cs.expressions = this.expressions
        if (!isEntityChangesEmpty(this.variables))
            cs.variables = this.variables
        if (!isEntityChangesEmpty(this.premises)) cs.premises = this.premises
        if (this.roles !== undefined) cs.roles = this.roles
        if (this.argument !== undefined) cs.argument = this.argument
        return cs
    }
}
