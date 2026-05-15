import { randomUUID } from "node:crypto"
import { parse as parseYaml } from "yaml"
import { Value } from "typebox/value"
import { CoreYamlArgumentSchema } from "../lib/schemata/import.js"
import type { TCoreYamlArgument } from "../lib/schemata/import.js"
import type { TClaimBoundVariable } from "../lib/schemata/index.js"
import type { TExpressionInput } from "../lib/core/expression-manager.js"
import type { TFormulaAST } from "../lib/core/parser/formula.js"
import { parseFormula } from "../lib/core/parser/formula.js"
import { ArgumentEngine } from "../lib/core/argument-engine.js"
import { ClaimLibrary } from "../lib/core/claim-library.js"
import { ClaimCitationLibrary } from "../lib/core/claim-citation-library.js"
import { POSITION_INITIAL } from "../lib/utils/position.js"
import { CLI_AXIOM_REASON_CODES, type TCliAxiomReasonCode } from "./schemata.js"

/**
 * Validates that `implies` and `iff` nodes appear only at the AST root.
 * Throws if an implication/biconditional is nested inside another operator.
 */
function validateRootOnly(
    ast: TFormulaAST,
    isRoot: boolean,
    premiseIndex: number,
    premiseTitle: string | undefined
): void {
    if (!isRoot && (ast.type === "implies" || ast.type === "iff")) {
        const label = premiseTitle
            ? `premise "${premiseTitle}" (index ${premiseIndex})`
            : `premise at index ${premiseIndex}`
        throw new Error(
            `${ast.type === "implies" ? "Implication (\u2192)" : "Biconditional (\u2194)"} operator must be at the root of a formula, but found nested in ${label}.`
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
function collectVariableNames(ast: TFormulaAST, names: Set<string>): void {
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
    ast: TFormulaAST,
    parentId: string | null,
    position: number,
    argumentId: string,
    argumentVersion: number,
    premiseId: string,
    variablesByName: Map<string, Omit<TClaimBoundVariable, "checksum">>,
    addExpression: (expr: TExpressionInput) => void
): string {
    const id = randomUUID()

    switch (ast.type) {
        case "variable": {
            const variable = variablesByName.get(ast.name)!
            addExpression({
                id,
                argumentId,
                argumentVersion,
                premiseId,
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
                premiseId,
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
                premiseId,
                variablesByName,
                addExpression
            )
            return id
        }
        case "and":
        case "or": {
            // Non-not operators cannot be direct children of operators.
            // When this node has an operator parent, insert a formula wrapper.
            let effectiveParentId = parentId
            if (parentId !== null) {
                const formulaId = randomUUID()
                addExpression({
                    id: formulaId,
                    argumentId,
                    argumentVersion,
                    premiseId,
                    type: "formula",
                    parentId,
                    position,
                })
                effectiveParentId = formulaId
            }
            addExpression({
                id,
                argumentId,
                argumentVersion,
                premiseId,
                type: "operator",
                operator: ast.type,
                parentId: effectiveParentId,
                position: effectiveParentId !== parentId ? 0 : position,
            })
            for (let i = 0; i < ast.operands.length; i++) {
                buildExpressions(
                    ast.operands[i],
                    id,
                    i,
                    argumentId,
                    argumentVersion,
                    premiseId,
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
                premiseId,
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
                premiseId,
                variablesByName,
                addExpression
            )
            buildExpressions(
                ast.right,
                id,
                1,
                argumentId,
                argumentVersion,
                premiseId,
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
export function importArgumentFromYaml(yamlString: string): {
    engine: ArgumentEngine
    claimLibrary: ClaimLibrary
    claimCitationLibrary: ClaimCitationLibrary
} {
    const raw: unknown = parseYaml(yamlString)
    const input: TCoreYamlArgument = Value.Parse(CoreYamlArgumentSchema, raw)

    // CLI-layer enforcement: every axiomatic claim must declare a valid
    // `reasonCode`. Core itself stays permissive (consumer-extension territory),
    // but the CLI's convention is to require one of the codes published in
    // `CLI_AXIOM_REASON_CODES`.
    const inputClaims = input.claims ?? []
    for (const claim of inputClaims) {
        if (claim.type !== "axiomatic") continue
        const reasonCode = (claim as Record<string, unknown>).reasonCode
        if (
            typeof reasonCode !== "string" ||
            !CLI_AXIOM_REASON_CODES.includes(reasonCode as TCliAxiomReasonCode)
        ) {
            throw new Error(
                `Imported axiomatic claim "${claim.id ?? "?"}" is missing a valid 'reasonCode'. Valid codes: ${CLI_AXIOM_REASON_CODES.join(", ")}`
            )
        }
    }

    // Validate premise shapes before any parsing
    for (let i = 0; i < input.premises.length; i++) {
        const premise = input.premises[i]
        const isDerivation = premise.type === "derivation"
        const label = premise.metadata?.title
            ? `premise "${premise.metadata.title}" (index ${i})`
            : `premise at index ${i}`
        if (isDerivation) {
            if (!premise.derivedClaimId) {
                throw new Error(
                    `${label}: type "derivation" requires derivedClaimId.`
                )
            }
            if (premise.formula !== undefined) {
                throw new Error(
                    `${label}: type "derivation" must not include a formula field.`
                )
            }
        } else {
            if (premise.formula === undefined) {
                throw new Error(
                    `${label}: freeform premise requires a formula field.`
                )
            }
        }
    }

    // Parse formulas for freeform premises and validate root-only constraint
    const parsedFormulas: (TFormulaAST | null)[] = []
    for (let i = 0; i < input.premises.length; i++) {
        const premise = input.premises[i]
        if (premise.type === "derivation") {
            parsedFormulas.push(null)
            continue
        }
        let ast: TFormulaAST
        try {
            ast = parseFormula(premise.formula!)
        } catch (error) {
            const label = premise.metadata?.title
                ? `premise "${premise.metadata.title}" (index ${i})`
                : `premise at index ${i}`
            const msg = error instanceof Error ? error.message : String(error)
            throw new Error(`Failed to parse formula for ${label}: ${msg}`)
        }
        validateRootOnly(ast, true, i, premise.metadata?.title)
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

    // Collect all variable names across freeform formulas only
    const allVariableNames = new Set<string>()
    for (const ast of parsedFormulas) {
        if (ast !== null) collectVariableNames(ast, allVariableNames)
    }

    // Build the argument
    const argumentId = randomUUID()
    const argument = {
        id: argumentId,
        version: 0,
        title: input.metadata.title,
        ...(input.metadata.description !== undefined
            ? { description: input.metadata.description }
            : {}),
        createdAt: new Date(),
        published: false,
    }

    const claimLibrary = new ClaimLibrary()
    const defaultClaim = claimLibrary.create({
        id: randomUUID(),
        type: "normal",
    })

    // Register explicitly declared claims from the YAML `claims` block.
    // These must be registered before any derivation premise is created so that
    // the engine can resolve derivedClaimId via the claim library.
    for (const yamlClaim of input.claims ?? []) {
        const claimInput: Parameters<typeof claimLibrary.create>[0] = {
            id: yamlClaim.id,
            type: yamlClaim.type,
            ...(yamlClaim.title !== undefined
                ? { title: yamlClaim.title }
                : {}),
        }
        if (yamlClaim.type === "axiomatic") {
            const yamlExtras = yamlClaim as Record<string, unknown>
            if (typeof yamlExtras.reasonCode === "string") {
                ;(claimInput as Record<string, unknown>).reasonCode =
                    yamlExtras.reasonCode
            }
        }
        claimLibrary.create(claimInput)
    }

    const claimCitationLibrary = new ClaimCitationLibrary(claimLibrary)
    const engine = new ArgumentEngine(argument, claimLibrary)

    // Create variables for freeform formula symbols
    const variablesByName = new Map<
        string,
        Omit<TClaimBoundVariable, "checksum">
    >()
    for (const name of [...allVariableNames].sort()) {
        const variable: Omit<TClaimBoundVariable, "checksum"> = {
            id: randomUUID(),
            argumentId,
            argumentVersion: 0,
            symbol: name,
            claimId: defaultClaim.id,
            claimVersion: defaultClaim.version,
        }
        variablesByName.set(name, variable)
    }

    // Register all freeform variables with the engine (shared across all premises)
    for (const variable of variablesByName.values()) {
        engine.addVariable(variable)
    }

    // D2b — permissive-build + explicit normalize() pattern. The
    // per-premise tree-build below is incremental (one
    // `pm.addExpression` per AST node, parents first). Under the
    // post-mutation AN hook (assistive mode), AN-3 would eagerly
    // collapse 0-child operators between addExpression calls,
    // breaking the build. Switch to `permissive` for the duration of
    // the build, then restore assistive + run a single explicit
    // `engine.normalize()` at the end so AN-1 / AN-2 / AN-3 / AN-4
    // fire on the fully-built tree. The returned engine is in
    // canonical assistive state.
    const savedBehavior = engine.behavior
    engine.setBehavior("permissive")
    try {
        // Create premises and build expression trees
        for (let i = 0; i < input.premises.length; i++) {
            const premiseDef = input.premises[i]
            const isDerivation = premiseDef.type === "derivation"

            if (isDerivation) {
                // Derivation premise — delegate to the engine's derivation init flow,
                // which auto-creates the naked-Q root expression.
                const { result: dpm } = engine.createPremise({
                    type: "derivation",
                    derivedClaimId: premiseDef.derivedClaimId!,
                    ...(premiseDef.metadata ?? {}),
                })
                const dRole = premiseDef.role ?? "supporting"
                if (dRole === "conclusion") {
                    engine.setConclusionPremise(dpm.getId())
                }
            } else {
                // Freeform premise — create premise then build expression tree.
                const { result: pm } = premiseDef.metadata
                    ? engine.createPremise({ ...premiseDef.metadata })
                    : engine.createPremise()

                // Build expression tree from parsed AST
                buildExpressions(
                    parsedFormulas[i]!,
                    null,
                    POSITION_INITIAL,
                    argumentId,
                    0,
                    pm.getId(),
                    variablesByName,
                    (expr) => pm.addExpression(expr)
                )

                // Assign conclusion role; supporting is derived from expression type
                const role = premiseDef.role ?? "supporting"
                if (role === "conclusion") {
                    engine.setConclusionPremise(pm.getId())
                }
                // Non-conclusion inference premises are automatically supporting
            }
        }
    } finally {
        engine.setBehavior(savedBehavior)
        if (savedBehavior === "assistive") {
            engine.normalize()
        }
    }

    return { engine, claimLibrary, claimCitationLibrary }
}
