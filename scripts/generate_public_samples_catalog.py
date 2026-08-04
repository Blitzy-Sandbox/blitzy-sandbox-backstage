#!/usr/bin/env python3
"""
Generates catalog-blitzy-public-samples.yaml — one static Backstage catalog
file containing every repo in the `blitzy-public-samples` GitHub org as a
Component, grouped under a single System.

Unlike create_catalog_entries.py, this script writes NOTHING to GitHub. It
produces a single file in this repo, which is ingested via a static file
location in app-config.yaml. This avoids needing push access to the org.

Usage:
    GITHUB_TOKEN=<token> python3 scripts/generate_public_samples_catalog.py
    GITHUB_TOKEN=<token> python3 scripts/generate_public_samples_catalog.py --dry-run
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import urllib.error

try:
    import yaml
except ImportError:
    print("ERROR: pyyaml not installed. Run: pip install pyyaml", file=sys.stderr)
    sys.exit(1)

ORG = "blitzy-public-samples"
SYSTEM = "blitzy-public-samples"
GROUP = "blitzy-samples"
OUTPUT_FILE = "catalog-blitzy-public-samples.yaml"

GITHUB_LANG_TO_TAG: dict[str, str] = {
    "TypeScript": "typescript",
    "JavaScript": "javascript",
    "Python":     "python",
    "Go":         "go",
    "Java":       "java",
    "Rust":       "rust",
    "C":          "c",
    "C++":        "cpp",
    "C#":         "csharp",
    "PHP":        "php",
    "Ruby":       "ruby",
    "Kotlin":     "kotlin",
    "Swift":      "swift",
    "Shell":      "shell",
    "Solidity":   "solidity",
    "HTML":       "html",
    "CSS":        "css",
}

ENTITY_NAME_RE = re.compile(r"[^a-zA-Z0-9_.\-]")


def gh(path: str, token: str):
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def list_org_repos(org: str, token: str) -> list[dict]:
    repos, page = [], 1
    while True:
        batch = gh(f"/orgs/{org}/repos?per_page=100&page={page}&type=all", token)
        if not batch:
            break
        repos.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return repos


def get_top_language(org: str, repo: str, token: str) -> str | None:
    try:
        langs = gh(f"/repos/{org}/{repo}/languages", token)
    except urllib.error.HTTPError:
        return None
    if not langs:
        return None
    return max(langs, key=langs.get)


def safe_entity_name(name: str) -> str:
    normalized = ENTITY_NAME_RE.sub("-", name).lower()
    normalized = re.sub(r"-+", "-", normalized).strip("-.")
    return normalized[:63] or "unnamed"


def strip_fork_prefix(description: str) -> str:
    for prefix in ["Blitzy fork of ", "Blitzy fork - ", "blitzy fork of ", "blitzy fork - "]:
        if description.lower().startswith(prefix.lower()):
            return description[len(prefix):]
    return description


def build_component(repo: dict, token: str, org: str) -> dict:
    name = repo["name"]
    default_branch = repo["default_branch"]
    description = strip_fork_prefix((repo.get("description") or "").strip())

    github_lang = repo.get("language") or get_top_language(org, name, token)
    language_tag = GITHUB_LANG_TO_TAG.get(github_lang) if github_lang else None

    topics = repo.get("topics") or []
    tags = sorted({t for t in topics if re.fullmatch(r"[a-z0-9+#\-]+", t)} | ({language_tag} if language_tag else set()))

    entity: dict = {
        "apiVersion": "backstage.io/v1alpha1",
        "kind": "Component",
        "metadata": {
            "name": safe_entity_name(name),
            "title": name,
            "description": description or f"Blitzy public sample: {name}",
            "tags": tags,
            "annotations": {
                "github.com/project-slug": f"{org}/{name}",
                "backstage.io/source-location": f"url:https://github.com/{org}/{name}/tree/{default_branch}/",
            },
        },
        "spec": {
            "type": "sample",
            "lifecycle": "experimental",
            "owner": GROUP,
            "system": SYSTEM,
        },
    }

    if language_tag:
        entity["metadata"]["labels"] = {"blitzy.com/language": language_tag}

    return entity


def build_group() -> dict:
    return {
        "apiVersion": "backstage.io/v1alpha1",
        "kind": "Group",
        "metadata": {
            "name": GROUP,
            "description": "Owner group for Blitzy public sample projects generated on the Blitzy Platform",
        },
        "spec": {
            "type": "team",
            "children": [],
        },
    }


def build_system() -> dict:
    return {
        "apiVersion": "backstage.io/v1alpha1",
        "kind": "System",
        "metadata": {
            "name": SYSTEM,
            "description": "Blitzy Platform public sample projects — https://github.com/blitzy-public-samples",
            "tags": ["samples", "blitzy-platform"],
        },
        "spec": {
            "owner": GROUP,
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--org", default=ORG)
    parser.add_argument("--output", default=OUTPUT_FILE)
    parser.add_argument("--dry-run", action="store_true", help="Print summary; do not write file")
    args = parser.parse_args()

    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        print("ERROR: GITHUB_TOKEN is not set.", file=sys.stderr)
        sys.exit(1)

    print(f"Fetching repos in {args.org} ...")
    repos = list_org_repos(args.org, token)
    print(f"  {len(repos)} repos discovered")

    documents = [build_group(), build_system()]

    langs_resolved = 0
    langs_missing = 0
    for i, repo in enumerate(repos, 1):
        entity = build_component(repo, token, args.org)
        if entity["metadata"].get("labels", {}).get("blitzy.com/language"):
            langs_resolved += 1
        else:
            langs_missing += 1
        documents.append(entity)
        if i % 25 == 0:
            print(f"  processed {i}/{len(repos)}")
        time.sleep(0.05)

    print()
    print("=" * 60)
    print(f"Group:      1 ({GROUP})")
    print(f"System:     1 ({SYSTEM})")
    print(f"Components: {len(repos)}")
    print(f"  with language tag: {langs_resolved}")
    print(f"  without language:  {langs_missing}")
    print("=" * 60)

    if args.dry_run:
        print("\nDRY RUN — no file written")
        return

    with open(args.output, "w", encoding="utf-8") as f:
        f.write("# Auto-generated by scripts/generate_public_samples_catalog.py\n")
        f.write(f"# Source: https://github.com/{args.org}\n")
        f.write("# Re-run the script to refresh. Do not hand-edit.\n")
        yaml.dump_all(documents, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
    print(f"\nWrote {args.output}")


if __name__ == "__main__":
    main()
