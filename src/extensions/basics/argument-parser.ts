import { ArgumentParser } from "../../lib/parsing/argument-parser.js"
import type {
    TParsedClaim,
    TParsedPremise,
    TParsedArgumentResponse,
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
import type {
    TCoreSource,
    TCoreClaimSourceAssociation,
} from "../../lib/schemata/source.js"

export class BasicsArgumentParser extends ArgumentParser<
    TBasicsArgument,
    TBasicsPremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCoreSource,
    TBasicsClaim,
    TCoreClaimSourceAssociation
> {
    constructor() {
        super(BasicsParsingSchema)
    }

    protected mapArgument(
        parsed: TParsedArgumentResponse
    ): Record<string, unknown> {
        const ext = parsed.argument as Record<string, unknown> | null
        return {
            ...(ext?.title !== undefined ? { title: ext.title } : {}),
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
