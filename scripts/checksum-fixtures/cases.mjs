// Builds a fixed set of arguments and records every checksum the engine
// computes for them. Used in two places: `capture.mjs` runs it against a
// published copy of the package to write a fixture file, and
// `test/core/checksum-stability.test.ts` runs it against the local source
// and compares the result with that file. Running the same builder in both
// places is what makes the comparison meaningful, so every step here goes
// through the package's public exports only, and only through API that the
// oldest captured version already had.
//
// Every id comes from a counting generator, so two runs of the same case
// produce the same ids and therefore the same checksums.

/** The configurations every scenario is run under. */
export const CONFIG_NAMES = ["default", "consumer", "partial"]

/** Scenarios built from the standard argument, which has an external binding. */
export const STANDARD_SCENARIOS = [
    "built",
    "snapshotRoundTrip",
    "fromData",
    "rolledBackMutation",
    "explicitRollback",
    "strictSnapshotReload",
    "strictDataReload",
    "setExtras",
    "forkWithoutExternalBinding",
]

/**
 * Scenarios that the oldest captured version cannot run. Forking an
 * argument that holds a binding into another argument threw before 5.4.3,
 * so this scenario has its own fixture captured from 5.4.3.
 */
export const FORK_EXTERNAL_SCENARIOS = ["forkWithExternalBinding"]

/**
 * Returns a generator of valid version-4 UUIDs counting up from 1:
 * `00000000-0000-4000-8000-000000000001`, `…002`, and so on.
 */
export function countingIdGenerator() {
    let next = 0
    return () => {
        next += 1
        return `00000000-0000-4000-8000-${next.toString(16).padStart(12, "0")}`
    }
}

function checksumConfigFor(lib, configName) {
    const defaults = lib.DEFAULT_CHECKSUM_CONFIG
    switch (configName) {
        case "default":
            return undefined
        case "consumer":
            return lib.createChecksumConfig({
                argumentFields: new Set(["title"]),
                variableFields: new Set(["createdOn"]),
                premiseFields: new Set(["label"]),
            })
        case "partial":
            // A configuration written by hand that names only some entity
            // kinds. The engine falls back to the defaults for the kinds it
            // leaves out — here the argument and variable field sets.
            return {
                expressionFields: new Set(defaults.expressionFields),
                premiseFields: new Set(defaults.premiseFields),
                roleFields: new Set(defaults.roleFields),
            }
        default:
            throw new Error(`Unknown checksum configuration "${configName}".`)
    }
}

/**
 * Builds the standard argument: a conclusion premise and supporting premises,
 * three claim-bound variables, a variable bound to a premise of this
 * argument, a variable bound to a premise of another argument (when
 * `withExternalBinding`), a variable expression marked as an enthymeme, and a
 * derivation premise populated from a citation.
 *
 * The consumer fields (`title`, `label`, `createdOn`) are present on the
 * entities under every configuration; only the consumer configuration hashes
 * them.
 */
function buildStandardArgument(lib, generateId, configName, options) {
    const { withExternalBinding } = options
    const claimLibrary = new lib.ClaimLibrary()
    const citationLibrary = new lib.ClaimCitationLibrary(claimLibrary)

    const claimRain = claimLibrary.create({ id: generateId(), type: "normal" })
    const claimWet = claimLibrary.create({ id: generateId(), type: "normal" })
    const claimCold = claimLibrary.create({ id: generateId(), type: "normal" })
    const claimDerived = claimLibrary.create({
        id: generateId(),
        type: "normal",
    })
    const claimSource = claimLibrary.create({
        id: generateId(),
        type: "citation",
    })
    citationLibrary.add({
        id: generateId(),
        claimId: claimDerived.id,
        claimVersion: claimDerived.version,
        supportingClaimId: claimSource.id,
        supportingClaimVersion: claimSource.version,
    })

    const argument = {
        id: generateId(),
        version: 1,
        title: "Whether the road is slippery",
    }
    const engine = new lib.ArgumentEngine(argument, claimLibrary, {
        behavior: "permissive",
        generateId,
        checksumConfig: checksumConfigFor(lib, configName),
    })
    const owned = { argumentId: argument.id, argumentVersion: argument.version }

    const addClaimVariable = (symbol, claim) => {
        const id = generateId()
        engine.addVariable({
            id,
            ...owned,
            symbol,
            claimId: claim.id,
            claimVersion: claim.version,
            createdOn: "2026-01-01",
        })
        return id
    }
    const varRain = addClaimVariable("Rain", claimRain)
    const varWet = addClaimVariable("Wet", claimWet)
    const varCold = addClaimVariable("Cold", claimCold)

    const variableExpression = (premiseId, variableId, extra = {}) => ({
        id: generateId(),
        ...owned,
        premiseId,
        type: "variable",
        variableId,
        ...extra,
    })
    const operatorExpression = (premiseId, operator) => ({
        id: generateId(),
        ...owned,
        premiseId,
        type: "operator",
        operator,
    })

    // The first premise created becomes the conclusion.
    const { result: conclusion } = engine.createPremise({
        type: "freeform",
        extras: { label: "conclusion" },
    })
    conclusion.appendExpression(
        null,
        variableExpression(conclusion.getId(), varWet)
    )

    // Supporting premise: Cold or not Rain. A variable elsewhere binds to it.
    const { result: weather } = engine.createPremise({
        type: "freeform",
        extras: { label: "weather" },
    })
    const weatherOr = operatorExpression(weather.getId(), "or")
    weather.appendExpression(null, weatherOr)
    weather.appendExpression(
        weatherOr.id,
        variableExpression(weather.getId(), varCold)
    )
    const weatherNot = operatorExpression(weather.getId(), "not")
    weather.appendExpression(weatherOr.id, weatherNot)
    weather.appendExpression(
        weatherNot.id,
        variableExpression(weather.getId(), varRain)
    )

    const varWeather = generateId()
    engine.bindVariableToPremise({
        id: varWeather,
        ...owned,
        symbol: "Weather",
        boundPremiseId: weather.getId(),
        boundArgumentId: argument.id,
        boundArgumentVersion: argument.version,
        createdOn: "2026-01-02",
    })

    let varElsewhere
    if (withExternalBinding) {
        varElsewhere = generateId()
        engine.bindVariableToExternalPremise({
            id: varElsewhere,
            ...owned,
            symbol: "Elsewhere",
            boundPremiseId: generateId(),
            boundArgumentId: generateId(),
            boundArgumentVersion: 3,
            createdOn: "2026-01-03",
        })
    }

    // Supporting premise: (Rain and Weather [and Elsewhere]) implies Wet,
    // with Rain marked as left unspoken in the original text.
    const { result: inference } = engine.createPremise({
        type: "freeform",
        extras: { label: "inference" },
    })
    const inferenceImplies = operatorExpression(inference.getId(), "implies")
    inference.appendExpression(null, inferenceImplies)
    const inferenceAnd = operatorExpression(inference.getId(), "and")
    inference.appendExpression(inferenceImplies.id, inferenceAnd)
    inference.appendExpression(
        inferenceAnd.id,
        variableExpression(inference.getId(), varRain, { enthymeme: true })
    )
    inference.appendExpression(
        inferenceAnd.id,
        variableExpression(inference.getId(), varWeather)
    )
    if (varElsewhere !== undefined) {
        inference.appendExpression(
            inferenceAnd.id,
            variableExpression(inference.getId(), varElsewhere)
        )
    }
    inference.appendExpression(
        inferenceImplies.id,
        variableExpression(inference.getId(), varWet)
    )

    // Derivation premise backed by a citation: source implies derived.
    engine.createPremise({
        type: "derivation",
        derivedClaimId: claimDerived.id,
    })
    const populated = engine.populateFromCitations(
        claimDerived.id,
        citationLibrary
    )
    if (populated.kind !== "populated") {
        throw new Error("The derivation premise was not populated.")
    }

    engine.setConclusionPremise(conclusion.getId())

    return { engine, claimLibrary, varRain, claimRain }
}

/** Every checksum the engine reports for an argument, keyed by entity id. */
export function recordChecksums(engine) {
    const argument = engine.getArgument()
    const byId = (entities, pick) => {
        const sorted = [...entities].sort((a, b) => a.id.localeCompare(b.id))
        return Object.fromEntries(sorted.map((e) => [e.id, pick(e)]))
    }
    const hierarchical = (e) => ({
        checksum: e.checksum,
        descendantChecksum: e.descendantChecksum,
        combinedChecksum: e.combinedChecksum,
    })
    return {
        argument: hierarchical(argument),
        roleState: { ...engine.getRoleState() },
        collections: {
            premises: engine.getCollectionChecksum("premises"),
            variables: engine.getCollectionChecksum("variables"),
        },
        premises: byId(
            engine.listPremises().map((pe) => pe.toPremiseData()),
            hierarchical
        ),
        expressions: byId(engine.getAllExpressions(), hierarchical),
        variables: byId(engine.getVariables(), (v) => v.checksum),
    }
}

function flatData(engine) {
    return {
        argument: engine.getArgument(),
        variables: engine.getVariables(),
        premises: engine.listPremises().map((pe) => pe.toPremiseData()),
        expressions: engine.getAllExpressions(),
        roles: engine.getRoleState(),
    }
}

/** A snapshot as a store would hand it back: through plain JSON. */
function storedSnapshot(engine) {
    return JSON.parse(JSON.stringify(engine.snapshot()))
}

function runScenario(lib, configName, scenario) {
    const generateId = countingIdGenerator()
    const withExternalBinding = scenario !== "forkWithoutExternalBinding"
    const built = buildStandardArgument(lib, generateId, configName, {
        withExternalBinding,
    })
    const { engine, claimLibrary } = built

    switch (scenario) {
        case "built":
            return recordChecksums(engine)

        case "snapshotRoundTrip":
            return recordChecksums(
                lib.ArgumentEngine.fromSnapshot(
                    storedSnapshot(engine),
                    claimLibrary,
                    undefined,
                    generateId
                )
            )

        case "strictSnapshotReload":
            return recordChecksums(
                lib.ArgumentEngine.fromSnapshot(
                    storedSnapshot(engine),
                    claimLibrary,
                    "strict",
                    generateId
                )
            )

        case "fromData":
        case "strictDataReload": {
            const data = flatData(engine)
            const config = JSON.parse(JSON.stringify(engine.snapshot().config))
            return recordChecksums(
                lib.ArgumentEngine.fromData(
                    data.argument,
                    claimLibrary,
                    data.variables,
                    data.premises,
                    data.expressions,
                    data.roles,
                    { ...config, generateId },
                    scenario === "strictDataReload" ? "strict" : undefined
                )
            )
        }

        case "rolledBackMutation": {
            // A duplicate symbol makes the mutation throw, and the engine
            // restores itself from the snapshot it took before the call.
            let threw = false
            try {
                engine.addVariable({
                    id: generateId(),
                    argumentId: engine.getArgument().id,
                    argumentVersion: engine.getArgument().version,
                    symbol: "Rain",
                    claimId: built.claimRain.id,
                    claimVersion: built.claimRain.version,
                })
            } catch {
                threw = true
            }
            if (!threw) {
                throw new Error("The duplicate-symbol mutation did not throw.")
            }
            return recordChecksums(engine)
        }

        case "explicitRollback": {
            const before = storedSnapshot(engine)
            const { result: extra } = engine.createPremise({
                type: "freeform",
                extras: { label: "discarded" },
            })
            extra.appendExpression(null, {
                id: generateId(),
                argumentId: engine.getArgument().id,
                argumentVersion: engine.getArgument().version,
                premiseId: extra.getId(),
                type: "variable",
                variableId: built.varRain,
            })
            engine.rollback(before)
            return recordChecksums(engine)
        }

        case "setExtras":
            engine.setExtras({
                title: "Whether the road is icy",
                summary: "Added after creation",
            })
            return recordChecksums(engine)

        case "forkWithoutExternalBinding":
        case "forkWithExternalBinding": {
            const { engine: forked } = lib.forkArgumentEngine(
                engine,
                generateId(),
                { claimLibrary },
                { generateId }
            )
            return recordChecksums(forked)
        }

        default:
            throw new Error(`Unknown scenario "${scenario}".`)
    }
}

/**
 * Runs every scenario in `scenarios` under every configuration and returns
 * the recorded checksums keyed `"<configuration>/<scenario>"`.
 *
 * `lib` is the package's main module: either the local source or a
 * published build.
 */
export function buildChecksumCases(lib, scenarios) {
    const cases = {}
    for (const configName of CONFIG_NAMES) {
        for (const scenario of scenarios) {
            cases[`${configName}/${scenario}`] = runScenario(
                lib,
                configName,
                scenario
            )
        }
    }
    return cases
}
