#!/usr/bin/env python3
"""Disposable-HOME first-use tests; never touch real Pi state."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

SEED = Path(__file__).with_name("pi-seed.sh")


class SeedTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.agent = self.root / "home/.config/pi-config/agent"
        self.settings = self.root / "settings"
        self.keys = self.root / "keys"
        self.settings.write_text('{"packages": []}')
        self.keys.write_text("{}")
        self.runtime = self.root / "runtime"
        (self.runtime / "node_modules/sample").mkdir(parents=True)
        (self.runtime / "node_modules/sample/index.js").write_text("test")
        for name in ("package.json", "package-lock.json"):
            (self.runtime / name).write_text("{}")

    def run_seed(self, success=True, dry=False):
        env = dict(os.environ, HOME=str(self.root / "home"))
        env.pop("DRY_RUN", None)
        if dry:
            env["DRY_RUN"] = "1"
        result = subprocess.run(["bash", str(SEED), str(self.agent), str(self.settings),
                                 str(self.keys), str(self.runtime)], env=env,
                                text=True, capture_output=True)
        if success:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Pi seed collision", result.stderr)
        return result

    def test_seed_repeat_and_existing_user_changes(self):
        self.run_seed()
        self.assertEqual((self.agent / "settings.json").stat().st_mode & 0o777, 0o600)
        (self.agent / "settings.json").write_text("user")
        (self.agent / "npm/package-lock.json").write_text("user-lock")
        self.run_seed()
        self.assertEqual((self.agent / "settings.json").read_text(), "user")
        self.assertEqual((self.agent / "npm/package-lock.json").read_text(), "user-lock")

    def test_dry_run_creates_nothing(self):
        self.run_seed(dry=True)
        self.assertFalse(self.agent.exists())

    def test_dangling_leaf_symlinks_never_write_targets(self):
        for name in ("settings.json", "keybindings.json", "npm"):
            with self.subTest(name=name):
                self.agent.mkdir(parents=True, exist_ok=True)
                path = self.agent / name
                target = self.root / ("missing-" + name)
                path.symlink_to(target)
                self.run_seed(success=False)
                self.assertFalse(target.exists())
                self.assertFalse((self.agent / "npm").exists())
                path.unlink()

    def test_parent_symlink_rejected(self):
        self.agent.parent.mkdir(parents=True)
        elsewhere = self.root / "elsewhere"
        elsewhere.mkdir()
        self.agent.symlink_to(elsewhere)
        self.run_seed(success=False)
        self.assertEqual(list(elsewhere.iterdir()), [])

    def test_conflicting_directory_preflight_is_nonmutating(self):
        (self.agent / "keybindings.json").mkdir(parents=True)
        self.run_seed(success=False)
        self.assertFalse((self.agent / "settings.json").exists())

    def test_partial_npm_preserved(self):
        (self.agent / "npm").mkdir(parents=True)
        (self.agent / "npm/package-lock.json").write_text("partial")
        self.run_seed(success=False)
        self.assertEqual((self.agent / "npm/package-lock.json").read_text(), "partial")
        self.assertFalse((self.agent / "settings.json").exists())

    def test_npm_symlink_and_conflicting_file_rejected(self):
        (self.agent / "npm").mkdir(parents=True)
        for name in ("package.json", "package-lock.json"):
            (self.agent / "npm" / name).write_text("{}")
        (self.agent / "npm/node_modules").symlink_to(self.runtime / "node_modules")
        self.run_seed(success=False)
        self.assertFalse((self.agent / "settings.json").exists())


if __name__ == "__main__":
    unittest.main()
