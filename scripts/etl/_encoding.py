"""
pymssql 결과의 한글 모지바케 복구.

배경:
  Windows pymssql wheel 의 정적 FreeTDS 는 MSSQL VARCHAR(cp949) 컬럼을
  utf-8 로 변환할 때 실패하고 cp949 bytes 를 latin-1 으로 잘못 디코드해
  str 로 반환한다. 결과: "이지혜" → "ÀÌÁöÇÝ" 같은 모지바케.

  반면 NVARCHAR(UCS-2) 컬럼은 FreeTDS 가 utf-8 로 잘 변환해 정상 str 로 반환.
  같은 row 안에서 컬럼별로 정상/깨짐이 섞이는 이유.

해결:
  잘못된 str 을 다시 latin-1 으로 인코딩해 원본 cp949 bytes 를 복원한 뒤
  cp949 → utf-8 으로 다시 디코드. 한글 코드 포인트가 결과에 1자 이상
  나타나면 그 값을 채택, 아니면 원본 유지 (이미 정상이거나 한글 아닌 경우).

사용:
  fetch 직후 cursor row 전체를 `recover_row(row)` 로 감싼다.
  string 값만 처리하고 다른 타입(int, datetime 등)은 그대로 통과.
"""
from __future__ import annotations

from typing import Any


def recover_korean(value: Any) -> Any:
    """pymssql Windows wheel 의 cp949 → latin-1 모지바케 복구."""
    if not isinstance(value, str):
        return value
    if not value:
        return value
    try:
        recovered = value.encode("latin-1").decode("cp949")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value
    # 한글 음절 (가-힣) 이 1자 이상 나오면 복구 채택.
    # 채택 안 하면 원본이 영문/숫자/이미 정상 한글인 경우 — 그대로 유지.
    for ch in recovered:
        if "가" <= ch <= "힣":
            return recovered
    return value


def recover_row(row: dict) -> dict:
    """dict 의 모든 str 값에 recover_korean 적용. 다른 타입은 통과."""
    return {k: recover_korean(v) for k, v in row.items()}


def recover_rows(rows: list[dict]) -> list[dict]:
    """row 리스트 일괄 처리."""
    return [recover_row(r) for r in rows]
