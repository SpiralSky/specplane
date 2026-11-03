#!/usr/bin/env python3
"""Reject identifying home paths in tracked documentation without printing them."""

import argparse
from pathlib import Path
import re
import subprocess


HOME = re.compile(r"(?:/home/|/Users/|[A-Za-z]:[\\/]+Users[\\/]+)([^/\\\s\"'<>`:;,)}\]]+)")
EXAMPLES = {"user", "username", "example", "test", "alice", "bob"}


def identifying(line):
    return any(match.group(1).lower() not in EXAMPLES for match in HOME.finditer(line))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        for text in ("/home/private-person/project", "/Users/private-person/project",
                     r"C:\Users\private-person\project", r"C:\\Users\\private-person\\project"):
            assert identifying(text), text
        for text in ("/home/user/project", "/Users/<username>/project",
                     "<workspace>/project", "/workspace/project", "person@example.com"):
            assert not identifying(text), text
        print("check-personal-paths: self-test passed")
        return 0
    root = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip())
    paths = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
    failures = []
    for name in paths:
        if not name or not (name.startswith("docs/") or name.endswith(".md")):
            continue
        file = root / name
        if not file.is_file() or file.is_symlink():
            continue
        for number, line in enumerate(file.read_text(errors="replace").splitlines(), 1):
            if identifying(line):
                failures.append(f"{name}:{number}: identifying home path; use a portable reference")
    print("\n".join(failures) if failures else "check-personal-paths: OK")
    return int(bool(failures))


if __name__ == "__main__":
    raise SystemExit(main())
