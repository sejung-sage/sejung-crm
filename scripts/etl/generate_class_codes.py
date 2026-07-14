"""
강의코드 생성/백필 — crm_classes → crm_class_codes.

2026-07-14 확정 규칙(Notion "강의 코드 정리"):
  [연도][분원][과목][학년][구분][강사][순번]  예) 26-DC-MA-H3-S-010-01
  - 각 자리는 강의명·분원·과목·강사에서 파생. 없는 자리는 생략(대시로 join).
  - 순번: [연도·분원·과목·학년·구분] 동일 조합 내 (registered_at, aca_class_id) 정렬 순.

강사 번호는 crm_teacher_codes(0109)에서 조회. 표에 없는 신규 강사는 다음 번호를
할당해 그 테이블에 append(안정 번호 유지). 더미(code NULL)는 강사 자리 생략.

실행:
  python scripts/etl/generate_class_codes.py
  ETL 파이프라인에서는 apply_to_crm.py 다음에 호출(신규 강좌 코드 부여).
"""
from __future__ import annotations

import os
import re
import sys
from collections import defaultdict
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(Path(__file__).parent / ".env")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY")
if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
    print("[ERROR] SUPABASE_URL / SUPABASE_SECRET_KEY env 가 없습니다.")
    sys.exit(1)

# ── 매핑 규칙 (Notion 확정본) ────────────────────────────────
BRANCH_CODE = {"대치": "DC", "반포": "BP", "송도": "SD", "방배": "BB"}
SUBJECT_CODE = {
    "수학": "MA", "과탐": "SC", "국어": "KR", "영어": "EN", "사탐": "SS",
    "기타": "ET", "설명회": "SE", "컨설팅": "CS", "독학관": "ST",
}


def is_junk(name: str) -> bool:
    """구분선(----)·기호(★)만 있는 데이터 행 — 코드 미부여."""
    return len(re.sub(r"[\s\-_=★☆·.*※+]", "", name)) < 2


def parse_year_mark(name: str) -> tuple[str | None, str | None]:
    """연도 2자 + 구분(@내신→N / #특강→S). 선두 (종)(폐)★ 제거, 2026·26 모두 처리."""
    n = re.sub(r"^[\s()종폐★☆]+", "", name)
    m = re.match(r"\s*(?:20)?(\d{2})\s*([#@])?", n)
    if not m:
        return None, None
    mark = {"@": "N", "#": "S"}.get(m.group(2)) if m.group(2) else None
    return m.group(1), mark


def grade_code(name: str) -> str | None:
    """학년(강의명 파싱). 예비=P접두, 광역 H0/M0, 없으면 None(자리 생략)."""
    if re.search(r"예비\s*고\s*1", name):
        return "PH1"
    if re.search(r"예비\s*중\s*2", name):
        return "PM2"
    if re.search(r"예비\s*중\s*3", name):
        return "PM3"
    for pat, code in [(r"고\s*1", "H1"), (r"고\s*2", "H2"), (r"고\s*3", "H3"),
                      (r"중\s*1", "M1"), (r"중\s*2", "M2"), (r"중\s*3", "M3")]:
        if re.search(pat, name):
            return code
    if re.search(r"초\s*[1-6]?", name):
        return "E1"
    if re.search(r"재수|N\s*수|반수", name):
        return "RE"
    if re.search(r"고등", name):
        return "H0"
    if re.search(r"중등", name):
        return "M0"
    return None


def subject_code(subject: str | None, name: str) -> str:
    """정규화된 subject → 코드. 미분류(NULL)는 강의명 별칭 규칙 → 없으면 XX(미지정)."""
    if subject and subject in SUBJECT_CODE:
        return SUBJECT_CODE[subject]
    if re.search(r"독학관|모의고사반", name):
        return "ST"
    if re.search(r"컨설팅", name):
        return "CS"
    if re.search(r"통사|한국사|사탐|생윤|생활과 윤리|사문|경제|근현대|전근대|통합사회", name):
        return "SS"
    if re.search(r"화학|물리|생명|지학|지구과학|통합과학|통과|세포와 물질대사|유전|역학|전자기|중화반응|과탐", name):
        return "SC"
    if re.search(r"영어|VOCA|보카|독해|어법|리딩|reading", name, re.I):
        return "EN"
    if re.search(r"국어|문학|문법|독서", name):
        return "KR"
    if re.search(r"수학|미적|확통|기하|대수|공통수학|도형", name):
        return "MA"
    if re.search(r"논술|클리닉|TEST|자기주도|특강|설명회|간담회", name):
        return "ET"
    return "XX"  # 과목 없는 학교 통합 내신 등


def main() -> None:
    print("=" * 60)
    print("강의코드 생성 · crm_classes → crm_class_codes")
    print("=" * 60)
    sb = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)

    # 1) 강사 코드표 로드 (name → code|None, is_dummy)
    tc_rows = sb.table("crm_teacher_codes").select("teacher_name, code, is_dummy").execute().data or []
    teacher_map = {r["teacher_name"]: r for r in tc_rows}
    used_codes = {int(r["code"]) for r in tc_rows if r["code"]}
    next_code = (max(used_codes) + 1) if used_codes else 1
    new_teachers = 0

    def resolve_teacher(name: str | None) -> str | None:
        nonlocal next_code, new_teachers
        if not name:
            return None
        row = teacher_map.get(name)
        if row is not None:
            return None if row["is_dummy"] else row["code"]  # 더미 → 자리 생략
        # 신규 강사: 다음 번호 할당 + 표에 append(안정 유지)
        code = f"{next_code:03d}"
        sb.table("crm_teacher_codes").insert(
            {"teacher_name": name, "code": code, "is_dummy": False}
        ).execute()
        teacher_map[name] = {"teacher_name": name, "code": code, "is_dummy": False}
        used_codes.add(next_code)
        next_code += 1
        new_teachers += 1
        return code

    # 2) crm_classes 전량 로드
    classes: list[dict] = []
    step = 1000
    for off in range(0, 100000, step):
        batch = (
            sb.table("crm_classes")
            .select("id, aca_class_id, name, branch, subject, teacher_name, registered_at")
            .range(off, off + step - 1)
            .execute()
            .data
        )
        classes.extend(batch or [])
        if not batch or len(batch) < step:
            break
    print(f"강좌 {len(classes)}건 로드")

    # 3) 컴포넌트 산출
    comp: list[tuple[dict, list[str | None]]] = []
    skipped = 0
    for c in classes:
        if is_junk(c["name"]):
            skipped += 1
            continue
        yy, mark = parse_year_mark(c["name"])
        parts = [
            yy,
            BRANCH_CODE.get(c["branch"]),
            subject_code(c["subject"], c["name"]),
            grade_code(c["name"]),
            mark,
            resolve_teacher(c["teacher_name"]),
        ]
        comp.append((c, parts))

    # 4) 순번: [연도·분원·과목·학년·구분] 조합 내 (registered_at, aca_class_id) 정렬
    combo: dict[tuple, list[dict]] = defaultdict(list)
    for c, parts in comp:
        combo[tuple(parts[:5])].append(c)
    seq_of: dict[str, str] = {}
    for key, lst in combo.items():
        lst.sort(key=lambda x: (x.get("registered_at") or "9999", x.get("aca_class_id") or x["id"]))
        for i, c in enumerate(lst, 1):
            seq_of[c["id"]] = f"{i:02d}"

    # 5) 코드 조립 + upsert
    payload = []
    for c, parts in comp:
        core = [p for p in parts if p]
        code = "-".join(core + [seq_of[c["id"]]])
        payload.append({"class_id": c["id"], "lecture_code": code})

    for i in range(0, len(payload), 500):
        sb.table("crm_class_codes").upsert(
            payload[i : i + 500], on_conflict="class_id"
        ).execute()

    print(f"코드 부여 {len(payload)}건 · 쓰레기 제외 {skipped}건 · 신규 강사 {new_teachers}명")
    print("=" * 60)


if __name__ == "__main__":
    main()
