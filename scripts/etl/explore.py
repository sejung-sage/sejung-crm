"""
세정학원 CRM · MSSQL 탐색 스크립트.

목적:
  - 4개 분원 MSSQL DB 에 접속 가능한지 검증.
  - 각 DB 의 테이블 목록 + 행 수 dump.
  - 학생/출석/결제/강사 등 핵심 테이블의 컬럼 schema dump.

결과는 scripts/etl/explore_output/ 폴더에 저장 (gitignore).
운영팀에 공유 또는 매핑 결정 input 으로 사용.

실행:
  source .venv/bin/activate
  python scripts/etl/explore.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pymssql  # type: ignore
from dotenv import load_dotenv

# .env 로드: scripts/etl/.env 우선, 없으면 프로젝트 루트의 .env.local fallback
PROJECT_ROOT = Path(__file__).parent.parent.parent
ENV_CANDIDATES = [
    Path(__file__).parent / ".env",
    PROJECT_ROOT / ".env.local",
]
for env_path in ENV_CANDIDATES:
    if env_path.exists():
        load_dotenv(env_path, override=False)

USER = os.getenv("ACA_MSSQL_USER", "sejung_user")
PASSWORD = os.getenv("ACA_MSSQL_PASSWORD", "")

if not PASSWORD:
    print("❌ ACA_MSSQL_PASSWORD 가 .env 에 없습니다. (scripts/etl/.env)")
    sys.exit(1)

DATABASES = [
    {"branch_name": "방배캠퍼스", "branch_id": "80205",
     "server": "117.52.92.212", "port": 14333, "database": "db31191"},
    {"branch_name": "대치본원", "branch_id": "78031",
     "server": "117.52.92.211", "port": 14333, "database": "db777164"},
    {"branch_name": "반포캠퍼스", "branch_id": "85489",
     "server": "117.52.92.211", "port": 14333, "database": "db777165"},
    {"branch_name": "송도캠퍼스", "branch_id": "85491",
     "server": "117.52.92.211", "port": 14333, "database": "db777166"},
]

OUTPUT_DIR = Path(__file__).parent / "explore_output"
OUTPUT_DIR.mkdir(exist_ok=True)


def explore(db_config: dict) -> None:
    """단일 DB 의 테이블 목록·컬럼 schema dump."""
    branch_label = f"{db_config['branch_name']} ({db_config['database']})"
    print(f"\n{'=' * 60}")
    print(f"📍 {branch_label}")
    print("=" * 60)

    out_file = OUTPUT_DIR / f"{db_config['branch_id']}_{db_config['database']}.md"

    try:
        conn = pymssql.connect(
            server=db_config["server"],
            port=db_config["port"],
            user=USER,
            password=PASSWORD,
            database=db_config["database"],
            timeout=10,
            charset="UTF-8",
        )
    except Exception as e:
        print(f"❌ 접속 실패: {e}")
        return

    try:
        cursor = conn.cursor(as_dict=True)

        # 1) 권한 진단 — INFORMATION_SCHEMA 로 모든 보이는 테이블/뷰 list
        cursor.execute(
            """
            SELECT
                TABLE_SCHEMA AS schema_name,
                TABLE_NAME   AS table_name,
                TABLE_TYPE   AS table_type
            FROM INFORMATION_SCHEMA.TABLES
            ORDER BY TABLE_SCHEMA, TABLE_NAME
            """
        )
        info_rows = cursor.fetchall()
        print(f"   INFORMATION_SCHEMA: {len(info_rows)} 객체 (table+view)")
        # 스키마별 분포
        schema_count: dict[str, int] = {}
        for r in info_rows:
            s = r["schema_name"]
            schema_count[s] = schema_count.get(s, 0) + 1
        for s, n in sorted(schema_count.items()):
            print(f"     schema {s}: {n}개")

        # 2) sys.tables 기반 행 수 (dbo 외 schema 도 포함)
        cursor.execute(
            """
            SELECT
                s.name AS schema_name,
                t.name AS table_name,
                SUM(p.rows) AS row_count
            FROM sys.tables t
            JOIN sys.schemas s ON s.schema_id = t.schema_id
            JOIN sys.partitions p ON p.object_id = t.object_id
            WHERE p.index_id IN (0, 1)
            GROUP BY s.name, t.name
            ORDER BY SUM(p.rows) DESC
            """
        )
        tables = cursor.fetchall()
        print(f"✅ 접속 성공 — sys.tables {len(tables)}개")

        with out_file.open("w", encoding="utf-8") as fp:
            fp.write(f"# {branch_label}\n\n")
            fp.write(f"## INFORMATION_SCHEMA · 모든 객체 ({len(info_rows)}개)\n\n")
            fp.write("| Schema | Name | Type |\n|---|---|---|\n")
            for r in info_rows:
                fp.write(
                    f"| {r['schema_name']} | {r['table_name']} | {r['table_type']} |\n"
                )

            fp.write(f"\n## sys.tables · 행 수 ({len(tables)}개)\n\n")
            fp.write("| Schema | Table | Rows |\n|---|---|--:|\n")
            for t in tables:
                fp.write(
                    f"| {t['schema_name']} | {t['table_name']} | {t['row_count']:,} |\n"
                )

            # 2) 모든 VIEW 의 컬럼 schema + 행 수
            #    sys.columns 는 권한 부족 가능 → INFORMATION_SCHEMA.COLUMNS 사용
            view_objects = [
                r for r in info_rows
                if r["table_type"] == "VIEW"
            ]
            fp.write(f"\n## VIEW 컬럼 + 행 수 ({len(view_objects)}개)\n")
            for vobj in view_objects:
                vname = vobj["table_name"]
                vschema = vobj["schema_name"]
                # 컬럼
                cursor.execute(
                    """
                    SELECT
                        COLUMN_NAME,
                        DATA_TYPE,
                        CHARACTER_MAXIMUM_LENGTH AS max_len,
                        IS_NULLABLE
                    FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
                    ORDER BY ORDINAL_POSITION
                    """,
                    (vschema, vname),
                )
                cols = cursor.fetchall()
                # 행 수
                row_count: int | str
                try:
                    cursor.execute(f"SELECT COUNT(*) AS cnt FROM [{vschema}].[{vname}]")
                    row = cursor.fetchone()
                    row_count = row["cnt"] if row else 0
                except Exception as e:
                    row_count = f"ERR: {e}"

                fp.write(f"\n### {vschema}.{vname} · {row_count} rows\n\n")
                fp.write("| Column | Type | MaxLen | Nullable |\n|---|---|--:|---|\n")
                for c in cols:
                    mlen = c["max_len"] if c["max_len"] is not None else ""
                    fp.write(
                        f"| {c['COLUMN_NAME']} | {c['DATA_TYPE']} | "
                        f"{mlen} | {c['IS_NULLABLE']} |\n"
                    )

        print(f"   📄 {out_file.name} 저장 ({len(view_objects)}개 view 의 컬럼+행수)")

    finally:
        conn.close()


def main() -> None:
    print("세정학원 ETL · MSSQL 탐색 시작\n")
    print(f"결과 저장 위치: {OUTPUT_DIR}")
    for db in DATABASES:
        explore(db)
    print("\n✅ 완료")


if __name__ == "__main__":
    main()
