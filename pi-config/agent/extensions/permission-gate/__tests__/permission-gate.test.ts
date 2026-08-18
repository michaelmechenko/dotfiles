import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isConfinedToTmp, isDangerous } from "../index.ts";

test("recognizes direct, absolute, and wrapped dangerous commands", () => {
	assert.equal(isDangerous("rm -rf target"), true);
	assert.equal(isDangerous("/bin/rm -rf target"), true);
	assert.equal(isDangerous("command rm -rf target"), true);
	assert.equal(isDangerous("printf safe"), false);
});

test("allows only literal absolute paths confined to temporary directories", () => {
	assert.equal(isConfinedToTmp("rm -r -f /tmp/pi-test"), true);
	assert.equal(isConfinedToTmp("chmod 600 /private/tmp/pi-test"), true);
	assert.equal(isConfinedToTmp("rm -rf /tmp/pi-test relative"), false);
	assert.equal(isConfinedToTmp("rm -rf $TMPDIR/pi-test"), false);
	assert.equal(isConfinedToTmp("sudo rm -rf /tmp/pi-test"), false);
	assert.equal(isConfinedToTmp("rm -rf /tmp/pi-test/../../outside"), false);
	assert.equal(isConfinedToTmp("rm -rf /tmp/pi-*"), false);
	assert.equal(isConfinedToTmp("rm -rf /tmp/pi-test; rm -rf /"), false);
	const root = mkdtempSync(join(tmpdir(), "pi-gate-"));
	symlinkSync("/", join(root, "escape"));
	assert.equal(isConfinedToTmp(`rm -rf ${join(root, "escape", "etc")}`), false);
	rmSync(root, { recursive: true, force: true });
});
