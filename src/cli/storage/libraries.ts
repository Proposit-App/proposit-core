import fs from "node:fs/promises"
import path from "node:path"
import { ClaimLibrary } from "../../lib/core/claim-library.js"
import { ClaimCitationLibrary } from "../../lib/core/claim-citation-library.js"
import { ForkLibrary } from "../../lib/core/fork-library.js"
import type { TClaimLookup } from "../../lib/core/interfaces/library.interfaces.js"
import { getStateDir } from "../config.js"

function claimsPath(): string {
    return path.join(getStateDir(), "claims.json")
}

function claimCitationsPath(): string {
    return path.join(getStateDir(), "claim-citations.json")
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

export async function readClaimCitationLibrary(
    claimLookup: TClaimLookup
): Promise<ClaimCitationLibrary> {
    try {
        const content = await fs.readFile(claimCitationsPath(), "utf-8")
        const snapshot = JSON.parse(content) as ReturnType<
            ClaimCitationLibrary["snapshot"]
        >
        return ClaimCitationLibrary.fromSnapshot(snapshot, claimLookup)
    } catch {
        return new ClaimCitationLibrary(claimLookup)
    }
}

export async function writeClaimLibrary(library: ClaimLibrary): Promise<void> {
    const filePath = claimsPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(library.snapshot(), null, 2))
}

export async function writeClaimCitationLibrary(
    library: ClaimCitationLibrary
): Promise<void> {
    const filePath = claimCitationsPath()
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
