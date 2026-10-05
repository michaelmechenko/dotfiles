#!/usr/bin/env python3
"""Copy selected bytes with their common literal indentation removed."""

import argparse
import os
import subprocess
import sys


def dedent(data: bytes) -> bytes:
    # Split only at LF: splitlines() also splits content at other control bytes.
    lines = data.split(b"\n")
    prefixes = []
    for line in lines:
        body = line[:-1] if line.endswith(b"\r") else line
        if body.strip(b" \t"):
            prefixes.append(body[: len(body) - len(body.lstrip(b" \t"))])
    if not prefixes:
        return data
    prefix = os.path.commonprefix(prefixes)
    if not prefix:
        return data
    result = []
    for line in lines:
        count = 0
        while count < min(len(prefix), len(line)) and line[count] == prefix[count]:
            count += 1
        result.append(line[count:])
    return b"\n".join(result)


def copy(data: bytes, socket: str, client: str) -> None:
    tmux = ["tmux", "-S", socket]
    # One automatic buffer, never a rewrite of a possibly unrelated latest buffer.
    command = tmux + ["load-buffer"]
    if client:
        command += ["-w", "-t", client]
    subprocess.run(command + ["-"], input=data, check=True)
    subprocess.run(
        [os.path.expanduser("~/.config/qol_scripts/copy")], input=data, check=True
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("socket")
    parser.add_argument("client", nargs="?", default="")
    args = parser.parse_args()
    try:
        copy(dedent(sys.stdin.buffer.read()), args.socket, args.client)
    except (OSError, subprocess.CalledProcessError):
        message = "Dedented copy failed; check clipboard helper and tmux client."
        print(message, file=sys.stderr)
        if args.client:
            try:
                subprocess.run(
                    ["tmux", "-S", args.socket, "display-message", "-c", args.client, message],
                    check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
            except OSError:
                pass
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
