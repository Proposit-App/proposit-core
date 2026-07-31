import fs from "node:fs/promises"
import path from "node:path"
import { ClaimLibrary } from "../../lib/core/claim-library.js"
import { ClaimCitationLibrary } from "../../lib/core/claim-citation-library.js"
import { ClaimAxiomLibrary } from "../../lib/core/claim-axiom-library.js"
import { ForkLibrary } from "../../lib/core/fork-library.js"
import { OriginLibrary } from "../../lib/core/origin-library.js"
import type { TClaimLookup } from "../../lib/core/interfaces/library.interfaces.js"
import { getStateDir } from "../config.js"

function claimsPath(): string {
    return path.join(getStateDir(), "claims.json")
}

export function citationsPath(): string {
    return path.join(getStateDir(), "citations.json")
}

export function axiomsPath(): string {
    return path.join(getStateDir(), "axioms.json")
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

export async function readCitationLibrary(
    claimLookup: TClaimLookup
): Promise<ClaimCitationLibrary> {
    try {
        const content = await fs.readFile(citationsPath(), "utf-8")
        const snapshot = JSON.parse(content) as ReturnType<
            ClaimCitationLibrary["snapshot"]
        >
        return ClaimCitationLibrary.fromSnapshot(snapshot, claimLookup)
    } catch {
        return new ClaimCitationLibrary(claimLookup)
    }
}

export async function readAxiomLibrary(
    claimLookup: TClaimLookup
): Promise<ClaimAxiomLibrary> {
    try {
        const content = await fs.readFile(axiomsPath(), "utf-8")
        const snapshot = JSON.parse(content) as ReturnType<
            ClaimAxiomLibrary["snapshot"]
        >
        return ClaimAxiomLibrary.fromSnapshot(snapshot, claimLookup)
    } catch {
        return new ClaimAxiomLibrary(claimLookup)
    }
}

export function originsPath(): string {
    return path.join(getStateDir(), "origins.json")
}

export async function readOriginLibrary(): Promise<OriginLibrary> {
    try {
        const content = await fs.readFile(originsPath(), "utf-8")
        const snapshot = JSON.parse(content) as ReturnType<
            OriginLibrary["snapshot"]
        >
        return OriginLibrary.fromSnapshot(snapshot)
    } catch {
        return new OriginLibrary()
    }
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
