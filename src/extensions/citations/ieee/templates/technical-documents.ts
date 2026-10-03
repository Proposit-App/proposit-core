// IEEE segment templates for technical documents.

import {
    separator,
    stringField,
    yearOrUndated,
    whenPresent,
    onlineAvailable,
} from "./fragments.js"
import type { TSegmentInstruction } from "./instruction-types.js"

// Datasheet: title(italic), ", ", manufacturer(publisher), ", ", partNumber(misc), ", ", year, ". ", "[Online]. Available: ", url(link)
export const DATASHEET_TEMPLATE: TSegmentInstruction[] = [
    stringField("title", "title", "italic"),
    separator(", "),
    stringField("manufacturer", "publisher"),
    separator(", "),
    stringField("partNumber", "misc"),
    separator(", "),
    yearOrUndated(),
    separator(". "),
    ...onlineAvailable(),
]

// ProductManual: title(italic), ", ", manufacturer(publisher), ", ", model(misc), ", ", year, [". ", "[Online]. Available: ", url(link)], "."
export const PRODUCT_MANUAL_TEMPLATE: TSegmentInstruction[] = [
    stringField("title", "title", "italic"),
    separator(", "),
    stringField("manufacturer", "publisher"),
    separator(", "),
    stringField("model", "misc"),
    separator(", "),
    yearOrUndated(),
    whenPresent("url", [separator(". "), ...onlineAvailable()]),
    separator("."),
]
