# Upcoming

This is a major release. Every value that was valid before is still valid,
apart from an Invalid Date (see Fixed), but three published types are wider, which breaks code that reads them under
strict TypeScript.

## Added

### Organisations and one-part names as authors

An author can now be a single name, written exactly as it should appear:
`{ name: "Reuters" }`, `{ name: "World Health Organization" }`,
`{ name: "Aristotle" }`. This works in every author field of every IEEE
reference type. The personal name (`givenNames`, `familyName`, `suffix`) is
unchanged. Tell the two apart with `"givenNames" in author`.

A name particle belongs in `familyName`:
`{ givenNames: "Ludwig", familyName: "van Beethoven" }` renders
`L. van Beethoven`.

### Social Media citations in the IEEE social media style

A Social Media citation can now carry a `username` (the handle, without its
`@`), a `postTitle` or `postBody`, a `websiteTitle` and an `accessedDate`, all
optional. Its `author` is optional too, so a poster known only by a handle is
cited with a `username` and no `author`.

Every Social Media citation, old or new, now renders in the University of
Melbourne's IEEE style:

```
J. K. Author [@user], "Title", Site, Aug. 12, 1995. Accessed: Sep. 1, 2026. Available: https://…
```

A missing part is left out along with its separator. The title is used over
the body, and `websiteTitle` over `platform`. With no access date the citation
ends at the URL. Two new segment roles, `username` and `body`, label the handle
and the post text.

Core emits a quoted title as a `style: "quoted"` segment followed by a `", "`
separator, as it does for every reference type. Adding the quotation marks,
and putting that comma inside the closing quote (`"Title,"`), is the
renderer's job. A post body is rendered exactly as stored, including any line
breaks or closing punctuation.

## Changed

- **`TAuthor` is a union.** Code that reads `author.givenNames` or
  `author.familyName` needs to narrow first.
- **`TSocialMediaReference["author"]` is optional.**
- **`TCitationSegment["role"]` has two more members**, so an exhaustive
  `switch` over it needs two more cases.

Because an author is now one of two shapes, `Value.Errors` on an invalid
personal author reports the real problem first and then three more errors from
the named shape it also failed (`required name`, `additionalProperties`,
`anyOf`). A form that maps every error to a field should use the first error
at each path.

A client still on 5.x rejects a `{ name }` author and a Social Media citation
without an `author`. It accepts a Social Media citation that has a personal
author and any of the new fields, and renders it in the old format.

## Fixed

`formatSingleAuthor` ignores space around `givenNames` when taking initials, so
`" Jane "` gives `J.` rather than `. J. .`.

`EncodableDate` now rejects an Invalid Date (`new Date("nonsense")`). It used
to validate and then be written as `null` in JSON.
