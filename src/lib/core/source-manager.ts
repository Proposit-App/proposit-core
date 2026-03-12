import type {
    TCoreSource,
    TCoreVariableSourceAssociation,
    TCoreExpressionSourceAssociation,
} from "../schemata/index.js"

export interface TSourceRemovalResult<
    TSource extends TCoreSource = TCoreSource,
> {
    removedVariableAssociations: TCoreVariableSourceAssociation[]
    removedExpressionAssociations: TCoreExpressionSourceAssociation[]
    removedOrphanSources: TSource[]
}

export interface TSourceManagerSnapshot<
    TSource extends TCoreSource = TCoreSource,
> {
    sources: TSource[]
    variableSourceAssociations: TCoreVariableSourceAssociation[]
    expressionSourceAssociations: TCoreExpressionSourceAssociation[]
}

/**
 * Registry for sources and their associations to variables and expressions
 * within an argument. Shared across all premises.
 *
 * Enforces uniqueness of source and association IDs. Automatically removes
 * orphaned sources (sources with zero remaining associations) when
 * associations are deleted.
 */
export class SourceManager<TSource extends TCoreSource = TCoreSource> {
    private sources: Map<string, TSource>
    private variableAssociations: Map<string, TCoreVariableSourceAssociation>
    private expressionAssociations: Map<
        string,
        TCoreExpressionSourceAssociation
    >
    private sourceToAssociations: Map<string, Set<string>>
    private variableToAssociations: Map<string, Set<string>>
    private expressionToAssociations: Map<string, Set<string>>

    constructor() {
        this.sources = new Map()
        this.variableAssociations = new Map()
        this.expressionAssociations = new Map()
        this.sourceToAssociations = new Map()
        this.variableToAssociations = new Map()
        this.expressionToAssociations = new Map()
    }

    // -----------------------------------------------------------------------
    // Source mutations
    // -----------------------------------------------------------------------

    /**
     * Registers a source.
     *
     * @throws If a source with the same ID already exists.
     */
    public addSource(source: TSource): void {
        if (this.sources.has(source.id)) {
            throw new Error(`Source with ID "${source.id}" already exists.`)
        }
        this.sources.set(source.id, source)
        this.sourceToAssociations.set(source.id, new Set())
    }

    /**
     * Removes a source and cascades deletion to all its associations.
     *
     * @throws If the source does not exist.
     */
    public removeSource(sourceId: string): TSourceRemovalResult<TSource> {
        const source = this.sources.get(sourceId)
        if (!source) {
            throw new Error(`Source "${sourceId}" does not exist.`)
        }

        const associationIds = this.sourceToAssociations.get(sourceId)
        const removedVariableAssociations: TCoreVariableSourceAssociation[] = []
        const removedExpressionAssociations: TCoreExpressionSourceAssociation[] =
            []

        if (associationIds) {
            for (const assocId of associationIds) {
                const varAssoc = this.variableAssociations.get(assocId)
                if (varAssoc) {
                    this.variableAssociations.delete(assocId)
                    const varSet = this.variableToAssociations.get(
                        varAssoc.variableId
                    )
                    if (varSet) {
                        varSet.delete(assocId)
                        if (varSet.size === 0) {
                            this.variableToAssociations.delete(
                                varAssoc.variableId
                            )
                        }
                    }
                    removedVariableAssociations.push(varAssoc)
                    continue
                }

                const exprAssoc = this.expressionAssociations.get(assocId)
                if (exprAssoc) {
                    this.expressionAssociations.delete(assocId)
                    const exprSet = this.expressionToAssociations.get(
                        exprAssoc.expressionId
                    )
                    if (exprSet) {
                        exprSet.delete(assocId)
                        if (exprSet.size === 0) {
                            this.expressionToAssociations.delete(
                                exprAssoc.expressionId
                            )
                        }
                    }
                    removedExpressionAssociations.push(exprAssoc)
                }
            }
        }

        this.sources.delete(sourceId)
        this.sourceToAssociations.delete(sourceId)

        return {
            removedVariableAssociations,
            removedExpressionAssociations,
            removedOrphanSources: [],
        }
    }

    // -----------------------------------------------------------------------
    // Variable association mutations
    // -----------------------------------------------------------------------

    /**
     * Registers a variable-source association.
     *
     * @throws If an association with the same ID already exists.
     * @throws If the referenced source does not exist.
     */
    public addVariableSourceAssociation(
        assoc: TCoreVariableSourceAssociation
    ): void {
        if (this.variableAssociations.has(assoc.id)) {
            throw new Error(
                `Variable-source association with ID "${assoc.id}" already exists.`
            )
        }
        if (!this.sources.has(assoc.sourceId)) {
            throw new Error(`Source "${assoc.sourceId}" does not exist.`)
        }

        this.variableAssociations.set(assoc.id, assoc)

        const sourceSet = this.sourceToAssociations.get(assoc.sourceId)!
        sourceSet.add(assoc.id)

        let varSet = this.variableToAssociations.get(assoc.variableId)
        if (!varSet) {
            varSet = new Set()
            this.variableToAssociations.set(assoc.variableId, varSet)
        }
        varSet.add(assoc.id)
    }

    /**
     * Removes a variable-source association by ID.
     *
     * @returns The removed association and any orphaned sources.
     * @throws If the association does not exist.
     */
    public removeVariableSourceAssociation(
        id: string
    ): TSourceRemovalResult<TSource> {
        const assoc = this.variableAssociations.get(id)
        if (!assoc) {
            throw new Error(
                `Variable-source association "${id}" does not exist.`
            )
        }

        this.variableAssociations.delete(id)

        const sourceSet = this.sourceToAssociations.get(assoc.sourceId)
        if (sourceSet) {
            sourceSet.delete(id)
        }

        const varSet = this.variableToAssociations.get(assoc.variableId)
        if (varSet) {
            varSet.delete(id)
            if (varSet.size === 0) {
                this.variableToAssociations.delete(assoc.variableId)
            }
        }

        const removedOrphanSources = this.cleanupOrphanedSource(assoc.sourceId)

        return {
            removedVariableAssociations: [assoc],
            removedExpressionAssociations: [],
            removedOrphanSources,
        }
    }

    // -----------------------------------------------------------------------
    // Expression association mutations
    // -----------------------------------------------------------------------

    /**
     * Registers an expression-source association.
     *
     * @throws If an association with the same ID already exists.
     * @throws If the referenced source does not exist.
     */
    public addExpressionSourceAssociation(
        assoc: TCoreExpressionSourceAssociation
    ): void {
        if (this.expressionAssociations.has(assoc.id)) {
            throw new Error(
                `Expression-source association with ID "${assoc.id}" already exists.`
            )
        }
        if (!this.sources.has(assoc.sourceId)) {
            throw new Error(`Source "${assoc.sourceId}" does not exist.`)
        }

        this.expressionAssociations.set(assoc.id, assoc)

        const sourceSet = this.sourceToAssociations.get(assoc.sourceId)!
        sourceSet.add(assoc.id)

        let exprSet = this.expressionToAssociations.get(assoc.expressionId)
        if (!exprSet) {
            exprSet = new Set()
            this.expressionToAssociations.set(assoc.expressionId, exprSet)
        }
        exprSet.add(assoc.id)
    }

    /**
     * Removes an expression-source association by ID.
     *
     * @returns The removed association and any orphaned sources.
     * @throws If the association does not exist.
     */
    public removeExpressionSourceAssociation(
        id: string
    ): TSourceRemovalResult<TSource> {
        const assoc = this.expressionAssociations.get(id)
        if (!assoc) {
            throw new Error(
                `Expression-source association "${id}" does not exist.`
            )
        }

        this.expressionAssociations.delete(id)

        const sourceSet = this.sourceToAssociations.get(assoc.sourceId)
        if (sourceSet) {
            sourceSet.delete(id)
        }

        const exprSet = this.expressionToAssociations.get(assoc.expressionId)
        if (exprSet) {
            exprSet.delete(id)
            if (exprSet.size === 0) {
                this.expressionToAssociations.delete(assoc.expressionId)
            }
        }

        const removedOrphanSources = this.cleanupOrphanedSource(assoc.sourceId)

        return {
            removedVariableAssociations: [],
            removedExpressionAssociations: [assoc],
            removedOrphanSources,
        }
    }

    // -----------------------------------------------------------------------
    // Bulk association removal (for cascade from variable/expression deletion)
    // -----------------------------------------------------------------------

    /**
     * Removes all variable-source associations for a given variable.
     * Orphaned sources are automatically cleaned up.
     */
    public removeAssociationsForVariable(
        variableId: string
    ): TSourceRemovalResult<TSource> {
        const assocIds = this.variableToAssociations.get(variableId)
        if (!assocIds || assocIds.size === 0) {
            return {
                removedVariableAssociations: [],
                removedExpressionAssociations: [],
                removedOrphanSources: [],
            }
        }

        const removedVariableAssociations: TCoreVariableSourceAssociation[] = []
        const sourceIdsToCheck = new Set<string>()

        for (const assocId of assocIds) {
            const assoc = this.variableAssociations.get(assocId)
            if (!assoc) continue

            this.variableAssociations.delete(assocId)
            sourceIdsToCheck.add(assoc.sourceId)

            const sourceSet = this.sourceToAssociations.get(assoc.sourceId)
            if (sourceSet) {
                sourceSet.delete(assocId)
            }

            removedVariableAssociations.push(assoc)
        }

        this.variableToAssociations.delete(variableId)

        const removedOrphanSources: TSource[] = []
        for (const sourceId of sourceIdsToCheck) {
            removedOrphanSources.push(...this.cleanupOrphanedSource(sourceId))
        }

        return {
            removedVariableAssociations,
            removedExpressionAssociations: [],
            removedOrphanSources,
        }
    }

    /**
     * Removes all expression-source associations for a given expression.
     * Orphaned sources are automatically cleaned up.
     */
    public removeAssociationsForExpression(
        expressionId: string
    ): TSourceRemovalResult<TSource> {
        const assocIds = this.expressionToAssociations.get(expressionId)
        if (!assocIds || assocIds.size === 0) {
            return {
                removedVariableAssociations: [],
                removedExpressionAssociations: [],
                removedOrphanSources: [],
            }
        }

        const removedExpressionAssociations: TCoreExpressionSourceAssociation[] =
            []
        const sourceIdsToCheck = new Set<string>()

        for (const assocId of assocIds) {
            const assoc = this.expressionAssociations.get(assocId)
            if (!assoc) continue

            this.expressionAssociations.delete(assocId)
            sourceIdsToCheck.add(assoc.sourceId)

            const sourceSet = this.sourceToAssociations.get(assoc.sourceId)
            if (sourceSet) {
                sourceSet.delete(assocId)
            }

            removedExpressionAssociations.push(assoc)
        }

        this.expressionToAssociations.delete(expressionId)

        const removedOrphanSources: TSource[] = []
        for (const sourceId of sourceIdsToCheck) {
            removedOrphanSources.push(...this.cleanupOrphanedSource(sourceId))
        }

        return {
            removedVariableAssociations: [],
            removedExpressionAssociations,
            removedOrphanSources,
        }
    }

    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------

    /** Returns the source with the given ID, or `undefined` if not found. */
    public getSource(id: string): TSource | undefined {
        return this.sources.get(id)
    }

    /** Returns all registered sources sorted by ID for deterministic output. */
    public getSources(): TSource[] {
        return Array.from(this.sources.values()).sort((a, b) =>
            a.id.localeCompare(b.id)
        )
    }

    /** Returns all associations (variable and expression) for a given source. */
    public getAssociationsForSource(sourceId: string): {
        variable: TCoreVariableSourceAssociation[]
        expression: TCoreExpressionSourceAssociation[]
    } {
        const assocIds = this.sourceToAssociations.get(sourceId)
        if (!assocIds) {
            return { variable: [], expression: [] }
        }

        const variable: TCoreVariableSourceAssociation[] = []
        const expression: TCoreExpressionSourceAssociation[] = []

        for (const assocId of assocIds) {
            const varAssoc = this.variableAssociations.get(assocId)
            if (varAssoc) {
                variable.push(varAssoc)
                continue
            }
            const exprAssoc = this.expressionAssociations.get(assocId)
            if (exprAssoc) {
                expression.push(exprAssoc)
            }
        }

        return { variable, expression }
    }

    /** Returns all variable-source associations for a given variable. */
    public getAssociationsForVariable(
        variableId: string
    ): TCoreVariableSourceAssociation[] {
        const assocIds = this.variableToAssociations.get(variableId)
        if (!assocIds) return []

        const result: TCoreVariableSourceAssociation[] = []
        for (const assocId of assocIds) {
            const assoc = this.variableAssociations.get(assocId)
            if (assoc) result.push(assoc)
        }
        return result
    }

    /** Returns all expression-source associations for a given expression. */
    public getAssociationsForExpression(
        expressionId: string
    ): TCoreExpressionSourceAssociation[] {
        const assocIds = this.expressionToAssociations.get(expressionId)
        if (!assocIds) return []

        const result: TCoreExpressionSourceAssociation[] = []
        for (const assocId of assocIds) {
            const assoc = this.expressionAssociations.get(assocId)
            if (assoc) result.push(assoc)
        }
        return result
    }

    /** Returns all variable-source associations. */
    public getAllVariableSourceAssociations(): TCoreVariableSourceAssociation[] {
        return Array.from(this.variableAssociations.values())
    }

    /** Returns all expression-source associations. */
    public getAllExpressionSourceAssociations(): TCoreExpressionSourceAssociation[] {
        return Array.from(this.expressionAssociations.values())
    }

    // -----------------------------------------------------------------------
    // Snapshot & restoration
    // -----------------------------------------------------------------------

    /** Returns a serializable snapshot of the current state. */
    public snapshot(): TSourceManagerSnapshot<TSource> {
        return {
            sources: this.getSources(),
            variableSourceAssociations: Array.from(
                this.variableAssociations.values()
            ).sort((a, b) => a.id.localeCompare(b.id)),
            expressionSourceAssociations: Array.from(
                this.expressionAssociations.values()
            ).sort((a, b) => a.id.localeCompare(b.id)),
        }
    }

    /**
     * Creates a new SourceManager from a previously captured snapshot.
     * Rebuilds all internal maps and indices. No validation or orphan
     * cleanup is performed — the snapshot is restored verbatim.
     */
    public static fromSnapshot<TSource extends TCoreSource = TCoreSource>(
        data: TSourceManagerSnapshot<TSource>
    ): SourceManager<TSource> {
        const sm = new SourceManager<TSource>()

        // Restore sources (without creating empty sourceToAssociations entries
        // here — we build those from the associations below)
        for (const source of data.sources) {
            sm.sources.set(source.id, source)
            sm.sourceToAssociations.set(source.id, new Set())
        }

        // Restore variable associations and rebuild indices
        for (const assoc of data.variableSourceAssociations) {
            sm.variableAssociations.set(assoc.id, assoc)

            const sourceSet = sm.sourceToAssociations.get(assoc.sourceId)
            if (sourceSet) {
                sourceSet.add(assoc.id)
            }

            let varSet = sm.variableToAssociations.get(assoc.variableId)
            if (!varSet) {
                varSet = new Set()
                sm.variableToAssociations.set(assoc.variableId, varSet)
            }
            varSet.add(assoc.id)
        }

        // Restore expression associations and rebuild indices
        for (const assoc of data.expressionSourceAssociations) {
            sm.expressionAssociations.set(assoc.id, assoc)

            const sourceSet = sm.sourceToAssociations.get(assoc.sourceId)
            if (sourceSet) {
                sourceSet.add(assoc.id)
            }

            let exprSet = sm.expressionToAssociations.get(assoc.expressionId)
            if (!exprSet) {
                exprSet = new Set()
                sm.expressionToAssociations.set(assoc.expressionId, exprSet)
            }
            exprSet.add(assoc.id)
        }

        return sm
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /**
     * Checks if the given source has zero remaining associations and, if so,
     * removes it and returns it in an array. Returns an empty array otherwise.
     */
    private cleanupOrphanedSource(sourceId: string): TSource[] {
        const sourceSet = this.sourceToAssociations.get(sourceId)
        if (sourceSet?.size === 0) {
            const source = this.sources.get(sourceId)
            if (source) {
                this.sources.delete(sourceId)
                this.sourceToAssociations.delete(sourceId)
                return [source]
            }
        }
        return []
    }
}
