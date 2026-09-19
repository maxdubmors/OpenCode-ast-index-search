---
description: Initialize ast-index structural code search for this project.
---

Load the `ast-index` skill, then initialize the index from the current project
directory. Use the following scope or preferences if supplied: $ARGUMENTS

1. Run `ast-index version`. If the CLI is missing, explain how to install it
   with `npm install -g @ast-index/cli` or `brew install defendend/ast-index/ast-index`.
   Continue once the executable is available on PATH.
2. Inspect project markers to identify the languages and relevant source roots.
   Include all applicable stacks for KMP and polyglot repositories.
3. Run `ast-index stats`. Refresh an existing usable index with `ast-index update`;
   otherwise run `ast-index rebuild`. For a requested scope, use
   `ast-index rebuild --include <path>` and explain that other paths are excluded.
4. Verify with `ast-index stats` and one `ast-index search` for a symbol present
   in the project. Report the indexed file and symbol counts and the search result.

The OpenCode plugin supplies search guidance and refresh hooks. Keep existing
OpenCode settings and project instructions unchanged.
