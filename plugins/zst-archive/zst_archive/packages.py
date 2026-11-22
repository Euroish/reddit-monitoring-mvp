"""Discovery and manifest inspection for open-corpus-v1 monthly packages."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class MonthPackage:
    month: str
    root: Path
    posts_parquet: Path
    comments_parquet: Path
    ledger_parquet: Path | None
    fts_shards: tuple[Path, ...]
    manifest: dict[str, Any]


def _load_single_package(package_dir: Path) -> MonthPackage | None:
    manifest_path = package_dir / "manifest.json"
    posts_p = package_dir / "corpus" / "posts.parquet"
    comments_p = package_dir / "corpus" / "comments.parquet"
    ledger_p = package_dir / "base" / "population_ledger.parquet"
    if not (manifest_path.exists() and posts_p.exists() and comments_p.exists()):
        return None
    shards = tuple(sorted((package_dir / "index").glob("fts_*.sqlite")))
    if not shards:
        return None
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    month = str(manifest.get("month") or package_dir.name)
    return MonthPackage(
        month=month,
        root=package_dir.resolve(),
        posts_parquet=posts_p.resolve(),
        comments_parquet=comments_p.resolve(),
        ledger_parquet=ledger_p.resolve() if ledger_p.exists() else None,
        fts_shards=tuple(s.resolve() for s in shards),
        manifest=manifest,
    )


def discover_packages(
    archive_root: Path | None = None,
    *,
    package_dir: Path | None = None,
    months: list[str] | None = None,
) -> list[MonthPackage]:
    """Find valid open-corpus-v1 packages filtered by optional month list."""
    selected = {m.strip() for m in (months or []) if m.strip()}
    found: list[MonthPackage] = []

    if package_dir is not None:
        pkg = _load_single_package(package_dir)
        if pkg is None:
            raise FileNotFoundError(f"Invalid open-corpus-v1 package directory: {package_dir}")
        if not selected or pkg.month in selected:
            found.append(pkg)
        return found

    if archive_root is None:
        raise ValueError("Either archive_root or package_dir must be provided")
    root = archive_root.resolve()
    if not root.exists():
        raise FileNotFoundError(f"Archive root does not exist: {root}")

    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        pkg = _load_single_package(child)
        if pkg is None:
            continue
        if selected and pkg.month not in selected:
            continue
        found.append(pkg)

    if selected:
        missing = sorted(selected - {p.month for p in found})
        if missing:
            raise FileNotFoundError(f"Requested months not found in {root}: {', '.join(missing)}")
    return found


def summarize_packages(packages: list[MonthPackage]) -> list[dict[str, Any]]:
    """Return compact inspection metadata for discovered packages."""
    summary: list[dict[str, Any]] = []
    for pkg in packages:
        counts = pkg.manifest.get("counts") or {}
        summary.append({
            "month": pkg.month,
            "policyVersion": pkg.manifest.get("policy_version"),
            "root": str(pkg.root),
            "postsRows": counts.get("posts_rows"),
            "commentsRows": counts.get("comments_rows"),
            "totalBytes": pkg.manifest.get("total_bytes"),
            "ftsShards": len(pkg.fts_shards),
        })
    return summary
