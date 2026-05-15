import { Command } from "commander"
import { hydrateEngine, persistEngine } from "../engine.js"
import { listPremiseIds } from "../storage/premises.js"
import { readPremiseData } from "../storage/premises.js"
import { printJson, printLine } from "../output.js"

export function registerRepairCommand(
    versionedCmd: Command,
    argumentId: string,
    version: number
): void {
    versionedCmd
        .command("repair")
        .description(
            "Repair argument grammar (e.g., insert formula buffers between nested operators)"
        )
        .option(
            "--dry-run",
            "Report what would be repaired without modifying data"
        )
        .option("--json", "Output as JSON")
        .action(async (opts: { dryRun?: boolean; json?: boolean }) => {
            // Count expressions on disk before repair
            const premiseIds = await listPremiseIds(argumentId, version)
            let diskExprCount = 0
            for (const pid of premiseIds) {
                const data = await readPremiseData(argumentId, version, pid)
                diskExprCount += data.expressions.length
            }

            // Hydrate engine — the assistive AN post-hook (default
            // behavior) inserts formula buffers between nested operators
            // as part of any successful mutation. D2: replaces the
            // pre-v1.0 `autoNormalize: true` grammar-config gating.
            const engine = await hydrateEngine(argumentId, version)

            // Count expressions after auto-normalization
            let engineExprCount = 0
            for (const pm of engine.listPremises()) {
                engineExprCount += pm.getExpressions().length
            }

            const inserted = engineExprCount - diskExprCount

            if (opts.json) {
                printJson({
                    repaired: !opts.dryRun && inserted > 0,
                    formulaBuffersInserted: inserted,
                    expressionsBefore: diskExprCount,
                    expressionsAfter: engineExprCount,
                })
                if (opts.dryRun || inserted === 0) return
                await persistEngine(engine)
                return
            }

            if (inserted === 0) {
                printLine("No repairs needed")
                return
            }

            if (opts.dryRun) {
                printLine(`Would insert ${inserted} formula buffer(s)`)
                return
            }

            await persistEngine(engine)
            printLine(`Repaired: inserted ${inserted} formula buffer(s)`)
        })
}
