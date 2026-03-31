import type { TCoreSource } from "../schemata/source.js"
import { CoreSourceSchema } from "../schemata/source.js"
import type { TCoreChecksumConfig } from "../types/checksum.js"
import type {
    TSourceLibraryManagement,
    TSourceLibrarySnapshot,
} from "./interfaces/library.interfaces.js"
import {
    SOURCE_SCHEMA_INVALID,
    SOURCE_FROZEN_NO_SUCCESSOR,
} from "../types/validation.js"
import { VersionedLibrary } from "./versioned-library.js"

export class SourceLibrary<TSource extends TCoreSource = TCoreSource>
    extends VersionedLibrary<TSource>
    implements TSourceLibraryManagement<TSource>
{
    protected readonly entityLabel = "Source"
    protected readonly entityType = "source" as const
    protected readonly schema = CoreSourceSchema
    protected readonly checksumFieldsKey = "sourceFields" as const
    protected readonly schemaInvalidCode = SOURCE_SCHEMA_INVALID
    protected readonly frozenSuccessorCode = SOURCE_FROZEN_NO_SUCCESSOR

    public snapshot(): TSourceLibrarySnapshot<TSource> {
        return { sources: this.getAll() }
    }

    /** Restores a source library from a previously captured snapshot. */
    public static fromSnapshot<TSource extends TCoreSource = TCoreSource>(
        snapshot: TSourceLibrarySnapshot<TSource>,
        options?: { checksumConfig?: TCoreChecksumConfig }
    ): SourceLibrary<TSource> {
        const lib = new SourceLibrary<TSource>(options)
        lib.restoreFromEntities(snapshot.sources)
        return lib
    }
}
