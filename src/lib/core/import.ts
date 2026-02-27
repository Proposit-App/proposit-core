import { randomUUID } from "node:crypto"
import yaml from "js-yaml"
import { Value } from "typebox/value"
import { CoreYamlArgumentSchema } from "../schemata/import.js"
import type { TCoreYamlArgument } from "../schemata/import.js"
import type {
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../schemata/index.js"
import type { FormulaAST } from "./parser/formula.js"
import { parseFormula } from "./parser/formula.js"
import { ArgumentEngine } from "./ArgumentEngine.js"

/**
 * Validates that `implies` and `iff` nodes appear only at the AST root.
 * Throws if an implication/biconditional is nested inside another operator.
 */
function validateRootOnly(
    ast: FormulaAST,
    isRoot: boolean,
    premiseIndex: number,
    premiseTitle: string | undefined
): void {
    if (!isRoot && (ast.type === "implies" || ast.type === "iff")) {
        const label = premiseTitle
            ? `premise "${premiseTitle}" (index ${premiseIndex})`
            : `premise at index ${premiseIndex}`
        throw new Error(
            `${ast.type === "implies" ? "Implication (→)" : "Biconditional (↔)"} operator must be at the root of a formula, but found nested in ${label}.`
        )
    }
    switch (ast.type) {
        case "variable":
            break
        case "not":
            validateRootOnly(ast.operand, false, premiseIndex, premiseTitle)
            break
        case "and":
        case "or":
            for (const operand of ast.operands) {
                validateRootOnly(operand, false, premiseIndex, premiseTitle)
            }
            break
        case "implies":
        case "iff":
            validateRootOnly(ast.left, false, premiseIndex, premiseTitle)
            validateRootOnly(ast.right, false, premiseIndex, premiseTitle)
            break
    }
}

/** Recursively collects all variable names from a formula AST. */
function collectVariableNames(ast: FormulaAST, names: Set<string>): void {
    switch (ast.type) {
        case "variable":
            names.add(ast.name)
            break
        case "not":
            collectVariableNames(ast.operand, names)
            break
        case "and":
        case "or":
            for (const operand of ast.operands) {
                collectVariableNames(operand, names)
            }
            break
        case "implies":
        case "iff":
            collectVariableNames(ast.left, names)
            collectVariableNames(ast.right, names)
            break
    }
}

/**
 * Converts a formula AST into internal expression objects and adds them
 * to the premise manager. Returns the root expression ID.
 */
function buildExpressions(
    ast: FormulaAST,
    parentId: string | null,
    position: number | null,
    argumentId: string,
    argumentVersion: number,
    variablesByName: Map<string, TCorePropositionalVariable>,
    addExpression: (expr: TCorePropositionalExpression) => void
): string {
    const id = randomUUID()

    switch (ast.type) {
        case "variable": {
            const variable = variablesByName.get(ast.name)!
            addExpression({
                id,
                argumentId,
                argumentVersion,
                type: "variable",
                variableId: variable.id,
                parentId,
                position,
            })
            return id
        }
        case "not": {
            addExpression({
                id,
                argumentId,
                argumentVersion,
                type: "operator",
                operator: "not",
                parentId,
                position,
            })
            buildExpressions(
                ast.operand,
                id,
                0,
                argumentId,
                argumentVersion,
                variablesByName,
                addExpression
            )
            return id
        }
        case "and":
        case "or": {
            addExpression({
                id,
                argumentId,
                argumentVersion,
                type: "operator",
                operator: ast.type,
                parentId,
                position,
            })
            for (let i = 0; i < ast.operands.length; i++) {
                buildExpressions(
                    ast.operands[i],
                    id,
                    i,
                    argumentId,
                    argumentVersion,
                    variablesByName,
                    addExpression
                )
            }
            return id
        }
        case "implies":
        case "iff": {
            addExpression({
                id,
                argumentId,
                argumentVersion,
                type: "operator",
                operator: ast.type,
                parentId,
                position,
            })
            buildExpressions(
                ast.left,
                id,
                0,
                argumentId,
                argumentVersion,
                variablesByName,
                addExpression
            )
            buildExpressions(
                ast.right,
                id,
                1,
                argumentId,
                argumentVersion,
                variablesByName,
                addExpression
            )
            return id
        }
    }
}

/**
 * Parses a YAML string representing a logical argument and returns a
 * fully hydrated ArgumentEngine.
 *
 * Variables are implicitly declared by their usage in formula strings.
 * Premises without an explicit `role` default to `"supporting"`.
 * At most one premise may have `role: "conclusion"`.
 *
 * @throws On YAML parse errors, schema validation failures, formula
 *   parse errors, nested implies/iff operators, or multiple conclusions.
 */
export function importArgumentFromYaml(yamlString: string): ArgumentEngine {
    const raw = yaml.load(yamlString)
    const input: TCoreYamlArgument = Value.Parse(
        CoreYamlArgumentSchema,
        raw
    )

    // Parse all formulas and validate root-only constraint
    const parsedFormulas: FormulaAST[] = []
    for (let i = 0; i < input.premises.length; i++) {
        const premise = input.premises[i]
        let ast: FormulaAST
        try {
            ast = parseFormula(premise.formula)
        } catch (error) {
            const label = premise.title
                ? `premise "${premise.title}" (index ${i})`
                : `premise at index ${i}`
            const msg =
                error instanceof Error ? error.message : String(error)
            throw new Error(
                `Failed to parse formula for ${label}: ${msg}`
            )
        }
        validateRootOnly(ast, true, i, premise.title)
        parsedFormulas.push(ast)
    }

    // Validate conclusion count
    const conclusionIndices = input.premises
        .map((p, i) => (p.role === "conclusion" ? i : -1))
        .filter((i) => i !== -1)
    if (conclusionIndices.length > 1) {
        throw new Error(
            `Multiple premises designated as conclusion (indices ${conclusionIndices.join(", ")}). Only one conclusion is allowed.`
        )
    }

    // Collect all variable names across all formulas
    const allVariableNames = new Set<string>()
    for (const ast of parsedFormulas) {
        collectVariableNames(ast, allVariableNames)
    }

    // Build the argument
    const argumentId = randomUUID()
    const argument = {
        id: argumentId,
        version: 0,
        title: input.title,
        description: input.description ?? "",
        createdAt: Date.now(),
        published: false,
    }

    const engine = new ArgumentEngine(argument)

    // Create variables
    const variablesByName = new Map<string, TCorePropositionalVariable>()
    for (const name of [...allVariableNames].sort()) {
        const variable: TCorePropositionalVariable = {
            id: randomUUID(),
            argumentId,
            argumentVersion: 0,
            symbol: name,
        }
        variablesByName.set(name, variable)
    }

    // Create premises and build expression trees
    for (let i = 0; i < input.premises.length; i++) {
        const premiseDef = input.premises[i]
        const pm = engine.createPremise(premiseDef.title)

        // Register all variables with this premise
        for (const variable of variablesByName.values()) {
            pm.addVariable(variable)
        }

        // Build expression tree from parsed AST
        buildExpressions(
            parsedFormulas[i],
            null,
            null,
            argumentId,
            0,
            variablesByName,
            (expr) => pm.addExpression(expr)
        )

        // Assign role
        const role = premiseDef.role ?? "supporting"
        if (role === "conclusion") {
            engine.setConclusionPremise(pm.getId())
        } else {
            engine.addSupportingPremise(pm.getId())
        }
    }

    return engine
}
