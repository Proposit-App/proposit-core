import type { TCorePremise } from "../schemata/index.js"
import type {
    TCoreArgument,
    TCoreArgumentRoleState,
} from "../schemata/argument.js"
import type {
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../schemata/propositional.js"
import type { TCoreChangeset } from "../types/mutation.js"
import {
    entityChangesFrom,
    recordEntityChange,
    type TEntityChangeState,
} from "../utils/changeset.js"

export class ChangeCollector<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TArg extends TCoreArgument = TCoreArgument,
> {
    // One entry per entity, so a changeset never names an id twice: see
    // `recordEntityChange` for how successive changes to one entity combine.
    private expressions: TEntityChangeState<TExpr> = new Map()
    private variables: TEntityChangeState<TVar> = new Map()
    private premises: TEntityChangeState<TPremise> = new Map()
    private roles: TCoreArgumentRoleState | undefined = undefined
    private argument: TArg | undefined = undefined

    addedExpression(expr: TExpr): void {
        recordEntityChange(this.expressions, "added", expr)
    }
    modifiedExpression(expr: TExpr): void {
        recordEntityChange(this.expressions, "modified", expr)
    }
    removedExpression(expr: TExpr): void {
        recordEntityChange(this.expressions, "removed", expr)
    }

    isExpressionAdded(id: string): boolean {
        return this.expressions.get(id)?.bucket === "added"
    }

    addedVariable(variable: TVar): void {
        recordEntityChange(this.variables, "added", variable)
    }
    modifiedVariable(variable: TVar): void {
        recordEntityChange(this.variables, "modified", variable)
    }
    removedVariable(variable: TVar): void {
        recordEntityChange(this.variables, "removed", variable)
    }

    addedPremise(premise: TPremise): void {
        recordEntityChange(this.premises, "added", premise)
    }
    modifiedPremise(premise: TPremise): void {
        recordEntityChange(this.premises, "modified", premise)
    }
    removedPremise(premise: TPremise): void {
        recordEntityChange(this.premises, "removed", premise)
    }

    setRoles(roles: TCoreArgumentRoleState): void {
        this.roles = roles
    }

    setArgument(argument: TArg): void {
        this.argument = argument
    }

    toChangeset(): TCoreChangeset<TExpr, TVar, TPremise, TArg> {
        const cs: TCoreChangeset<TExpr, TVar, TPremise, TArg> = {}
        const expressions = entityChangesFrom(this.expressions)
        if (expressions) cs.expressions = expressions
        const variables = entityChangesFrom(this.variables)
        if (variables) cs.variables = variables
        const premises = entityChangesFrom(this.premises)
        if (premises) cs.premises = premises
        if (this.roles !== undefined) cs.roles = this.roles
        if (this.argument !== undefined) cs.argument = this.argument
        return cs
    }
}
