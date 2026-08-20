#!/usr/bin/env bash
#
# supabase db push 래퍼.
#
# 왜 필요한가:
#   Supabase CLI 는 DB 비밀번호를 `SUPABASE_DB_PASSWORD` 환경변수에서 읽는데,
#   이 저장소의 .env.local 은 `SUPABASE_DATABASE_PASSWORD` 라는 이름으로 갖고 있다.
#   또 CLI 는 .env.local 을 자동으로 읽지 않는다(셸 환경변수만 본다).
#   그래서 매번 손으로 export 하다 오타/누락이 나던 걸 한 줄로 고정한다.
#
# 사용법:
#   ./scripts/db-push.sh                # 밀린 마이그레이션 적용
#   ./scripts/db-push.sh --dry-run      # 뭐가 밀릴지만 확인
#   ./scripts/db-push.sh --help         # CLI 도움말
#
#   목록만 보려면: ./scripts/db-push.sh 대신
#   SUPABASE_DB_PASSWORD=... supabase migration list
#
# 비밀번호는 인자로 넘기지 않고 환경변수로만 전달한다 — 셸 히스토리·ps 출력에
# 남지 않게 하기 위함.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env.local"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ $ENV_FILE 이 없습니다." >&2
  exit 1
fi

# SUPABASE_DB_PASSWORD 가 이미 있으면 그걸 우선. 없으면 .env.local 에서 읽는다.
# (CLI 가 쓰는 이름 → 저장소가 쓰는 이름 순으로 탐색)
read_env() { grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true; }

PW="${SUPABASE_DB_PASSWORD:-}"
[[ -z "$PW" ]] && PW="$(read_env SUPABASE_DB_PASSWORD)"
[[ -z "$PW" ]] && PW="$(read_env SUPABASE_DATABASE_PASSWORD)"

# 비밀번호를 통째 URL 로 갖고 있는 경우(DATABASE_OWNER_URL) 거기서 뽑는다.
#   ⚠️ 그 URL 의 호스트(db.<ref>.supabase.co)는 직결 전용이라 IPv6 만 뜬다 —
#      일반 사무실/가정 회선에서는 이름 해석부터 실패한다. 그래서 URL 을 그대로
#      쓰지 않고 **비밀번호만** 꺼내 CLI 에 넘긴다. CLI 는 풀러(IPv4)로 붙는다.
if [[ -z "$PW" ]]; then
  OWNER_URL="$(read_env DATABASE_OWNER_URL)"
  if [[ -n "$OWNER_URL" ]]; then
    PW="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.urlsplit(sys.argv[1]).password or "")' "$OWNER_URL")"
  fi
fi

if [[ -z "$PW" ]]; then
  echo "❌ DB 비밀번호를 찾지 못했습니다." >&2
  echo "   $ENV_FILE 에 SUPABASE_DB_PASSWORD=... 또는 DATABASE_OWNER_URL=... 을 넣어주세요." >&2
  echo "   (Supabase 대시보드 → Project Settings → Database → Database password)" >&2
  exit 1
fi

export SUPABASE_DB_PASSWORD="$PW"
exec supabase db push "$@"
