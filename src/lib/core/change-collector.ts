import type { TCorePremise } from "../schemata/index.js"
import type {
    TCoreArgument,
    TCoreArgumentRoleState,
} from "../schemata/argument.js"
import type {
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../schemata/propositional.js"
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

export class ChangeCollector<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TArg extends TCoreArgument = TCoreArgument,
> {
    private expressions: TCoreEntityChanges<TExpr> = emptyEntityChanges()
    private variables: TCoreEntityChanges<TVar> = emptyEntityChanges()
    private premises: TCoreEntityChanges<TPremise> = emptyEntityChanges()
    private roles: TCoreArgumentRoleState | undefined = undefined
    private argument: TArg | undefined = undefined

    addedExpression(expr: TExpr): void {
        this.expressions.added.push(expr)
    }
    modifiedExpression(expr: TExpr): void {
        this.expressions.modified.push(expr)
    }
    removedExpression(expr: TExpr): void {
        this.expressions.removed.push(expr)
    }

    addedVariable(variable: TVar): void {
        this.variables.added.push(variable)
    }
    modifiedVariable(variable: TVar): void {
        this.variables.modified.push(variable)
    }
    removedVariable(variable: TVar): void {
        this.variables.removed.push(variable)
    }

    addedPremise(premise: TPremise): void {
        this.premises.added.push(premise)
    }
    removedPremise(premise: TPremise): void {
        this.premises.removed.push(premise)
    }

    setRoles(roles: TCoreArgumentRoleState): void {
        this.roles = roles
    }

    setArgument(argument: TArg): void {
        this.argument = argument
    }

    toChangeset(): TCoreChangeset<TExpr, TVar, TPremise, TArg> {
        const cs: TCoreChangeset<TExpr, TVar, TPremise, TArg> = {}
        if (!isEntityChangesEmpty(this.expressions))
            cs.expressions = this.expressions
        if (!isEntityChangesEmpty(this.variables)) cs.variables = this.variables
        if (!isEntityChangesEmpty(this.premises)) cs.premises = this.premises
        if (this.roles !== undefined) cs.roles = this.roles
        if (this.argument !== undefined) cs.argument = this.argument
        return cs
    }
}
