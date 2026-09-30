// **Deterministic id generation for golden-corpus replay.**
// `variable-assignment` and `formula-compilation` mint fresh variable
// + premise miniIds via `ctx.generateId()`. The framework default is
// `crypto.randomUUID()` (set in `executePipeline`'s
// `defaultGenerateId`), which produces a different identifier on every
// invocation. With that default, ids written into an expected-output
// file on a recording run would never match the fresh ids minted on a
// replay run, and the deep-equal assertion would fail for every
// fixture whose `argument` is not null.
//
// Approach: inject a deterministic counter-based `generateId` into
// the test's `executePipeline` call. Production behavior keeps the
// UUID default — only the tests get the deterministic version, used
// consistently across record + replay so the recorded expected and the
// replay output share the same id sequence.
//
// A fresh counter per fixture means ids restart at 1 on each pipeline
// run; the alphabetic prefix avoids collision with the canonicalizer's
// claim miniIds (`c1`, `c2`, ...) and the relation/source/axiom ids
// emitted by upstream stages (`r1`, `src1`, `ax1`).
export function createDeterministicGenerateId(prefix = "gid"): () => string {
    let counter = 0
    return () => {
        counter += 1
        return `${prefix}-${String(counter)}`
    }
}
