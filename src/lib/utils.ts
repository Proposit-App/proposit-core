type DefaultValueFactory<K, V> = (key?: K) => V

/**
 * A `Map` subclass that auto-creates values for missing keys using a
 * factory function. Optionally enforces an LRU-style size limit by
 * evicting the oldest entry when the limit is reached.
 */
export class DefaultMap<K, V> extends Map<K, V> {
    private mkDefault: DefaultValueFactory<K, V>
    private limit: number

    constructor(
        mkDefault: DefaultValueFactory<K, V>,
        entries?: Iterable<[K, V]>,
        limit = -1
    ) {
        super(entries)
        this.mkDefault = mkDefault
        this.limit = limit
    }

    /** Returns the value for `key`, creating it via the factory if absent. */
    public get(key: K): V {
        if (!this.has(key)) {
            this.set(key, this.mkDefault(key))
        }
        return super.get(key)!
    }

    /** Sets `key` to `value`, evicting the oldest entry if the size limit is reached. */
    public set(key: K, value: V) {
        if (this.limit >= 0 && this.size + 1 >= this.limit) {
            // Remove the oldest entry when the limit is reached
            // This implementation uses the first entry, which is the oldest in insertion order
            const oldestKey = this.keys().next().value
            if (oldestKey !== undefined) this.delete(oldestKey)
        }
        return super.set(key, value)
    }
}
