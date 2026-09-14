#!/usr/bin/env python3
"""Lossless tmux q/a -> NUL fields and NUL rows -> JSON arrays."""
from __future__ import annotations

import json
import sys

SEP = b"\x1f"
PUNCTUATION = b'''!"#$&'()*,-;<>?[]\\^`|{}'''
NAMED = {ord("a"): 7, ord("b"): 8, ord("f"): 12, ord("n"): 10,
         ord("r"): 13, ord("t"): 9, ord("v"): 11}


def decode_argument(encoded: bytes) -> bytes:
    if not encoded:
        return b""
    quote = 0
    body = encoded
    if encoded[0] in (ord("'"), ord('"')):
        quote = encoded[0]
        if len(encoded) < 2 or encoded[-1] != quote:
            raise ValueError("unterminated q/a argument")
        body = encoded[1:-1]
    elif b"'" in encoded or b'"' in encoded:
        raise ValueError("quote in bare q/a argument")
    out = bytearray()
    i = 0
    while i < len(body):
        char = body[i]
        if char != ord("\\"):
            if char < 0x20 or char == 0x7F or char == SEP[0]:
                raise ValueError("raw control in q/a argument")
            if quote and char == quote:
                raise ValueError("unescaped quote in q/a argument")
            if not quote and char == ord(" "):
                raise ValueError("space in bare q/a argument")
            out.append(char)
            i += 1
            continue
        i += 1
        if i >= len(body):
            raise ValueError("trailing backslash in q/a argument")
        char = body[i]
        if char in NAMED:
            out.append(NAMED[char])
        elif ord("0") <= char <= ord("7") and i + 2 < len(body) and all(ord("0") <= c <= ord("7") for c in body[i:i + 3]):
            out.append(int(body[i:i + 3], 8))
            i += 2
        elif char in PUNCTUATION:
            out.append(char)
        else:
            raise ValueError("invalid q/a escape")
        i += 1
    if b"\0" in out:
        raise ValueError("NUL is not representable in shell fields")
    return bytes(out)


def decode_records(field_count: int) -> None:
    for number, record in enumerate(sys.stdin.buffer.read().splitlines(), 1):
        if not record:
            continue
        fields = record.split(SEP)
        if len(fields) != field_count:
            raise ValueError(f"record {number}: got {len(fields)} fields, want {field_count}")
        for field in fields:
            sys.stdout.buffer.write(decode_argument(field) + b"\0")


def encode_rows(field_count: int) -> None:
    data = sys.stdin.buffer.read()
    if not data:
        return
    fields = data.split(b"\0")
    if fields[-1] != b"":
        raise ValueError("unterminated NUL field")
    fields.pop()
    if len(fields) % field_count:
        raise ValueError(f"got {len(fields)} fields, not a multiple of {field_count}")
    for offset in range(0, len(fields), field_count):
        row = [field.decode("utf-8") for field in fields[offset:offset + field_count]]
        print(json.dumps(row, ensure_ascii=False))


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] not in ("decode", "rows"):
        print("usage: tmux-snapshot-codec.py <decode|rows> <field-count>", file=sys.stderr)
        return 2
    count = int(sys.argv[2])
    if sys.argv[1] == "decode":
        decode_records(count)
    else:
        encode_rows(count)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, UnicodeError) as error:
        print(f"tmux-snapshot-codec: {error}", file=sys.stderr)
        raise SystemExit(1)
