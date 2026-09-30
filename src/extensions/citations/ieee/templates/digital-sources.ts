// IEEE segment templates for digital sources.

import {
    separator,
    stringField,
    dateField,
    literal,
    authorsLead,
    singleAuthorLead,
    whenPresent,
    optionalAuthorsLead,
    onlineAvailable,
    accessedOn,
    doiIfPresent,
    versionIfPresent,
} from "./fragments.js"
import type { TSegmentInstruction } from "./instruction-types.js"

// Dataset: [authors, ", "], title(quoted), ", ", repository(misc), [", ver. ", version(misc)], ", ", year, [", doi: ", doi], ". ", "[Online]. Available: ", url(link)
export const DATASET_TEMPLATE: TSegmentInstruction[] = [
    optionalAuthorsLead(", "),
    stringField("title", "title", "quoted"),
    separator(", "),
    stringField("repository", "misc"),
    versionIfPresent(),
    separator(", "),
    stringField("year", "year"),
    doiIfPresent(),
    separator(". "),
    ...onlineAvailable(),
]

// Software: [authors, ", "], title(italic), [", ver. ", version(misc)], ", ", year, [". ", publisher], [". ", "doi: ", doi], ". ", "[Online]. Available: ", url(link)
export const SOFTWARE_TEMPLATE: TSegmentInstruction[] = [
    optionalAuthorsLead(", "),
    stringField("title", "title", "italic"),
    versionIfPresent(),
    separator(", "),
    stringField("year", "year"),
    whenPresent("publisher", [
        separator(". "),
        stringField("publisher", "publisher"),
    ]),
    whenPresent("doi", [
        separator(". "),
        literal("doi: ", "prefix"),
        stringField("doi", "doi"),
    ]),
    separator(". "),
    ...onlineAvailable(),
]

// OnlineDocument: [authors, ". "], title(quoted), [". ", publisher], ". ", "Accessed: ", accessedDate, ". ", "[Online]. Available: ", url(link)
export const ONLINE_DOCUMENT_TEMPLATE: TSegmentInstruction[] = [
    optionalAuthorsLead(". "),
    stringField("title", "title", "quoted"),
    whenPresent("publisher", [
        separator(". "),
        stringField("publisher", "publisher"),
    ]),
    separator(". "),
    ...accessedOn(),
    separator(". "),
    ...onlineAvailable(),
]

// Blog: author(single), ", ", postTitle(quoted), ", ", blogName(italic,misc), ", ", date, ". ", "Accessed: ", accessedDate, ". ", "[Online]. Available: ", url(link)
export const BLOG_TEMPLATE: TSegmentInstruction[] = [
    singleAuthorLead("author"),
    separator(", "),
    stringField("postTitle", "title", "quoted"),
    separator(", "),
    stringField("blogName", "misc", "italic"),
    separator(", "),
    dateField("date", "date"),
    separator(". "),
    ...accessedOn(),
    separator(". "),
    ...onlineAvailable(),
]

// SocialMedia: [author, [" [@", username, "]"], ", " | "[@", username, "]", ", "], ["title"(quoted), ", " | body, ", "], websiteTitle | platform, ", ", postDate(date), ". ", ["Accessed: ", accessedDate, ". "], "Available: ", url(link)
// Follows the University of Melbourne's IEEE social media style.
export const SOCIAL_MEDIA_TEMPLATE: TSegmentInstruction[] = [
    whenPresent(
        "author",
        [
            singleAuthorLead("author"),
            whenPresent("username", [
                separator(" "),
                literal("[@", "prefix"),
                stringField("username", "username"),
                literal("]", "suffix"),
            ]),
            separator(", "),
        ],
        {
            otherwise: [
                whenPresent("username", [
                    literal("[@", "prefix"),
                    stringField("username", "username"),
                    literal("]", "suffix"),
                    separator(", "),
                ]),
            ],
        }
    ),
    whenPresent(
        "postTitle",
        [stringField("postTitle", "title", "quoted"), separator(", ")],
        {
            otherwise: [
                whenPresent("postBody", [
                    stringField("postBody", "body"),
                    separator(", "),
                ]),
            ],
        }
    ),
    whenPresent("websiteTitle", [stringField("websiteTitle", "platform")], {
        otherwise: [stringField("platform", "platform")],
    }),
    separator(", "),
    dateField("postDate", "date"),
    separator(". "),
    whenPresent("accessedDate", [...accessedOn(), separator(". ")]),
    literal("Available: ", "prefix"),
    stringField("url", "url", "link"),
]

// Preprint: authors, ", ", title(quoted), ", ", server(italic,misc), ", ", year, [", doi: ", doi], ". ", "[Online]. Available: ", url(link)
export const PREPRINT_TEMPLATE: TSegmentInstruction[] = [
    authorsLead(),
    separator(", "),
    stringField("title", "title", "quoted"),
    separator(", "),
    stringField("server", "misc", "italic"),
    separator(", "),
    stringField("year", "year"),
    doiIfPresent(),
    separator(". "),
    ...onlineAvailable(),
]
