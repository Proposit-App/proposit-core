import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { randomUUID } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { runCreateExpression } from "../../src/cli/commands/expressions.js"
import {
    writeArgumentMeta,
    writeVersionMeta,
} from "../../src/cli/storage/arguments.js"
import { writeVariables } from "../../src/cli/storage/variables.js"
import { writeRoles } from "../../src/cli/storage/roles.js"
import {
    readPremiseData,
    writePremiseData,
    writePremiseMeta,
} from "../../src/cli/storage/premises.js"

// ---------------------------------------------------------------------------
// `expressions create` builds an expression tree top-down across separate CLI
// invocations: create the operator first, then attach each child. Every
// intermediate state is not yet Presentable, so the build must persist the
// partial tree as-is rather than letting the assistive AN hook collapse it.
// ---------------------------------------------------------------------------

const ARG_ID = randomUUID()
const PREMISE_ID = randomUUID()
const VAR_R = randomUUID()
const VAR_W = randomUUID()
const CLAIM_ID = randomUUID()

let savedHome: string | undefined
let stateDir: string

async function seedArgument(): Promise<void> {
    await writeArgumentMeta({ id: ARG_ID, title: "Rain chain" })
    await writeVersionMeta(ARG_ID, {
        version: 0,
        createdAt: new Date(),
        published: false,
    })
    await writeVariables(ARG_ID, 0, [
        {
            id: VAR_R,
            argumentId: ARG_ID,
            argumentVersion: 0,
            symbol: "R",
            claimId: CLAIM_ID,
            claimVersion: 0,
        },
        {
            id: VAR_W,
            argumentId: ARG_ID,
            argumentVersion: 0,
            symbol: "W",
            claimId: CLAIM_ID,
            claimVersion: 0,
        },
    ] as never)
    await writeRoles(ARG_ID, 0, {})
    await writePremiseMeta(ARG_ID, 0, { id: PREMISE_ID, title: "R implies W" })
    await writePremiseData(ARG_ID, 0, PREMISE_ID, {
        variables: [],
        expressions: [],
    })
}

beforeEach(async () => {
    savedHome = process.env.PROPOSIT_HOME
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "proposit-expr-create-"))
    process.env.PROPOSIT_HOME = stateDir
    await seedArgument()
})

afterEach(async () => {
    if (savedHome === undefined) delete process.env.PROPOSIT_HOME
    else process.env.PROPOSIT_HOME = savedHome
    await fs.rm(stateDir, { recursive: true, force: true })
})

describe("expressions create — incremental top-down build", () => {
    it("persists a freshly-created childless operator root", async () => {
        const rootId = await runCreateExpression(ARG_ID, 0, PREMISE_ID, {
            type: "operator",
            operator: "implies",
        })

        const data = await readPremiseData(ARG_ID, 0, PREMISE_ID)
        expect(data.expressions).toHaveLength(1)
        expect(data.rootExpressionId).toBe(rootId)
        expect(data.expressions[0]).toMatchObject({
            id: rootId,
            type: "operator",
            operator: "implies",
            parentId: null,
        })
    })

    it("builds R → W by attaching children to the persisted root", async () => {
        const rootId = await runCreateExpression(ARG_ID, 0, PREMISE_ID, {
            type: "operator",
            operator: "implies",
        })
        const leftId = await runCreateExpression(ARG_ID, 0, PREMISE_ID, {
            type: "variable",
            variableId: VAR_R,
            parentId: rootId,
            position: "0",
        })
        const rightId = await runCreateExpression(ARG_ID, 0, PREMISE_ID, {
            type: "variable",
            variableId: VAR_W,
            parentId: rootId,
            position: "1",
        })

        const data = await readPremiseData(ARG_ID, 0, PREMISE_ID)
        expect(data.rootExpressionId).toBe(rootId)
        const ids = data.expressions.map((e) => e.id).sort()
        expect(ids).toEqual([rootId, leftId, rightId].sort())
        const children = data.expressions
            .filter((e) => e.parentId === rootId)
            .sort((a, b) => a.position - b.position)
        expect(children.map((c) => c.id)).toEqual([leftId, rightId])
    })
})
