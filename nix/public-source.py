#!/usr/bin/env python3
"""Public Nix source snapshots, exact inventories, and build-bound live checks.

Never walk a runtime root when exporting: candidates come from Git plus explicit
reviewed additions. Verification compares names/types before reading file bytes.
"""
import argparse
import fnmatch
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import sys
import tempfile

MANIFEST = ".public-source.json"
LIVE_PATHS = (
    "zshrc", "tmux.conf", "nvim", "zed", "pi-config/agent/AGENTS.md",
    "pi-config/agent/agents", "pi-config/agent/prompts", "pi-config/agent/skills",
    "pi-config/agent/pi-lens-global.json",
)
FILES = {
    "flake.nix", "flake.lock", "zshrc", "tmux.conf", "KEYBINDS.md",
    "pi-config/README.md", "pi-config/check.mjs", "ohmyposh/base.json",
    "qol_scripts/copy", "qol_scripts/pasta", "theme/palettes/vague.json",
    "pi-config/agent/AGENTS.md", "pi-config/agent/settings.json",
    "pi-config/agent/keybindings.json", "pi-config/agent/pi-lens-global.json",
}
TREES = (
    "nix/", "nvim/", "zed/", "tmux_scripts/", "tmux_plugins/", "nnn/",
    "theme/bundles/vague/", "pi-config/agent/agents/",
    "pi-config/agent/prompts/", "pi-config/agent/skills/",
    "pi-config/agent/extensions/",
)
PRIVATE_PARTS = {
    ".git", "node_modules", "__pycache__", ".pytest_cache", ".cache",
    "auth.json", "mcp.json", "mcp-auth.json", "mcp-cache.json", "sessions",
    "cache", "logs", "intercom", "npm", "backups", "telemetry",
    "plan-mode.json", "zshrc.local", "credentials.json", "credentials",
    ".ssh", ".gnupg", ".aws", ".kube",
}


def public(name):
    path = PurePosixPath(name)
    return (
        not path.is_absolute() and str(path) == name
        and not any(part in ("", ".", "..") or part in PRIVATE_PARTS for part in path.parts)
        and not name.endswith((".bak", ".log", ".pyc", ".before-home-manager"))
        and not any(fnmatch.fnmatch(part.lower(), pattern)
                    for part in path.parts
                    for pattern in (".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx",
                                    "*.crt", "*.cer", "*.der", "*.p7b", "*.p7c", "*.p8", "*.jks", "*.keystore",
                                    "credential*", "private-key*", "private_key*", "id_rsa*", "id_ed25519*"))
        and (name in FILES or name.startswith(TREES))
    )


def no_link_parents(root, name):
    for parent in PurePosixPath(name).parents:
        if parent != PurePosixPath(".") and (root / str(parent)).is_symlink():
            raise ValueError(f"symlink parent is not allowed: {name}")


def record(root, name, content=True):
    no_link_parents(root, name)
    path = root / name
    mode = path.lstat().st_mode
    if stat.S_ISLNK(mode):
        target = os.readlink(path)
        resolved = (path.parent / target).resolve()
        if Path(target).is_absolute() or not resolved.is_relative_to(root.resolve()):
            raise ValueError(f"external symlink: {name}")
        relative = resolved.relative_to(root.resolve()).as_posix()
        if not public(relative) or not resolved.exists():
            raise ValueError(f"non-public or dangling symlink: {name}")
        return {"type": "link", "target": target}
    if stat.S_ISREG(mode):
        value = {"type": "file", "executable": bool(mode & 0o111)}
        if content:
            value["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        return value
    if stat.S_ISDIR(mode):
        return {"type": "directory"}
    raise ValueError(f"unsupported file type: {name}")


def names(root, starts=None):
    """Enumerate names only, never follow symlinks or open unreviewed files."""
    found = []
    def visit(path):
        relative = path.relative_to(root).as_posix()
        if relative == MANIFEST:
            return
        if path.is_dir() and not path.is_symlink():
            before = len(found)
            for child in sorted(path.iterdir()):
                visit(child)
            # Git/Nix source inputs cannot retain untracked empty directories.
            # They have no live configuration content; export verification still
            # inventories them, so extra snapshot directories remain detectable.
            if starts is None or len(found) != before:
                found.append(relative)
        else:
            found.append(relative)
    for start in starts or sorted(p.name for p in root.iterdir() if p.name != MANIFEST):
        visit(root / start)
    return sorted(found)


def inventory(root, selected=None):
    selected = selected if selected is not None else names(root)
    return {name: record(root, name) for name in selected}


def verify(root, expected, live=False):
    actual = names(root, LIVE_PATHS if live else None)
    # Compare names first: never hash an unexpected file.
    if set(actual) != set(expected):
        raise ValueError("source inventory changed (missing or unexpected paths); review before continuing")
    for name in actual:
        if record(root, name) != expected[name]:
            raise ValueError(f"source content/type/target changed: {name}")


def snapshot(root, destination, additions):
    if destination.exists() or destination.is_symlink():
        raise ValueError("snapshot destination must be absent")
    tracked = subprocess.check_output(["git", "-C", str(root), "ls-files", "-z"]).decode().split("\0")
    for name in additions:
        if not public(name):
            raise ValueError(f"addition is outside the public policy: {name}")
    selected = sorted({name for name in tracked + additions if name and public(name)})
    entries = {}
    for name in selected:
        entries[name] = record(root, name)
        # Inventory all parent directories as well.
        for parent in PurePosixPath(name).parents:
            if parent != PurePosixPath("."):
                entries[str(parent)] = record(root, str(parent))
    # Every link must resolve into the exact exported inventory.
    for name, entry in entries.items():
        if entry["type"] == "link":
            resolved = (root / name).resolve().relative_to(root.resolve()).as_posix()
            if resolved not in entries:
                raise ValueError(f"symlink target is not exported: {name}")
    destination.mkdir(mode=0o700)
    for name in sorted(entries, key=lambda n: (len(PurePosixPath(n).parts), n)):
        entry = entries[name]
        target = destination / name
        if entry["type"] == "directory":
            target.mkdir(exist_ok=True)
        elif entry["type"] == "link":
            target.symlink_to(entry["target"])
        else:
            shutil.copyfile(root / name, target)
            target.chmod(0o755 if entry["executable"] else 0o644)
    (destination / MANIFEST).write_text(json.dumps(entries, sort_keys=True, indent=2) + "\n")
    verify(destination, entries)
    return entries


def load(root):
    manifest = root / MANIFEST
    if manifest.is_symlink() or not manifest.is_file():
        raise ValueError("snapshot has no trusted inventory; preserve it and migrate explicitly")
    value = json.loads(manifest.read_text())
    if not isinstance(value, dict):
        raise ValueError("invalid snapshot inventory")
    # Do not let a malformed manifest authorize traversal or secret reads.
    for name in value:
        if not public(name) and not public(name + "/placeholder") and not any(p.startswith(name + "/") for p in FILES | set(TREES)):
            raise ValueError("inventory contains an unsafe path")
        if PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts:
            raise ValueError("inventory traversal")
    return value


def remote_target(target):
    if not target.is_absolute() or target.parent == target or target.is_symlink():
        raise ValueError("target must be an absolute non-symlink snapshot directory")
    if not target.parent.is_dir():
        raise ValueError("target parent must already exist")
    if target.exists():
        if not target.is_dir():
            raise ValueError("target is not a directory")
        verify(target, load(target))


def promote(stage, target):
    remote_target(target)
    previous = target.with_name(target.name + ".previous")
    if previous.exists() or previous.is_symlink():
        raise ValueError("previous snapshot exists; preserve/rotate it explicitly before deploying again")
    if stage.is_symlink() or stage.parent.resolve() != target.parent.resolve():
        raise ValueError("stage must be a real sibling directory")
    verify(stage, load(stage))
    lock = target.with_name("." + target.name + ".deploy-lock")
    lock.mkdir(mode=0o700)  # No concurrent promotion, including stale crash locks.
    try:
        remote_target(target)  # Recheck drift under the lock.
        if target.exists():
            target.rename(previous)
        try:
            stage.rename(target)
        except BaseException:
            if previous.exists() and not target.exists():
                previous.rename(target)
            raise
    finally:
        lock.rmdir()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["snapshot", "verify", "live-manifest", "verify-live", "remote-stage", "promote"])
    parser.add_argument("root", type=Path)
    parser.add_argument("other", nargs="?", type=Path)
    parser.add_argument("--include", action="append", default=[])
    args = parser.parse_args()
    root = args.root.absolute()
    try:
        if args.action == "snapshot":
            if args.other is None:
                raise ValueError("snapshot needs a destination")
            snapshot(root, args.other.absolute(), args.include)
        elif args.action == "verify":
            verify(root, load(root))
        elif args.action == "live-manifest":
            selected = names(root, LIVE_PATHS)
            if not all(public(name) or name in LIVE_PATHS for name in selected):
                raise ValueError("non-public live source")
            print(json.dumps(inventory(root, selected), sort_keys=True, indent=2))
        elif args.action == "verify-live":
            if args.other is None:
                raise ValueError("verify-live needs the build-bound manifest")
            verify(root, json.loads(args.other.read_text()), live=True)
        elif args.action == "remote-stage":
            remote_target(root)
            previous = root.with_name(root.name + ".previous")
            if previous.exists() or previous.is_symlink():
                raise ValueError("previous snapshot already exists; rotate it explicitly")
            print(tempfile.mkdtemp(prefix="." + root.name + ".incoming-", dir=root.parent))
        elif args.action == "promote":
            if args.other is None:
                raise ValueError("promote needs a target")
            promote(root, args.other.absolute())
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"STOP: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
