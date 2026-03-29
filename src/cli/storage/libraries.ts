import fs from "node:fs/promises"
import path from "node:path"
import { ClaimLibrary } from "../../lib/core/claim-library.js"
import { SourceLibrary } from "../../lib/core/source-library.js"
import { ClaimSourceLibrary } from "../../lib/core/claim-source-library.js"
import { ForkLibrary } from "../../lib/core/fork-library.js"
import type {
    TClaimLookup,
    TSourceLookup,
} from "../../lib/core/interfaces/library.interfaces.js"
import { getStateDir } from "../config.js"

function claimsPath(): string {
    return path.join(getStateDir(), "claims.json")
}

function sourcesPath(): string {
    return path.join(getStateDir(), "sources.json")
}

function claimSourceAssociationsPath(): string {
    return path.join(getStateDir(), "claim-source-associations.json")
}

export async function readClaimLibrary(): Promise<ClaimLibrary> {
    try {
        const content = await fs.readFile(claimsPath(), "utf-8")
        const snapshot = JSON.parse(content) as ReturnType<
            ClaimLibrary["snapshot"]
        >
        return ClaimLibrary.fromSnapshot(snapshot)
    } catch {
        return new ClaimLibrary()
    }
}

export async function readSourceLibrary(): Promise<SourceLibrary> {
    try {
        const content = await fs.readFile(sourcesPath(), "utf-8")
        const snapshot = JSON.parse(content) as ReturnType<
            SourceLibrary["snapshot"]
        >
        return SourceLibrary.fromSnapshot(snapshot)
    } catch {
        return new SourceLibrary()
    }
}

export async function readClaimSourceLibrary(
    claimLookup: TClaimLookup,
    sourceLookup: TSourceLookup
): Promise<ClaimSourceLibrary> {
    try {
        const content = await fs.readFile(
            claimSourceAssociationsPath(),
            "utf-8"
        )
        const snapshot = JSON.parse(content) as ReturnType<
            ClaimSourceLibrary["snapshot"]
        >
        return ClaimSourceLibrary.fromSnapshot(
            snapshot,
            claimLookup,
            sourceLookup
        )
    } catch {
        return new ClaimSourceLibrary(claimLookup, sourceLookup)
    }
}

export async function writeClaimLibrary(library: ClaimLibrary): Promise<void> {
    const filePath = claimsPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(library.snapshot(), null, 2))
}

export async function writeSourceLibrary(
    library: SourceLibrary
): Promise<void> {
    const filePath = sourcesPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(library.snapshot(), null, 2))
}

export async function writeClaimSourceLibrary(
    library: ClaimSourceLibrary
): Promise<void> {
    const filePath = claimSourceAssociationsPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(library.snapshot(), null, 2))
}

function forksPath(): string {
    return path.join(getStateDir(), "forks.json")
}

export async function readForkLibrary(): Promise<ForkLibrary> {
    try {
        const content = await fs.readFile(forksPath(), "utf-8")
        const snapshot = JSON.parse(content) as ReturnType<
            ForkLibrary["snapshot"]
        >
        return ForkLibrary.fromSnapshot(snapshot)
    } catch {
        return new ForkLibrary()
    }
}

export async function writeForkLibrary(library: ForkLibrary): Promise<void> {
    const filePath = forksPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(library.snapshot(), null, 2))
}
