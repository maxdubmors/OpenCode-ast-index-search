# OpenCode 2 integration

This native JavaScript plugin targets OpenCode 2.0.6+ and uses its plugin hooks,
the shared `ast-index` skill, and `/initialize-ast-index`.
It requires the `ast-index` CLI on PATH; there are no npm plugin dependencies
or build steps. Install the CLI with `npm install -g @ast-index/cli` if needed.

## Install from this checkout

Run from the repository root on Linux or macOS:

```bash
plugin_source="$(pwd)/plugin"
opencode_config="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
mkdir -p "$opencode_config/plugins" "$opencode_config/skills" "$opencode_config/commands"
ln -s "$plugin_source/opencode/ast-index.js" "$opencode_config/plugins/ast-index.js"
ln -s "$plugin_source/skills/ast-index" "$opencode_config/skills/ast-index"
ln -s "$plugin_source/commands-opencode/initialize-ast-index.md" "$opencode_config/commands/initialize-ast-index.md"
```

For project-only installation, set `opencode_config` to the absolute path of
that project's `.opencode` directory instead. Copying the files and the entire
skill directory also works. On Windows, put the native `ast-index.exe` on PATH;
the refresh hooks launch it directly rather than through an npm `.cmd` shim.
Existing files are not
overwritten by these commands. Install at only one scope to avoid duplicate
hooks. Keep the checkout at this path when using symlinks.

Restart OpenCode (including its background server if it uses one), open the
target project, and run `/initialize-ast-index`. The command verifies the CLI,
builds or updates the index, and checks an actual symbol search. Check that
the `ast-index` skill and command appear in OpenCode.

## Behavior

- At plugin load and before each user prompt, queue an incremental background
  update if an index already exists. Loading covers resumed sessions too.
- After successful `edit`, `write`, or `apply_patch` tools, queue a trailing-debounced
  background update. The CLI's coordinator handles edit bursts and edits that
  arrive during an update.
- Skip updates when the project's `ast-index watch` is active. Missing CLI,
  missing index, and refresh failures produce logs without failing the session.
- Add a short structural-search reminder to the system prompt. After a `grep`
  call for a bare identifier, append a hint to the result, retaining its content.
  Tool arguments and permissions are unchanged.

Initial indexing is explicit through `/initialize-ast-index`; startup never
runs a rebuild. Changes made through shell commands or external editors need
`ast-index update` or a running `ast-index watch`.

The existing Claude hook environment variables work here too:

| Variable | Default | Effect |
| --- | --- | --- |
| `AST_INDEX_HOOK_SKIP_SESSION_START` | `0` | Set to `1` to skip startup/prompt refreshes |
| `AST_INDEX_SESSION_DEBOUNCE_MS` | `0` | Startup/prompt refresh debounce |
| `AST_INDEX_HOOK_DEBOUNCE_MS` | `5000` | Edit refresh debounce |

The plugin uses V2 `session.hook` and `tool.hook` registrations. It does not
support OpenCode 1.x. The skill and Markdown command can also be used independently.
The JavaScript entrypoint exports the V2 definition directly; `Plugin.define`
is an identity helper for TypeScript checking, so no runtime SDK import is needed.

## Update, remove, and test

Symlinks track changes in this checkout. Restart OpenCode after updating it.
To remove the integration, remove the three links created above and restart
OpenCode. For a copied installation, replace or remove the copied files instead.

From this repository, run:

```bash
bash scripts/validate-agent-plugins.sh
node --test tests/opencode-plugin.test.mjs
```

Tests use a temporary project and a fake CLI to exercise hook behavior without
touching the user's index. OpenCode API references:
[plugin API](https://opencode.ai/v2/docs/build/plugins/),
[skills](https://opencode.ai/v2/docs/skills/), and
[commands](https://opencode.ai/v2/docs/commands/).
