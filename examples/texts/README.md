# Example argument texts

A collection of argumentative texts (philosophy, essays, court opinions and
political writing), kept as sample input for turning prose into an argument
(for example with the ingestion pipelines under `src/extensions/pipelines/`)
and for trying the CLI by hand. No test, script or build step reads this
folder: the live pipeline tests keep their own copies under `test/`, and the
test suite's example arguments live in `examples/arguments/`.

## Contents

- `01-crito.txt` to `18-origin-of-species.txt` — one plain-text file per work,
  numbered in the order they were added. Number 03 is missing on purpose: that
  text was removed because it is still under copyright.
- `federalist-papers/` — all 85 Federalist Papers, one plain-text file per
  paper (`federalist-no-01.txt` to `federalist-no-85.txt`).
- `*.svg` — argument graphs drawn from some of the texts. Each is the output of
  the CLI's `graph` command rendered with Graphviz
  (`proposit-core <id> <ver> graph | dot -Tsvg`), for an argument built by hand
  or by a pipeline from the text. They are illustrations, not expected output,
  so they are not kept up to date with the engine.

## Which graph belongs to which text

The number at the start of an SVG file name matches the number of its text. The
graph's own heading names the argument it shows.

| SVG        | Text                                      | What the graph shows                                                                                                          |
| ---------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `01.svg`   | `01-crito.txt`                            | Socrates argues against escape                                                                                                |
| `02.svg`   | `02-on-liberty-ch2.txt`                   | Mill on liberty of thought and discussion                                                                                     |
| `04.svg`   | `04-obergefell-v-hodges.txt`              | Obergefell majority constitutional holding, structure only                                                                    |
| `04-1.svg` | `04-obergefell-v-hodges.txt`              | The same argument with an evaluation laid over it (the `graph --analysis` option), in which the argument is reported as sound |
| `04-2.svg` | `04-obergefell-v-hodges.txt`              | The same argument with an evaluation in which some claims are false or unknown and the argument is reported as unsound        |
| `05.svg`   | `05-federalist-no-10.txt`                 | Federalist 10 on Union and faction                                                                                            |
| `06.svg`   | `06-singer-solution-to-world-poverty.txt` | Singer's duty to give surplus wealth                                                                                          |
| `07.svg`   | `07-common-sense-ch3.txt`                 | Paine argues for American independence                                                                                        |
| `08.svg`   | `08-castes-in-india.txt`                  | Ambedkar on caste as enforced endogamy                                                                                        |

Texts 09 to 18 and the Federalist Papers have no graph.
