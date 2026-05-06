import { ArgumentParser } from "../../lib/parsing/argument-parser.js"
import type {
    TParsedArgument,
    TParsedClaim,
    TParsedPremise,
} from "../../lib/parsing/schemata.js"
import { BasicsParsingSchema } from "./schemata.js"
import type {
    TBasicsArgument,
    TBasicsClaim,
    TBasicsPremise,
} from "./schemata.js"
import type {
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../../lib/schemata/propositional.js"

export class BasicsArgumentParser extends ArgumentParser<
    TBasicsArgument,
    TBasicsPremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TBasicsClaim
> {
    constructor() {
        super(BasicsParsingSchema)
    }

    protected mapArgument(parsed: TParsedArgument): Record<string, unknown> {
        const ext = parsed as Record<string, unknown>
        return {
            ...(ext.title !== undefined ? { title: ext.title } : {}),
        }
    }

    protected mapClaim(parsed: TParsedClaim): Record<string, unknown> {
        const ext = parsed as Record<string, unknown>
        return {
            ...(ext.title !== undefined ? { title: ext.title } : {}),
            ...(ext.body !== undefined ? { body: ext.body } : {}),
        }
    }

    protected mapPremise(parsed: TParsedPremise): Record<string, unknown> {
        const ext = parsed as Record<string, unknown>
        return {
            ...(ext.title !== undefined ? { title: ext.title } : {}),
        }
    }
}
