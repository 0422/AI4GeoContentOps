# 2026-10-24：本次修改原因：把已批准蓝图的冻结 DDL 生成为独立的 Alembic 快照与显式 ORM 声明，避免手工抄写 34 张表时遗漏字段。
"""One-time Stage 2A source generator; it never opens the business database."""

from pathlib import Path
import re
import sqlite3


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
blueprint = (ROOT / "docs/architecture/AI4Geo-Refactor-Blueprint.md").read_text(encoding="utf-8")
start = blueprint.index("CREATE TABLE content_options")
end = blueprint.index("```", start)
ddl = blueprint[start:end].strip()

# 2026-10-24：本次修改原因：修订指针必须由同一篇文章的修订组成，冻结选样与分析输入封存须有可验证状态。
if "current_revision_id TEXT" not in ddl:
    ddl = ddl.replace(
        "current_revision_no INTEGER NOT NULL,\n  field_provenance_json",
        "current_revision_no INTEGER NOT NULL, current_revision_id TEXT,\n"
        "  field_provenance_json",
    )
if "FOREIGN KEY(id, current_revision_id)" not in ddl:
    ddl = ddl.replace(
        "collected_at TEXT, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL\n);",
        "collected_at TEXT, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,\n"
        "  FOREIGN KEY(id, current_revision_id) REFERENCES article_revisions(article_id, id)\n);",
        1,
    )
if "UNIQUE(article_id, id)" not in ddl:
    ddl = ddl.replace(
        "created_at TEXT NOT NULL, UNIQUE(article_id, revision_number)\n);",
        "created_at TEXT NOT NULL, UNIQUE(article_id, revision_number),\n"
        "  UNIQUE(article_id, id)\n);",
        1,
    )
if "status TEXT NOT NULL DEFAULT 'selection_building'" not in ddl:
    ddl = ddl.replace(
        "frozen_at TEXT NOT NULL, UNIQUE(collection_id, version_number)",
        "frozen_at TEXT, status TEXT NOT NULL DEFAULT 'selection_building',\n"
        "  sealed_at TEXT, row_version INTEGER NOT NULL DEFAULT 1,\n"
        "  UNIQUE(collection_id, version_number)",
    )

snapshot = BACKEND / "alembic/versions/20261024_01_stage2a_schema.sql"
snapshot.parent.mkdir(parents=True, exist_ok=True)
snapshot.write_text(
    "-- 2026-10-24：本次修改原因：将 Stage 2A 目标表、约束和索引冻结为首个版本化迁移。\n"
    + ddl + "\n", encoding="utf-8"
)

conn = sqlite3.connect(":memory:")
conn.executescript(ddl)
tables = re.findall(r"CREATE TABLE ([a-z_]+) \(", ddl)
domain = {
    "content_options": "Infrastructure", "brands": "Brand Library", "llm_settings": "Infrastructure",
    "discovery_sessions": "Reference Library", "discovery_fetches": "Reference Library",
    "discovery_candidates": "Reference Library", "articles": "Reference Library",
    "article_sources": "Reference Library", "article_source_payloads": "Reference Library",
    "rights_decisions": "Reference Library", "article_metrics": "Reference Library",
    "article_revisions": "Reference Library", "prepared_articles": "Reference Library",
    "article_collections": "Reference Library", "article_collection_items": "Reference Library",
    "article_collection_snapshots": "Reference Library",
    "article_collection_snapshot_items": "Reference Library",
    "article_collection_snapshot_features": "Reference Library",
    "article_features": "Content Intelligence", "style_profiles": "Content Intelligence",
    "style_profile_versions": "Content Intelligence", "style_profile_inputs": "Content Intelligence",
    "performance_analyses": "Content Intelligence", "performance_analysis_samples": "Content Intelligence",
    "content_strategies": "Content Strategy", "content_strategy_versions": "Content Strategy",
    "strategy_article_refs": "Content Strategy", "processing_jobs": "Infrastructure",
    "generated_documents": "Content Studio", "generated_revisions": "Content Studio",
    "evaluation_runs": "Evaluation", "legacy_id_map": "Infrastructure",
    "legacy_payload_archive": "Infrastructure", "data_disposition_events": "Infrastructure",
}
assert set(tables) == set(domain), set(tables) ^ set(domain)

out = [
    "# 2026-10-24：本次修改原因：建立与 Alembic 冻结 DDL 对应的 Stage 2A 领域 ORM，不复用旧库 Base。",
    '"""Stage 2A target ORM. Classes are grouped by their domain docstrings."""',
    "from sqlalchemy import ForeignKey, ForeignKeyConstraint, Integer, Text, UniqueConstraint, Index, text",
    "from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column",
    "",
    "class TargetBase(DeclarativeBase):",
    "    pass",
    "",
]
for table in tables:
    columns = conn.execute(f"PRAGMA table_info({table})").fetchall()
    fks = conn.execute(f"PRAGMA foreign_key_list({table})").fetchall()
    fk_groups = {}
    for fk in fks:
        fk_groups.setdefault(fk[0], []).append(fk)
    single_fks = {group[0][3]: group[0] for group in fk_groups.values() if len(group) == 1}
    composite_fks = [group for group in fk_groups.values() if len(group) > 1]
    constraints = []
    for group in composite_fks:
        group.sort(key=lambda item: item[1])
        local = [item[3] for item in group]
        remote = [f"{item[2]}.{item[4]}" for item in group]
        constraints.append(f"ForeignKeyConstraint({local!r}, {remote!r})")
    for idx in conn.execute(f"PRAGMA index_list({table})"):
        if idx[3] != "u":
            continue
        names = [row[2] for row in conn.execute(f"PRAGMA index_info({idx[1]})")]
        constraints.append(f"UniqueConstraint({', '.join(repr(x) for x in names)})")
    cls = "".join(part.capitalize() for part in table.split("_"))
    out.extend([f"# 2026-10-24：本次修改原因：{domain[table]} 目标实体字段与约束采用统一数据库契约。", f"class {cls}(TargetBase):", f"    __tablename__ = {table!r}", f"    __doc__ = {domain[table]!r}"])
    if constraints:
        out.append("    __table_args__ = (" + ", ".join(constraints) + ",)")
    for _, name, datatype, notnull, default, pk in columns:
        typ = "Integer" if datatype.upper() == "INTEGER" else "Text"
        annotation = "int" if typ == "Integer" else "str"
        if not notnull and not pk:
            annotation += " | None"
        args = [typ]
        if name in single_fks:
            fk = single_fks[name]
            fk_args = [repr(f"{fk[2]}.{fk[4]}")]
            if fk[6] != "NO ACTION":
                fk_args.append(f"ondelete={fk[6]!r}")
            args.append("ForeignKey(" + ", ".join(fk_args) + ")")
        kwargs = [f"primary_key={bool(pk)}", f"nullable={not bool(notnull or pk)}"]
        if default is not None:
            kwargs.append(f"server_default=text({default!r})")
        out.append(f"    {name}: Mapped[{annotation}] = mapped_column({', '.join(args + kwargs)})")
    out.append("")

for statement in re.findall(r"CREATE (?:UNIQUE )?INDEX .*?;", ddl, re.S):
    match = re.match(r"CREATE (UNIQUE )?INDEX (\w+) ON (\w+)\((.*?)\)(?:\s+WHERE (.*?))?;", statement, re.S)
    if not match:
        raise ValueError(statement)
    unique, name, table, cols, where = match.groups()
    cls = "".join(part.capitalize() for part in table.split("_"))
    args = [repr(name)] + [f"{cls}.{col.strip()}" for col in cols.split(",")]
    if unique:
        args.append("unique=True")
    if where:
        args.extend([f"sqlite_where=text({where.strip()!r})", f"postgresql_where=text({where.strip()!r})"])
    out.append("Index(" + ", ".join(args) + ")")

target = BACKEND / "app/infrastructure/database/target_models.py"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text("\n".join(out) + "\n", encoding="utf-8")
print(f"Generated {len(tables)} ORM entities and frozen SQL at {target} and {snapshot}")
