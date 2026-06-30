import { z } from "zod";
import { EXPLORER_OPERATORS } from "@/lib/explorer/datasets";

/**
 * 데이터 탐색기 조회 입력 스키마 (읽기 전용).
 * 외부(클라이언트) 입력이라 서버 액션에서 런타임 재검증한다.
 *
 * 컬럼명은 여기서 길이/형태만 1차 제한하고, 실제 유효성(존재 여부)은 서버가
 * introspect 한 데이터셋 컬럼 집합과 대조해 최종 검증한다.
 */
const OPERATOR_VALUES = EXPLORER_OPERATORS.map((o) => o.value) as [
  string,
  ...string[],
];

/** 컬럼명: 영문/숫자/언더스코어만(인젝션 방지), 최대 64자. */
const ColumnNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_]+$/, "허용되지 않는 컬럼명입니다");

export const ExplorerFilterSchema = z.object({
  column: ColumnNameSchema,
  operator: z.enum(OPERATOR_VALUES),
  value: z.string().max(300).optional().default(""),
});

export type ExplorerFilter = z.infer<typeof ExplorerFilterSchema>;

export const ExplorerQuerySchema = z.object({
  dataset: z.string().trim().min(1).max(64),
  filters: z.array(ExplorerFilterSchema).max(20).optional().default([]),
  /** 표시할 컬럼. 비면 전체(*). */
  columns: z.array(ColumnNameSchema).max(80).optional().default([]),
  sortColumn: ColumnNameSchema.optional(),
  sortAsc: z.coerce.boolean().optional().default(false),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(100),
});

export type ExplorerQueryInput = z.infer<typeof ExplorerQuerySchema>;
