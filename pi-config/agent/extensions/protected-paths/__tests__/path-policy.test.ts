import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isProtectedPath, mutationPaths } from "../path-policy.ts";

const cwd = mkdtempSync(join(tmpdir(), "pi-protected-paths-"));

test("classifies protected components without substring false positives", () => {
	for (const path of [".env", ".env.local", ".git/config", "node_modules/a", ".ssh/id_ed25519", "auth.json", "keys/id_rsa", "certs/site.pem"]) assert.equal(isProtectedPath(path, cwd), true, path);
	for (const path of ["notes/auth.json.md", "node_modules_notes/a", "env-file", "key.pem.txt"]) assert.equal(isProtectedPath(path, cwd), false, path);
});

test("canonicalizes @, relative traversal, and existing symlink aliases", () => {
	mkdirSync(join(cwd, ".git"));
	mkdirSync(join(cwd, "links"));
	symlinkSync(join(cwd, ".git"), join(cwd, "links", "repo"));
	assert.equal(isProtectedPath("@./safe/../.git/config", cwd), true);
	assert.equal(isProtectedPath(join(cwd, "links", "repo", "config"), cwd), true);
});

test("extracts both apply_patch move endpoints", () => {
	assert.deepEqual(mutationPaths("apply_patch", { changes: [{ path: "a", action: "move", movePath: "b" }] }), ["a", "b"]);
	assert.deepEqual(mutationPaths("edit", { path: "a" }), ["a"]);
});
