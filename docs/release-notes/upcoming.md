# Release Notes

## New: Graph command

You can now visualize arguments as directed graphs using the new `graph` command. It outputs DOT (Graphviz) format that can be piped to `dot` to produce SVG or PNG images.

Use `--analysis <filename>` to overlay evaluation results — expression nodes are colored by truth value, making it easy to see how truth flows through the argument.
