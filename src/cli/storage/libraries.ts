import fs from "node:fs/promises"
import path from "node:path"
import { ClaimLibrary } from "../../lib/core/claim-library.js"
import { ClaimCitationLibrary } from "../../lib/core/claim-citation-library.js"
import { ClaimAxiomLibrary } from "../../lib/core/claim-axiom-library.js"
import { ForkLibrary } from "../../lib/core/fork-library.js"
import { OriginLibrary } from "../../lib/core/origin-library.js"
import type { TClaimLookup } from "../../lib/core/interfaces/library.interfaces.js"
import { getStateDir } from "../config.js"
import { errorExit } from "../output.js"
import { errorMessage } from "../guards.js"

function claimsPath(): string {
    return path.join(getStateDir(), "claims.json")
}

export function citationsPath(): string {
    return path.join(getStateDir(), "citations.json")
}

export function axiomsPath(): string {
    return path.join(getStateDir(), "axioms.json")
}

/**
 * Reads a library file's snapshot and hands it to `load`. Only a missing file
 * means "no library yet". Any other failure stops the command: returning an
 * empty library instead would let the command's next write save it over the
 * file and erase everything in it.
 */
async function readLibraryFile<T>(
    filePath: string,
    load: (snapshot: never) => T,
    empty: () => T
): Promise<T> {
    let content: string
    try {
        content = await fs.readFile(filePath, "utf-8")
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return empty()
        return errorExit(`Could not read ${filePath}: ${String(err)}`)
    }
    try {
        return load(JSON.parse(content) as never)
    } catch (err) {
        errorExit(`Could not load ${filePath}: ${errorMessage(err)}`)
    }
}

export async function readClaimLibrary(): Promise<ClaimLibrary> {
    return readLibraryFile(
        claimsPath(),
        (snapshot: ReturnType<ClaimLibrary["snapshot"]>) =>
            ClaimLibrary.fromSnapshot(snapshot),
        () => new ClaimLibrary()
    )
}

export async function readCitationLibrary(
    claimLookup: TClaimLookup
): Promise<ClaimCitationLibrary> {
    return readLibraryFile(
        citationsPath(),
        (snapshot: ReturnType<ClaimCitationLibrary["snapshot"]>) =>
            ClaimCitationLibrary.fromSnapshot(snapshot, claimLookup),
        () => new ClaimCitationLibrary(claimLookup)
    )
}

export async function readAxiomLibrary(
    claimLookup: TClaimLookup
): Promise<ClaimAxiomLibrary> {
    return readLibraryFile(
        axiomsPath(),
        (snapshot: ReturnType<ClaimAxiomLibrary["snapshot"]>) =>
            ClaimAxiomLibrary.fromSnapshot(snapshot, claimLookup),
        () => new ClaimAxiomLibrary(claimLookup)
    )
}

export function originsPath(): string {
    return path.join(getStateDir(), "origins.json")
}

export async function readOriginLibrary(): Promise<OriginLibrary> {
    return readLibraryFile(
        originsPath(),
        (snapshot: ReturnType<OriginLibrary["snapshot"]>) =>
            OriginLibrary.fromSnapshot({
                ...snapshot,
                // Anchors on premises were allowed before 5.3.0. A premise has
                // no content of its own, so they are dropped rather than
                // refused, and the next write saves the file without them.
                anchors: snapshot.anchors.filter(
                    (a) => (a.targetType as string) !== "premise"
                ),
            }),
        () => new OriginLibrary()
    )
}

export async function writeOriginLibrary(
    library: OriginLibrary
): Promise<void> {
    const filePath = originsPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(library.snapshot(), null, 2))
}

export async function writeClaimLibrary(library: ClaimLibrary): Promise<void> {
    const filePath = claimsPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(library.snapshot(), null, 2))
}

export async function writeCitationLibrary(
    library: ClaimCitationLibrary
): Promise<void> {
    const filePath = citationsPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(library.snapshot(), null, 2))
}

export async function writeAxiomLibrary(
    library: ClaimAxiomLibrary
): Promise<void> {
    const filePath = axiomsPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(library.snapshot(), null, 2))
}

function forksPath(): string {
    return path.join(getStateDir(), "forks.json")
}

export async function readForkLibrary(): Promise<ForkLibrary> {
    return readLibraryFile(
        forksPath(),
        (snapshot: ReturnType<ForkLibrary["snapshot"]>) =>
            ForkLibrary.fromSnapshot(snapshot),
        () => new ForkLibrary()
    )
}

export async function writeForkLibrary(library: ForkLibrary): Promise<void> {
    const filePath = forksPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(library.snapshot(), null, 2))
}
