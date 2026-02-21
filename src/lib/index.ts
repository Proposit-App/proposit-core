import type {
    TArgument,
    TLogicalOperatorType,
    TPropositionalExpression,
    TPropositionalVariable,
} from "./schemata"
import { DefaultMap } from "./utils"

function getOrCreate<K, V>(map: Map<K, V>, key: K, mkDefault: () => V): V {
    const existing = map.get(key)
    if (existing !== undefined) {
        return existing
    }

    const value = mkDefault()
    map.set(key, value)
    return value
}

interface IVariableManager {
    addVariable(variable: TPropositionalVariable): void
    removeVariable(variableId: string): TPropositionalVariable | undefined
}

class VariableManager implements IVariableManager {
    private variables: Map<string, TPropositionalVariable>
    private variableSymbols: Set<string>

    constructor(initialVariables: TPropositionalVariable[] = []) {
        this.variables = new Map()
        this.variableSymbols = new Set()

        for (const variable of initialVariables) {
            this.addVariable(variable)
        }
    }

    public toArray(): TPropositionalVariable[] {
        return Array.from(this.variables.values())
    }

    public addVariable(variable: TPropositionalVariable) {
        if (this.variableSymbols.has(variable.symbol)) {
            throw new Error(
                `Variable symbol "${variable.symbol}" already exists.`
            )
        }
        if (this.variables.has(variable.id)) {
            throw new Error(`Variable with ID "${variable.id}" already exists.`)
        }

        this.variables.set(variable.id, variable)
        this.variableSymbols.add(variable.symbol)
    }

    public removeVariable(variableId: string) {
        const variable = this.variables.get(variableId)
        if (!variable) {
            return undefined
        }

        this.variables.delete(variableId)
        this.variableSymbols.delete(variable.symbol)
        return variable
    }

    public hasVariable(variableId: string): boolean {
        return this.variables.has(variableId)
    }

    public getVariable(variableId: string): TPropositionalVariable | undefined {
        return this.variables.get(variableId)
    }
}

interface IExpressionManager {
    addExpression(expression: TPropositionalExpression): void
    removeExpression(expressionId: string): TPropositionalExpression | undefined
}

class ExpressionManager implements IExpressionManager {
    private expressions: Map<string, TPropositionalExpression>
    private childExpressionIdsByParentId: Map<string | null, Set<string>>
    private childPositionsByParentId: Map<string | null, Set<number>>

    constructor(initialExpressions: TPropositionalExpression[] = []) {
        this.expressions = new Map()
        this.childExpressionIdsByParentId = new Map()
        this.childPositionsByParentId = new Map()

        this.loadInitialExpressions(initialExpressions)
    }

    public toArray(): TPropositionalExpression[] {
        return Array.from(this.expressions.values())
    }

    public addExpression(expression: TPropositionalExpression) {
        if (this.expressions.has(expression.id)) {
            throw new Error(
                `Expression with ID "${expression.id}" already exists.`
            )
        }
        if (expression.parentId === expression.id) {
            throw new Error(
                `Expression "${expression.id}" cannot be its own parent.`
            )
        }

        if (expression.parentId !== null) {
            const parent = this.expressions.get(expression.parentId)
            if (!parent) {
                throw new Error(
                    `Parent expression "${expression.parentId}" does not exist.`
                )
            }
            if (parent.type !== "operator") {
                throw new Error(
                    `Parent expression "${expression.parentId}" is not an operator expression.`
                )
            }

            this.assertChildLimit(parent.operator, expression.parentId)
        }

        if (expression.position !== null) {
            const positions = getOrCreate(
                this.childPositionsByParentId,
                expression.parentId,
                () => new Set()
            )
            if (positions.has(expression.position)) {
                throw new Error(
                    `Position ${expression.position} is already used under parent "${expression.parentId}".`
                )
            }
            positions.add(expression.position)
        }

        this.expressions.set(expression.id, expression)
        getOrCreate(
            this.childExpressionIdsByParentId,
            expression.parentId,
            () => new Set()
        ).add(expression.id)
    }

    public removeExpression(expressionId: string) {
        const rootExpression = this.expressions.get(expressionId)
        if (!rootExpression) {
            return undefined
        }

        const toRemove = new Set<string>()
        const stack = [expressionId]
        while (stack.length > 0) {
            const currentId = stack.pop()
            if (!currentId || toRemove.has(currentId)) {
                continue
            }

            toRemove.add(currentId)
            const children = this.childExpressionIdsByParentId.get(currentId)
            if (!children) {
                continue
            }
            for (const childId of children) {
                stack.push(childId)
            }
        }

        for (const id of toRemove) {
            const expression = this.expressions.get(id)
            if (!expression) {
                continue
            }

            this.expressions.delete(id)
            this.childExpressionIdsByParentId
                .get(expression.parentId)
                ?.delete(id)

            if (expression.position !== null) {
                this.childPositionsByParentId
                    .get(expression.parentId)
                    ?.delete(expression.position)
            }

            this.childExpressionIdsByParentId.delete(id)
            this.childPositionsByParentId.delete(id)
        }

        return rootExpression
    }

    public hasVariableReference(variableId: string): boolean {
        for (const expression of this.expressions.values()) {
            if (
                expression.type === "variable" &&
                expression.variableId === variableId
            ) {
                return true
            }
        }
        return false
    }

    public getExpression(
        expressionId: string
    ): TPropositionalExpression | undefined {
        return this.expressions.get(expressionId)
    }

    public getChildExpressions(
        parentId: string | null
    ): TPropositionalExpression[] {
        const childIds = this.childExpressionIdsByParentId.get(parentId)
        if (!childIds || childIds.size === 0) {
            return []
        }

        const children: TPropositionalExpression[] = []
        for (const childId of childIds) {
            const child = this.expressions.get(childId)
            if (child) {
                children.push(child)
            }
        }

        return children.sort((a, b) => {
            if (a.position === null && b.position === null) {
                return a.id.localeCompare(b.id)
            }
            if (a.position === null) {
                return 1
            }
            if (b.position === null) {
                return -1
            }
            return a.position - b.position
        })
    }

    private loadInitialExpressions(
        initialExpressions: TPropositionalExpression[]
    ) {
        if (initialExpressions.length === 0) {
            return
        }

        const pending = new Map<string, TPropositionalExpression>(
            initialExpressions.map((expression) => [expression.id, expression])
        )

        let progressed = true
        while (pending.size > 0 && progressed) {
            progressed = false

            for (const [id, expression] of Array.from(pending.entries())) {
                if (
                    expression.parentId !== null &&
                    !this.expressions.has(expression.parentId)
                ) {
                    continue
                }

                this.addExpression(expression)
                pending.delete(id)
                progressed = true
            }
        }

        if (pending.size > 0) {
            const unresolved = Array.from(pending.keys()).join(", ")
            throw new Error(
                `Could not resolve parent relationships for expressions: ${unresolved}.`
            )
        }
    }

    private assertChildLimit(
        operator: TLogicalOperatorType,
        parentExpressionId: string
    ): void {
        const childCount =
            this.childExpressionIdsByParentId.get(parentExpressionId)?.size ?? 0

        if (operator === "not" && childCount >= 1) {
            throw new Error(
                `Operator expression "${parentExpressionId}" with "not" can only have one child.`
            )
        }
        if ((operator === "implies" || operator === "iff") && childCount >= 2) {
            throw new Error(
                `Operator expression "${parentExpressionId}" with "${operator}" can only have two children.`
            )
        }
    }
}

export class ArgumentEngine implements IVariableManager, IExpressionManager {
    private argument: TArgument
    private variables: VariableManager
    private expressions: ExpressionManager

    private expressionsByVariableId: DefaultMap<string, Set<string>>

    constructor(
        argument: TArgument,
        variables: TPropositionalVariable[] = [],
        expressions: TPropositionalExpression[] = []
    ) {
        this.argument = { ...argument }

        for (const variable of variables) {
            this.assertBelongsToArgument(
                variable.argumentId,
                variable.argumentVersion
            )
        }
        for (const expression of expressions) {
            this.assertBelongsToArgument(
                expression.argumentId,
                expression.argumentVersion
            )
        }

        this.variables = new VariableManager(variables)
        this.expressions = new ExpressionManager(expressions)
        this.expressionsByVariableId = new DefaultMap(() => new Set())

        for (const expression of expressions) {
            if (
                expression.type === "variable" &&
                !this.variables.hasVariable(expression.variableId)
            ) {
                throw new Error(
                    `Variable expression "${expression.id}" references non-existent variable "${expression.variableId}".`
                )
            }
        }
    }

    public getArgument(): TArgument {
        return this.argument
    }

    public addVariable(variable: TPropositionalVariable) {
        this.assertBelongsToArgument(
            variable.argumentId,
            variable.argumentVersion
        )
        this.variables.addVariable(variable)
    }

    public removeVariable(variableId: string) {
        if (this.expressions.hasVariableReference(variableId)) {
            throw new Error(
                `Variable "${variableId}" cannot be removed because it is referenced by one or more expressions.`
            )
        }
        return this.variables.removeVariable(variableId)
    }

    public addExpression(expression: TPropositionalExpression) {
        this.assertBelongsToArgument(
            expression.argumentId,
            expression.argumentVersion
        )
        if (
            expression.type === "variable" &&
            !this.variables.hasVariable(expression.variableId)
        ) {
            throw new Error(
                `Variable expression "${expression.id}" references non-existent variable "${expression.variableId}".`
            )
        }
        this.expressions.addExpression(expression)
        if (expression.type === "variable") {
            this.expressionsByVariableId
                .get(expression.variableId)
                .add(expression.id)
        }
    }

    public removeExpression(expressionId: string) {
        const expr = this.expressions.removeExpression(expressionId)
        if (expr?.type === "variable") {
            this.expressionsByVariableId
                .get(expr.variableId)
                ?.delete(expressionId)
        }
        return expr
    }

    public toDisplayString(): string {
        const premises = this.expressions.getChildExpressions(null)
        return premises
            .map((premise) => this.toDisplayStringForExpression(premise.id))
            .join("\n")
    }

    private toDisplayStringForExpression(expressionId: string): string {
        const expression = this.expressions.getExpression(expressionId)
        if (!expression) {
            throw new Error(`Expression "${expressionId}" was not found.`)
        }

        if (expression.type === "variable") {
            const variable = this.variables.getVariable(expression.variableId)
            if (!variable) {
                throw new Error(
                    `Variable "${expression.variableId}" for expression "${expressionId}" was not found.`
                )
            }
            return variable.symbol
        }

        const children = this.expressions.getChildExpressions(expression.id)
        if (expression.operator === "not") {
            if (children.length === 0) {
                return `${this.toDisplayOperator(expression.operator)} (?)`
            }
            return `${this.toDisplayOperator(expression.operator)}(${this.toDisplayStringForExpression(children[0].id)})`
        }

        if (children.length === 0) {
            return "(?)"
        }

        const renderedChildren = children.map((child) =>
            this.toDisplayStringForExpression(child.id)
        )

        const operatorSymbol = this.toDisplayOperator(expression.operator)
        return `(${renderedChildren.join(` ${operatorSymbol} `)})`
    }

    private toDisplayOperator(operator: TLogicalOperatorType): string {
        switch (operator) {
            case "and":
                return "∧"
            case "or":
                return "∨"
            case "implies":
                return "→"
            case "iff":
                return "↔"
            case "not":
                return "¬"
        }
    }

    private assertBelongsToArgument(
        argumentId: string,
        argumentVersion: number
    ) {
        if (argumentId !== this.argument.id) {
            throw new Error(
                `Entity argumentId "${argumentId}" does not match engine argument ID "${this.argument.id}".`
            )
        }
        if (argumentVersion !== this.argument.version) {
            throw new Error(
                `Entity argumentVersion "${argumentVersion}" does not match engine argument version "${this.argument.version}".`
            )
        }
    }
}
