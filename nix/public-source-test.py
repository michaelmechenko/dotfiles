#!/usr/bin/env python3
"""Synthetic export/recovery fixtures. No runtime/home/private files are read."""
import importlib.util
import json
import os
import sys
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("public_source", Path(__file__).with_name("public-source.py"))
assert spec is not None and spec.loader is not None
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / "source"
        self.root.mkdir()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        self.put("flake.nix", "{}")
        self.put("nix/example", "public")
        for name in ["auth.json", "mcp.json", "mcp-auth.json", "mcp-cache.json", "plan-mode.json"]:
            self.put("pi-config/agent/" + name, "FAKE_SECRET")
        for name in ["sessions/private", "intercom/private", "npm/package.json", "logs/private"]:
            self.put("pi-config/agent/" + name, "FAKE_SECRET")
        self.put("pi-config/agent/extensions/sample/node_modules/private", "FAKE_SECRET")
        self.put("nix/unreviewed", "FAKE_SECRET", tracked=False)
        for name in [".env", ".env.local", "credentials.json", "credential.json",
                     "private.key", "private-key.txt", "private_key.json", "cert.pem", "cert.crt",
                     "certificate.cer", "identity.p8", "private.keystore", "id_ed25519"]:
            self.put("nix/" + name, "FAKE_SECRET")
        self.dest = self.base / "snapshot"

    def put(self, name, text, tracked=True):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        if tracked:
            subprocess.run(["git", "-C", str(self.root), "add", "-f", "--", name], check=True)
        return path

    def export(self):
        return source.snapshot(self.root, self.dest, [])

    def test_fail_closed_inventory(self):
        entries = self.export()
        self.assertEqual(set(entries), {"flake.nix", "nix", "nix/example"})
        source.verify(self.dest, source.load(self.dest))
        self.assertNotIn("FAKE_SECRET", json.dumps(entries))
        self.assertFalse((self.dest / "pi-config").exists())

    def test_explicit_addition_and_private_rejection(self):
        self.put("nix/reviewed", "reviewed", tracked=False)
        entries = source.snapshot(self.root, self.dest, ["nix/reviewed"])
        self.assertIn("nix/reviewed", entries)
        with self.assertRaises(ValueError):
            source.snapshot(self.root, self.base / "other", ["pi-config/agent/mcp-auth.json"])

    def test_missing_tracked_file_fails(self):
        (self.root / "nix/example").unlink()
        with self.assertRaises(FileNotFoundError):
            self.export()

    def test_symlinks_and_drift(self):
        (self.root / "nix/link").symlink_to("example")
        subprocess.run(["git", "-C", str(self.root), "add", "nix/link"], check=True)
        self.export()
        self.assertEqual(source.load(self.dest)["nix/link"]["target"], "example")
        (self.dest / "nix/link").unlink()
        (self.dest / "nix/link").symlink_to("../flake.nix")
        with self.assertRaises(ValueError):
            source.verify(self.dest, source.load(self.dest))

    def test_external_link_and_link_parent_rejected(self):
        (self.root / "nix/link").symlink_to("/etc/passwd")
        subprocess.run(["git", "-C", str(self.root), "add", "nix/link"], check=True)
        with self.assertRaises(ValueError):
            self.export()
        (self.root / "nix/link").unlink()
        (self.root / "nix/parent").symlink_to(self.base)
        with self.assertRaises(ValueError):
            source.record(self.root, "nix/parent/anything")

    def test_unexpected_paths_checked_before_contents(self):
        entries = self.export()
        (self.dest / "nix/unexpected").symlink_to("/etc/passwd")
        with patch.object(source, "record", side_effect=AssertionError("must not read")):
            with self.assertRaises(ValueError):
                source.verify(self.dest, entries)

    def test_file_bytes_and_permissions_drift(self):
        entries = self.export()
        (self.dest / "nix/example").write_text("edited")
        with self.assertRaises(ValueError):
            source.verify(self.dest, entries)
        (self.dest / "nix/example").write_text("public")
        (self.dest / "nix/example").chmod(0o755)
        with self.assertRaises(ValueError):
            source.verify(self.dest, entries)

    def test_verified_promotion_and_retained_previous(self):
        self.export()
        target = self.base / "current"
        source.snapshot(self.root, target, [])
        source.promote(self.dest, target)
        source.verify(target, source.load(target))
        source.verify(self.base / "current.previous", source.load(self.base / "current.previous"))
        stage = self.base / "next"
        source.snapshot(self.root, stage, [])
        with self.assertRaises(ValueError):
            source.promote(stage, target)

    def test_drift_legacy_and_invalid_stage_never_replace_current(self):
        self.export()
        target = self.base / "current"
        source.snapshot(self.root, target, [])
        (target / "nix/example").write_text("user-edit")
        with self.assertRaises(ValueError):
            source.promote(self.dest, target)
        self.assertEqual((target / "nix/example").read_text(), "user-edit")
        (target / source.MANIFEST).unlink()
        with self.assertRaises(ValueError):
            source.promote(self.dest, target)

    def test_failed_second_rename_restores_current(self):
        self.export()
        target = self.base / "current"
        source.snapshot(self.root, target, [])
        rename = Path.rename
        def fail_stage(path, destination):
            if path == self.dest:
                raise OSError("synthetic interrupted promotion")
            return rename(path, destination)
        with patch.object(Path, "rename", fail_stage):
            with self.assertRaises(OSError):
                source.promote(self.dest, target)
        source.verify(target, source.load(target))
        self.assertTrue(self.dest.is_dir())

    def test_deploy_cli_forwards_reviewed_additions_without_network(self):
        self.put("nix/public-source.py", Path(__file__).with_name("public-source.py").read_text())
        self.put("nix/deploy.sh", Path(__file__).with_name("deploy.sh").read_text())
        self.put("nix/reviewed", "reviewed", tracked=False)
        fakebin = self.base / "fakebin"
        fakebin.mkdir()
        (fakebin / "ssh").write_text(
            "#!" + sys.executable + "\nimport subprocess,sys\n"
            "assert 'StrictHostKeyChecking=yes' in sys.argv\n"
            "sys.exit(subprocess.run(['bash','-c',sys.argv[-1]], stdin=sys.stdin).returncode)\n")
        (fakebin / "rsync").write_text(
            "#!" + sys.executable + "\nimport shutil,sys\n"
            "shutil.copytree(sys.argv[-2],sys.argv[-1].split(':',1)[1],dirs_exist_ok=True)\n")
        for file in fakebin.iterdir():
            file.chmod(0o755)
        target = self.base / "deployed"
        env = dict(os.environ, PATH=str(fakebin) + ":" + os.environ["PATH"],
                   NIXOS_HOST="fixture", NIXOS_CONFIG_DIR=str(target), NIXOS_IDENTITY="/fixture")
        result = subprocess.run(["bash", str(self.root / "nix/deploy.sh"),
                                 "--include", "nix/reviewed"], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        source.verify(target, source.load(target))
        self.assertEqual((target / "nix/reviewed").read_text(), "reviewed")
        self.assertFalse((target / "nix/.env").exists())

    def test_live_manifest_detects_edit_addition_and_link(self):
        for name in source.LIVE_PATHS:
            if "." in Path(name).name or name in ("zshrc", "tmux.conf"):
                self.put(name, "live")
            else:
                self.put(name + "/file", "live")
        entries = source.inventory(self.root, source.names(self.root, source.LIVE_PATHS))
        source.verify(self.root, entries, live=True)
        (self.root / "zed/empty").mkdir()
        source.verify(self.root, entries, live=True)
        self.put("zed/new", "new", tracked=False)
        with self.assertRaises(ValueError):
            source.verify(self.root, entries, live=True)
        (self.root / "zed/new").unlink()
        (self.root / "zed/file").write_text("changed")
        with self.assertRaises(ValueError):
            source.verify(self.root, entries, live=True)


if __name__ == "__main__":
    unittest.main()
