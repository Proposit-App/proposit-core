export type TCorePositionConfig = {
    min: number
    max: number
    initial: number
}

export const POSITION_MIN = -2147483647
export const POSITION_MAX = 2147483647
export const POSITION_INITIAL = 0

export const DEFAULT_POSITION_CONFIG: TCorePositionConfig = {
    min: POSITION_MIN,
    max: POSITION_MAX,
    initial: POSITION_INITIAL,
}

export function midpoint(a: number, b: number): number {
    return a + (b - a) / 2
}
