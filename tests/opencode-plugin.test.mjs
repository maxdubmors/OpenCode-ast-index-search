import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import plugin from "../plugin/opencode/ast-index.js";

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "ast-index-opencode-"));
  const bin = join(root, "bin");
  await mkdir(bin);
  const saved = { ...process.env };
  t.after(async () => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    await rm(root, { recursive: true, force: true });
  });
  process.env.PATH = bin;
  for (const key of ["AST_INDEX_HOOK_SKIP_SESSION_START", "AST_INDEX_HOOK_DEBOUNCE_MS", "AST_INDEX_SESSION_DEBOUNCE_MS"]) {
    delete process.env[key];
  }
  Object.assign(process.env, options.env);
  await writeFile(join(root, "options.json"), JSON.stringify(options));
  if (!options.noIndex) await writeFile(join(root, "index.db"), "fixture");
  if (!options.noCli) {
    await writeFile(join(bin, "ast-index"), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const options = JSON.parse(fs.readFileSync('options.json', 'utf8'));
const args = process.argv.slice(2);
fs.appendFileSync('calls.jsonl', JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
if (args[0] === 'watch-status') process.exit(options.watching ? 0 : 1);
if (args[0] === 'db-path') console.log(path.join(process.cwd(), 'index.db'));
if (args[0] === 'update') process.exit(options.failUpdate ? 2 : 0);
`, { mode: 0o755 });
  }
  const logs = [];
  const warn = console.warn;
  console.warn = (message) => logs.push(message);
  t.after(() => { console.warn = warn; });
  const hooks = {};
  await plugin.setup({
    location: { directory: root },
    session: { hook: async (name, callback) => { hooks[name] = callback; } },
    tool: { hook: async (name, callback) => { hooks[name] = callback; } },
  });
  async function calls() {
    try { return (await readFile(join(root, "calls.jsonl"), "utf8")).trim().split("\n").map(JSON.parse); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
  }
  return { root, hooks, logs, calls };
}

test("refreshes startup, prompts, and every edit in the project directory", async (t) => {
  const { root, hooks, calls } = await fixture(t);
  await hooks.prompt({});
  await hooks.prompt({});
  await Promise.all(Array.from({ length: 3 }, () => hooks["execute.after"]({ tool: "edit", status: "completed" })));
  await hooks["execute.after"]({ tool: "read", status: "completed" });
  const actual = await calls();
  assert.ok(actual.every((call) => call.cwd === root));
  assert.deepEqual(actual.filter((call) => call.args[0] === "update").map((call) => call.args), [
    ["update", "--background", "--debounce-ms", "0"],
    ["update", "--background", "--debounce-ms", "0"],
    ...Array.from({ length: 3 }, () => ["update", "--background", "--debounce-ms", "5000"]),
  ]);
});

test("skips the first prompt refresh when setup already refreshed", async (t) => {
  const { calls, hooks } = await fixture(t);
  const setupUpdates = (await calls()).filter((call) => call.args[0] === "update").length;
  assert.equal(setupUpdates, 1);
  await hooks.prompt({});
  assert.equal((await calls()).filter((call) => call.args[0] === "update").length, 1);
  await hooks.prompt({});
  assert.equal((await calls()).filter((call) => call.args[0] === "update").length, 2);
});

test("retries the first prompt when setup found no index", async (t) => {
  const { calls, hooks } = await fixture(t, { noIndex: true });
  await hooks.prompt({});
  const actual = await calls();
  assert.equal(actual.filter((call) => call.args[0] === "update").length, 0);
  assert.equal(actual.filter((call) => call.args[0] === "db-path").length, 2);
});

test("leaves updates to an active watcher", async (t) => {
  const { hooks, calls } = await fixture(t, { watching: true });
  await hooks["execute.after"]({ tool: "edit", status: "completed" });
  assert.deepEqual((await calls()).map((call) => call.args), [
    ["watch-status", "--quiet"], ["watch-status", "--quiet"],
  ]);
});

test("does not build a missing index", async (t) => {
  const { hooks, calls, logs } = await fixture(t, { noIndex: true });
  await hooks["execute.after"]({ tool: "edit", status: "completed" });
  assert.ok((await calls()).every((call) => ["watch-status", "db-path"].includes(call.args[0])));
  assert.match(logs[0], /initialize-ast-index/);
});

test("missing CLI and refresh failures do not break hooks", async (t) => {
  for (const options of [{ noCli: true }, { failUpdate: true }]) {
    await t.test(JSON.stringify(options), async (t) => {
      const { hooks, logs } = await fixture(t, options);
      await hooks["execute.after"]({ tool: "edit", status: "completed" });
      assert.equal(logs.length, 2);
    });
  }
});

test("session opt-out preserves edit refreshes and validates debounce values", async (t) => {
  const { hooks, calls } = await fixture(t, { env: {
    AST_INDEX_HOOK_SKIP_SESSION_START: "1", AST_INDEX_HOOK_DEBOUNCE_MS: "invalid",
  } });
  await hooks.prompt({});
  assert.deepEqual(await calls(), []);
  await hooks["execute.after"]({ tool: "edit", status: "completed" });
  assert.equal((await calls()).at(-1).args.at(-1), "5000");
  process.env.AST_INDEX_HOOK_DEBOUNCE_MS = "123";
  await hooks["execute.after"]({ tool: "edit", status: "completed" });
  assert.equal((await calls()).at(-1).args.at(-1), "123");
  delete process.env.AST_INDEX_HOOK_SKIP_SESSION_START;
  process.env.AST_INDEX_SESSION_DEBOUNCE_MS = "42";
  await hooks.prompt({});
  assert.equal((await calls()).at(-1).args.at(-1), "42");
});

test("adds guidance and symbol reminders without replacing search results", async (t) => {
  const { hooks } = await fixture(t, { watching: true });
  const system = { system: ["existing instructions"] };
  await hooks.context(system);
  assert.equal(system.system[0], "existing instructions");
  assert.match(system.system[1].text, /ast-index/);
  for (const pattern of ["UserService", "App::User"]) {
    const output = { content: "original results" };
    await hooks["execute.after"]({ tool: "grep", input: { pattern }, status: "completed", result: output });
    assert.ok(output.content.startsWith("original results\n"));
    assert.ok(output.content.includes(pattern));
  }
  for (const pattern of ["foo.*", "a", "two words", "123", undefined]) {
    const output = { content: "original results" };
    await hooks["execute.after"]({ tool: "grep", input: { pattern }, status: "completed", result: output });
    assert.equal(output.content, "original results");
  }
  const output = { content: "original results" };
  await hooks["execute.after"]({ tool: "bash", input: { pattern: "UserService" }, status: "completed", result: output });
  assert.equal(output.content, "original results");
});

test("refreshes all supported edit tools and ignores failed tools", async (t) => {
  const { hooks, calls } = await fixture(t);
  for (const tool of ["edit", "write", "apply_patch"]) {
    await hooks["execute.after"]({ tool, status: "completed" });
  }
  const before = await calls();
  assert.equal(before.filter((call) => call.args[0] === "update").length, 4);
  for (const tool of ["edit", "grep"]) {
    await hooks["execute.after"]({ tool, status: "error", error: { message: "failed" } });
  }
  assert.deepEqual(await calls(), before);
});

test("leaves non-string non-array grep content untouched", async (t) => {
  const { hooks } = await fixture(t, { watching: true });
  for (const content of [undefined, null, 42, { type: "text", text: "found" }]) {
    const result = { content, metadata: { matches: 1 } };
    await hooks["execute.after"]({
      tool: "grep", input: { pattern: "UserService" }, status: "completed", result,
    });
    assert.equal(result.content, content);
    assert.deepEqual(result.metadata, { matches: 1 });
  }
  const noResult = { tool: "grep", input: { pattern: "UserService" }, status: "completed" };
  await hooks["execute.after"](noResult);
});

test("preserves structured tool results and metadata when appending a reminder", async (t) => {
  const { hooks } = await fixture(t, { watching: true });
  const original = [{ type: "text", text: "found a class" }];
  const result = { content: original, metadata: { matches: 1 } };
  await hooks["execute.after"]({
    tool: "grep", input: { pattern: "UserService" }, status: "completed", result,
  });
  assert.deepEqual(result.content[0], original[0]);
  assert.equal(original.length, 1);
  assert.match(result.content[1].text, /UserService/);
  assert.deepEqual(result.metadata, { matches: 1 });
});
