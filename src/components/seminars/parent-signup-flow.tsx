"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, ChevronDown, AlertCircle } from "lucide-react";
import type { MockSeminar } from "@/lib/seminars/dev-seed";
import { formatKstDateTime } from "@/lib/datetime";

/**
 * 학부모 공개 신청 페이지 본체 — UI MOCKUP ONLY.
 *
 * 상태:
 *  - "form"     : 입력 폼
 *  - "submitting": 800ms 대기 (제출 중)
 *  - "done"     : 신청 완료 화면
 *
 * 클라이언트 단 검증:
 *  - 이름: 1자 이상
 *  - 전화: 010~019 시작 + 끝 4자리 포함, 총 10~11자리 숫자
 *  - 동의: 필수 체크
 */
interface Props {
  seminar: MockSeminar;
  /** 분원 문의 번호 — 데모용 고정값 */
  inquiryPhone: string;
}

type ViewState = "form" | "submitting" | "done";

interface FormState {
  studentName: string;
  parentPhone: string;
  agreed: boolean;
}

interface SubmittedInfo {
  studentName: string;
  parentPhone: string;
}

export function ParentSignupFlow({ seminar, inquiryPhone }: Props) {
  const [view, setView] = useState<ViewState>("form");
  const [submitted, setSubmitted] = useState<SubmittedInfo | null>(null);

  if (view === "done" && submitted) {
    return (
      <DoneView
        seminar={seminar}
        submitted={submitted}
        inquiryPhone={inquiryPhone}
        onReset={() => {
          setView("form");
          setSubmitted(null);
        }}
      />
    );
  }

  return (
    <SignupForm
      submitting={view === "submitting"}
      onSubmit={async (data) => {
        setView("submitting");
        // 목 처리 — 실제 저장 없음
        await new Promise((r) => setTimeout(r, 800));
        setSubmitted({
          studentName: data.studentName,
          parentPhone: data.parentPhone,
        });
        setView("done");
      }}
    />
  );
}

// ─── 신청 폼 ─────────────────────────────────────────────

function SignupForm({
  submitting,
  onSubmit,
}: {
  submitting: boolean;
  onSubmit: (data: FormState) => Promise<void>;
}) {
  const [studentName, setStudentName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [errors, setErrors] = useState<{
    studentName?: string;
    parentPhone?: string;
    agreed?: string;
  }>({});

  const [, startTransition] = useTransition();

  const handlePhoneChange = (raw: string) => {
    // 자동 하이픈 삽입
    const digits = raw.replace(/\D/g, "").slice(0, 11);
    let formatted = digits;
    if (digits.length >= 7) {
      formatted = `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
    } else if (digits.length >= 4) {
      formatted = `${digits.slice(0, 3)}-${digits.slice(3)}`;
    }
    setParentPhone(formatted);
    if (errors.parentPhone) {
      setErrors((e) => ({ ...e, parentPhone: undefined }));
    }
  };

  const validate = (): boolean => {
    const next: typeof errors = {};
    const name = studentName.trim();
    const digits = parentPhone.replace(/\D/g, "");

    if (name.length < 1) {
      next.studentName = "자녀 이름을 입력해 주세요.";
    } else if (name.length > 40) {
      next.studentName = "이름이 너무 깁니다.";
    }

    if (digits.length === 0) {
      next.parentPhone = "전화번호를 입력해 주세요.";
    } else if (!/^01[0-9]/.test(digits)) {
      next.parentPhone = "010 으로 시작하는 휴대전화번호를 입력해 주세요.";
    } else if (digits.length < 10 || digits.length > 11) {
      next.parentPhone = "전화번호 자릿수가 맞지 않습니다.";
    }

    if (!agreed) {
      next.agreed = "개인정보 수집·이용에 동의해 주세요.";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    if (!validate()) return;
    startTransition(async () => {
      await onSubmit({
        studentName: studentName.trim(),
        parentPhone: parentPhone.trim(),
        agreed,
      });
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6" aria-busy={submitting}>
      {/* 자녀 이름 */}
      <div className="space-y-2">
        <label
          htmlFor="student-name"
          className="block text-[15px] font-medium text-[color:var(--text)]"
        >
          자녀 이름 <span className="text-[color:var(--danger)]">*</span>
        </label>
        <input
          id="student-name"
          type="text"
          value={studentName}
          onChange={(e) => {
            setStudentName(e.target.value);
            if (errors.studentName) {
              setErrors((er) => ({ ...er, studentName: undefined }));
            }
          }}
          placeholder="예: 김민준"
          autoComplete="off"
          maxLength={40}
          required
          aria-invalid={!!errors.studentName}
          aria-describedby={errors.studentName ? "student-name-error" : undefined}
          className={parentInputClass(!!errors.studentName)}
        />
        {errors.studentName && (
          <p
            id="student-name-error"
            role="alert"
            className="flex items-center gap-1 text-[13px] text-[color:var(--danger)]"
          >
            <AlertCircle className="size-4" strokeWidth={1.75} aria-hidden />
            {errors.studentName}
          </p>
        )}
      </div>

      {/* 학부모 전화 */}
      <div className="space-y-2">
        <label
          htmlFor="parent-phone"
          className="block text-[15px] font-medium text-[color:var(--text)]"
        >
          학부모 전화번호 <span className="text-[color:var(--danger)]">*</span>
        </label>
        <input
          id="parent-phone"
          type="tel"
          inputMode="numeric"
          value={parentPhone}
          onChange={(e) => handlePhoneChange(e.target.value)}
          placeholder="010-0000-0000"
          autoComplete="tel"
          required
          aria-invalid={!!errors.parentPhone}
          aria-describedby={errors.parentPhone ? "parent-phone-error" : undefined}
          className={parentInputClass(!!errors.parentPhone)}
        />
        {errors.parentPhone ? (
          <p
            id="parent-phone-error"
            role="alert"
            className="flex items-center gap-1 text-[13px] text-[color:var(--danger)]"
          >
            <AlertCircle className="size-4" strokeWidth={1.75} aria-hidden />
            {errors.parentPhone}
          </p>
        ) : (
          <p className="text-[13px] text-[color:var(--text-muted)]">
            안내 문자가 이 번호로 발송됩니다.
          </p>
        )}
      </div>

      {/* 개인정보 동의 */}
      <div className="space-y-2 rounded-xl border border-[color:var(--border-strong)] bg-[color:var(--bg-muted)] p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => {
              setAgreed(e.target.checked);
              if (errors.agreed) {
                setErrors((er) => ({ ...er, agreed: undefined }));
              }
            }}
            className="mt-1 size-5 cursor-pointer accent-[color:var(--action)]"
            aria-invalid={!!errors.agreed}
          />
          <span className="text-[15px] text-[color:var(--text)] leading-snug">
            개인정보 수집·이용에 동의합니다.{" "}
            <span className="text-[color:var(--danger)]">(필수)</span>
          </span>
        </label>

        <button
          type="button"
          onClick={() => setAgreementOpen((v) => !v)}
          aria-expanded={agreementOpen}
          className="
            inline-flex items-center gap-1 text-[13px]
            text-[color:var(--text-muted)] hover:text-[color:var(--text)]
            pl-8
          "
        >
          <ChevronDown
            className={`size-4 transition-transform ${agreementOpen ? "rotate-180" : ""}`}
            strokeWidth={1.75}
            aria-hidden
          />
          {agreementOpen ? "동의 내용 접기" : "동의 내용 펼치기"}
        </button>

        {agreementOpen && (
          <div className="ml-8 mt-2 rounded-lg bg-bg-card border border-[color:var(--border-strong)] p-3 text-[13px] leading-relaxed text-[color:var(--text-muted)] space-y-1">
            <p>
              <strong className="text-[color:var(--text)]">수집 항목</strong>{" "}
              · 자녀 이름, 학부모 전화번호
            </p>
            <p>
              <strong className="text-[color:var(--text)]">이용 목적</strong>{" "}
              · 설명회 신청 확인 및 안내 문자 발송
            </p>
            <p>
              <strong className="text-[color:var(--text)]">보유 기간</strong>{" "}
              · 설명회 종료 후 1년 (이후 즉시 파기)
            </p>
            <p className="pt-1 text-[12px] text-[color:var(--text-dim)]">
              ※ 본 동의 문구는 시연용 임시 안내이며, 정식 운영 시 학원 측 확정
              문구로 교체됩니다.
            </p>
          </div>
        )}

        {errors.agreed && (
          <p
            role="alert"
            className="flex items-center gap-1 pl-8 text-[13px] text-[color:var(--danger)]"
          >
            <AlertCircle className="size-4" strokeWidth={1.75} aria-hidden />
            {errors.agreed}
          </p>
        )}
      </div>

      {/* 제출 */}
      <button
        type="submit"
        disabled={submitting}
        className="
          w-full inline-flex items-center justify-center
          h-12 px-4 rounded-xl
          bg-[color:var(--action)] text-[color:var(--action-text)]
          text-[16px] font-semibold
          hover:bg-[color:var(--action-hover)]
          disabled:opacity-60
          transition-colors
        "
      >
        {submitting ? "신청 중..." : "설명회 신청하기"}
      </button>
    </form>
  );
}

function parentInputClass(hasError: boolean): string {
  return `
    w-full h-12 rounded-xl px-3
    bg-bg-card border ${hasError ? "border-[color:var(--danger)]" : "border-[color:var(--border-strong)]"}
    text-[16px] text-[color:var(--text)]
    placeholder:text-[color:var(--text-dim)]
    focus:outline-none focus:border-[color:var(--text)]
    transition-colors
  `;
}

// ─── 신청 완료 화면 ─────────────────────────────────────────────

function DoneView({
  seminar,
  submitted,
  inquiryPhone,
  onReset,
}: {
  seminar: MockSeminar;
  submitted: SubmittedInfo;
  inquiryPhone: string;
  onReset: () => void;
}) {
  return (
    <div className="space-y-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <div className="inline-flex items-center justify-center size-16 rounded-full bg-[color:var(--success-bg)]">
          <CheckCircle2
            className="size-10 text-[color:var(--success)]"
            strokeWidth={1.75}
            aria-hidden
          />
        </div>
        <h1 className="text-[22px] font-semibold text-[color:var(--text)]">
          신청이 완료되었습니다
        </h1>
        <p className="text-[14px] text-[color:var(--text-muted)]">
          행사 전 별도 안내 문자를 보내드립니다.
        </p>
      </div>

      <dl className="text-left rounded-xl border border-[color:var(--border-strong)] bg-bg-card divide-y divide-[color:var(--border-strong)]">
        <Row label="설명회">
          <span className="font-medium text-[color:var(--text)]">{seminar.name}</span>
        </Row>
        <Row label="자녀">{submitted.studentName}</Row>
        <Row label="연락처">{submitted.parentPhone}</Row>
        {seminar.starts_at && (
          <Row label="일시">{formatKstDateTime(seminar.starts_at)}</Row>
        )}
        {seminar.venue && <Row label="장소">{seminar.venue}</Row>}
      </dl>

      <p className="text-[14px] text-[color:var(--text-muted)]">
        문의: <span className="text-[color:var(--text)] font-medium">{inquiryPhone}</span>
      </p>

      <button
        type="button"
        onClick={onReset}
        className="
          w-full inline-flex items-center justify-center
          h-12 px-4 rounded-xl
          bg-[color:var(--action)] text-[color:var(--action-text)]
          text-[16px] font-semibold
          hover:bg-[color:var(--action-hover)]
          transition-colors
        "
      >
        확인
      </button>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <dt className="w-16 shrink-0 text-[13px] text-[color:var(--text-muted)]">
        {label}
      </dt>
      <dd className="flex-1 text-[15px] text-[color:var(--text)] break-words">
        {children}
      </dd>
    </div>
  );
}
