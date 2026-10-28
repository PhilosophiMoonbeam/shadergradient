#!/usr/bin/env python3
"""Extract title and relative path from MDX/MD frontmatter.

Usage: parse-frontmatter.py <docs_dir>
Output: TSV lines of "relative_path\ttitle"
"""

import os
import re
import sys


def extract_title(path: str) -> str:
    with open(path) as f:
        text = f.read(1024)
    m = re.search(r"^title:\s*['\"]?(.+?)['\"]?\s*$", text, re.M)
    if m:
        return m.group(1).strip().strip("'\"")
    # Fallback: derive from filename
    name = os.path.basename(path).rsplit(".", 1)[0]
    return name.replace("-", " ").title()


def main() -> None:
    docs_dir = sys.argv[1]
    for root, _dirs, files in os.walk(docs_dir):
        for fname in sorted(files):
            if not fname.endswith((".md", ".mdx")):
                continue
            full = os.path.join(root, fname)
            rel = os.path.relpath(full, docs_dir)
            title = extract_title(full)
            print(f"{rel}\t{title}")


if __name__ == "__main__":
    main()
