import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);
const guidance = "Use ast-index first for structural code search. Load the ast-index skill for command details. " +
  "Use explore for questions, symbol/class for definitions, usages/refs for references, and outline before reading large files. " +
  "Use text search for regex, literals, comments, or when structural search returns no useful result. " +
  "If the index is missing, run /initialize-ast-index.";

function debounce(name, fallback) {
  const value = process.env[name];
  return value && /^\d+$/.test(value) ? value : fallback;
}

async function setup(ctx) {
  const directory = ctx.location.directory;
  const run = (...args) => exec("ast-index", args, {
    cwd: directory,
    timeout: 15000,
    windowsHide: true,
  });

  function log(message) {
    console.warn(`ast-index: ${message}`);
  }

  async function refresh(sessionStart) {
    if (sessionStart && process.env.AST_INDEX_HOOK_SKIP_SESSION_START === "1") return;
    try {
      try {
        await run("watch-status", "--quiet");
        return;
      } catch (error) {
        if (error.code !== 1) throw error;
      }

      const { stdout } = await run("db-path");
      try {
        if (!(await stat(stdout.trim())).isFile()) return;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        if (sessionStart) log("No index yet. Run /initialize-ast-index in this project.");
        return;
      }

      const delay = sessionStart
        ? debounce("AST_INDEX_SESSION_DEBOUNCE_MS", "0")
        : debounce("AST_INDEX_HOOK_DEBOUNCE_MS", "5000");
      await run("update", "--background", "--debounce-ms", delay);
    } catch (error) {
      log(error.code === "ENOENT"
        ? "ast-index is not on PATH. Install the CLI, then run /initialize-ast-index."
        : `Could not queue index refresh: ${error.message}`);
    }
  }

  // Plugin initialization also covers opening an existing session.
  await refresh(true);

  await ctx.session.hook("prompt", () => refresh(true));
  await ctx.session.hook("context", (event) => {
    event.system.push({ type: "text", text: guidance });
  });
  await ctx.tool.hook("execute.after", async (event) => {
    if (event.status !== "completed") return;
    if (["edit", "write", "apply_patch"].includes(event.tool)) await refresh(false);
    const pattern = event.input?.pattern;
    if (event.tool === "grep" && typeof pattern === "string" &&
        pattern.length >= 3 && /^[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*$/.test(pattern)) {
      const reminder = `ast-index: '${pattern}' looks like a symbol. Prefer ast-index symbol, usages, refs, or explore for structural searches.`;
      const content = event.result.content;
      event.result.content = typeof content === "string"
        ? `${content}\n\n${reminder}`
        : [...content, { type: "text", text: reminder }];
    }
  });
}

export default { id: "ast-index", setup };
