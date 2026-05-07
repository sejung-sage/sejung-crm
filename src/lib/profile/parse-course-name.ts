/**
 * 학생 상세 수강이력에서 강좌 마스터(classes) 매칭이 실패한 row 의 표시용 fallback.
 *
 * 배경:
 *  - ETL `migrate_enrollments.py:211-212` 는 `enrollments.teacher_name` /
 *    `enrollments.subject` 를 항상 NULL 로 적재한다 (V_student_class_list 에 정형
 *    값이 없어서 — 진짜 정형 데이터는 V_class_list → `classes` 테이블에만 존재).
 *  - 따라서 표시 정보는 `enrollments.aca_class_id` → `classes` join 으로만 채워지는데,
 *    `반고유_코드` 가 NULL 이거나 `classes` ETL 미적재 강좌면 join 결과가 비어 화면에
 *    "—" 만 노출된다.
 *
 * 이 파서는 운영 데이터의 일관된 자유형 패턴을 활용해 `course_name` 문자열에서
 * 선생님·과목을 보수적으로 추출한다. 정확한 ETL 정합성 작업과 별개로 UI 노이즈를
 * 즉시 줄이는 용도. 매칭 실패 시 null 반환 → 호출부가 "—" 그대로 노출.
 *
 * 패턴 (운영 raw 분포 기반):
 *   `(종)? <분원·시즌 코드> <선생님>T <학년> <과목 키워드> <세부> ...`
 *   예) "26@RN 써니T 세화여고1 국어 1학기 기말 (7+1회) 토 A10-1 (5/16)"
 *       "(종) 26#SN 박정인T 중3 영어 영어최상위반 일 A9:30-12:30 (9/7)"
 *       "26#SN 양장섭T 고1 과탐 통과 기말킬러 운동량과충격량 (1회)"
 *
 *  - 종강/폐강 prefix : `(종)` `종)` `(폐)` `폐)` 4종을 strip
 *  - 선생님 토큰      : 한글 1자 이상 + 영문 대문자 T + 단어 경계
 *                        (예: "써니T", "박천익T", "김강현T")
 *  - 과목 토큰        : `migrate_classes.py:_SUBJECT_ALIASES` 와 동일 매핑
 *                        (통합과학·통과·화학·생명과학·물리 → 과탐 등)
 *
 * 보수성:
 *  - 부분 일치 위주이며, 모호한 raw 는 null 반환 (잘못된 추정보다 "—" 표시가 안전).
 *  - 매칭 우선순위는 본 모듈에서 고정 (과탐 > 사탐 > 영어 > 국어 > 수학 > 컨설팅 > 기타).
 *    예: "고1 과탐 통과 ..." → 과탐 (둘 다 과탐 그룹).
 */

import type { Subject } from "@/types/database";

/** 과목 패턴 → 정규 Subject 매핑. 운영 raw 분포 기반 (migrate_classes.py 와 동일). */
const SUBJECT_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  subject: Subject;
}> = [
  { pattern: /(?:^|\s)(과탐|통합과학|통과|화학|생명과학|물리)(?=\s|$)/u, subject: "과탐" },
  { pattern: /(?:^|\s)(사탐|통합사회|통사|한국사|통사\+한국사)(?=\s|$)/u, subject: "사탐" },
  { pattern: /(?:^|\s)(영어|수능영어)(?=\s|$)/u, subject: "영어" },
  { pattern: /(?:^|\s)(국어|수능국어)(?=\s|$)/u, subject: "국어" },
  { pattern: /(?:^|\s)(수학|수능수학)(?=\s|$)/u, subject: "수학" },
  { pattern: /(?:^|\s)(컨설팅)(?=\s|$)/u, subject: "컨설팅" },
  { pattern: /(?:^|\s)(독학관|약술|논술)(?=\s|$)/u, subject: "기타" },
];

/**
 * 선생님 토큰: 한글 1+ 글자 + 대문자 T + 단어 경계.
 * "선생님T", "써니T", "박천익T" 등에 매칭.
 *
 * 단어 경계 lookahead `(?=\s|$|\W)` 로 "T1", "Test" 같은 영문 단어 시작과 분리.
 * 한글 외 문자(예: "Mr.김T") 는 의도적으로 제외 — 운영 분포에서 거의 없음.
 */
const TEACHER_PATTERN = /(?:^|\s)([가-힣]{1,8})T(?=\s|$|[^A-Za-z0-9])/u;

/** 종강·폐강 prefix 4종을 strip. 0024/0028 마이그 가드와 동일 정책. */
const GRADUATED_PREFIX = /^[(\s]*[종폐][)\s]*/u;

export interface CourseNameParts {
  teacher: string | null;
  subject: Subject | null;
}

export function parseCourseName(courseName: string | null): CourseNameParts {
  if (!courseName || courseName.trim().length === 0) {
    return { teacher: null, subject: null };
  }
  const stripped = courseName.replace(GRADUATED_PREFIX, "").trim();

  let teacher: string | null = null;
  const tm = stripped.match(TEACHER_PATTERN);
  if (tm && tm[1]) teacher = tm[1];

  let subject: Subject | null = null;
  for (const { pattern, subject: s } of SUBJECT_PATTERNS) {
    if (pattern.test(stripped)) {
      subject = s;
      break;
    }
  }

  return { teacher, subject };
}
