# -*- coding: utf-8 -*-
"""아카2000 문자 발송 로그 엑셀 생성.
   대치_문자발송로그_*.xlsx (CRM 판) 과 같은 시트 구성 + 아카 전용 열(발송관·발송성격).
"""
import csv, sys
from collections import OrderedDict
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter as CL

SRC = sys.argv[1]
OUT = sys.argv[2]

HDR_FILL = PatternFill('solid', fgColor='FF1F3864')
HDR_FONT = Font(bold=True, size=10, color='FFFFFFFF')
BASE = Font(size=10)
TITLE = Font(bold=True, size=13)
SUB = Font(bold=True, size=11)

with open(SRC, encoding='utf-8') as f:
    rows = list(csv.DictReader(f))

COLS = ['보낸사람','발송관','전송일','요일','전송시각','강좌','과목','유형','발송성격',
        '강사','강사수','학년','학교','대상수','금액','금액_배분','대표행','월','발송키']
NUMC = {'강사수','대상수','금액','금액_배분','대표행'}
for r in rows:
    for k in NUMC:
        r[k] = float(r[k]) if k == '금액_배분' else int(r[k])

N = len(rows) + 1                      # 원본데이터 마지막 행
def C(name):                            # 원본데이터 열 문자
    return CL(COLS.index(name) + 1)
def RNG(name):
    c = C(name); return f'원본데이터!${c}$2:${c}${N}'
REP = f'{RNG("대표행")},1'              # 대표행=1 조건 (중복 제거)

wb = Workbook()

# ── 원본데이터 ────────────────────────────────────────────────
ws = wb.active; ws.title = '원본데이터'
ws.append(COLS)
for r in rows:
    ws.append([r[c] for c in COLS])
for c in ws[1]:
    c.fill, c.font, c.alignment = HDR_FILL, HDR_FONT, Alignment(horizontal='center')
for col in ('대상수','금액','금액_배분'):
    for cell in ws[C(col)][1:]:
        cell.number_format = '#,##0'
ws.freeze_panes = 'C2'
ws.auto_filter.ref = f'A1:{CL(len(COLS))}{N}'
for col, w in zip(COLS, [11,9,12,6,9,46,8,10,10,14,8,13,12,10,11,12,7,7,60]):
    ws.column_dimensions[C(col)].width = w

# ── 캠페인별(발송 건별) ───────────────────────────────────────
uniq = OrderedDict()
for r in rows:
    g = uniq.setdefault(r['발송키'], {**r, '강사목록': []})
    if r['강사'] != '(미기재)':
        g['강사목록'].append(r['강사'])
ws2 = wb.create_sheet('발송건별')
H2 = ['전송일','요일','전송시각','월','보낸사람','발송관','강좌','과목','유형','발송성격',
      '학년','학교','강사수','강사목록','대상수','금액']
ws2.append(H2)
for g in uniq.values():
    ws2.append([g['전송일'], g['요일'], g['전송시각'], g['월'], g['보낸사람'], g['발송관'],
                g['강좌'], g['과목'], g['유형'], g['발송성격'], g['학년'], g['학교'],
                g['강사수'], ', '.join(g['강사목록']) or '(미기재)', g['대상수'], g['금액']])
for c in ws2[1]:
    c.fill, c.font, c.alignment = HDR_FILL, HDR_FONT, Alignment(horizontal='center')
for letter in ('O','P'):
    for cell in ws2[letter][1:]:
        cell.number_format = '#,##0'
ws2.freeze_panes = 'A2'
ws2.auto_filter.ref = f'A1:P{len(uniq)+1}'
for i, w in enumerate([12,6,9,7,11,9,46,8,10,10,13,12,7,40,10,11], 1):
    ws2.column_dimensions[CL(i)].width = w

# ── 집계 시트 헬퍼 ────────────────────────────────────────────
def block(ws, row, label, keycol, values, avg=False):
    """label 열 + 발송 건수/총 비용/누적 대상 3열. 대표행=1 로 중복 제거."""
    head = [label, '발송 건수', '총 비용(원)', '누적 대상(명)'] + (
        ['건당 평균 대상', '건당 평균 비용'] if avg else [])
    ws.cell(row, 1, head[0])
    for i, h in enumerate(head[1:], 2):
        ws.cell(row, i, h)
    for c in ws[row][:len(head)]:
        c.fill, c.font, c.alignment = HDR_FILL, HDR_FONT, Alignment(horizontal='center')
    k = RNG(keycol)
    for i, v in enumerate(values):
        r = row + 1 + i
        ws.cell(r, 1, v)
        ws.cell(r, 2, f'=COUNTIFS({k},$A{r},{REP})')
        ws.cell(r, 3, f'=SUMIFS({RNG("금액")},{k},$A{r},{REP})').number_format = '#,##0'
        ws.cell(r, 4, f'=SUMIFS({RNG("대상수")},{k},$A{r},{REP})').number_format = '#,##0'
        if avg:
            ws.cell(r, 5, f'=IFERROR($D{r}/$B{r},0)').number_format = '#,##0'
            ws.cell(r, 6, f'=IFERROR($C{r}/$B{r},0)').number_format = '#,##0'
    return row + 1 + len(values)

def vals(col, order=None):
    s = sorted({r[col] for r in rows})
    if order:
        s = [v for v in order if v in s] + [v for v in s if v not in order]
    return s

# ── 강사별집계 ────────────────────────────────────────────────
ws3 = wb.create_sheet('강사별집계')
ws3.append(['강사', '등장 발송 건수', '배분 비용(원)', '누적 노출 대상(명)', '평균 대상(명)'])
for c in ws3[1]:
    c.fill, c.font, c.alignment = HDR_FILL, HDR_FONT, Alignment(horizontal='center')
tk = RNG('강사')
for i, t in enumerate(vals('강사'), 2):
    ws3.cell(i, 1, t)
    ws3.cell(i, 2, f'=COUNTIFS({tk},$A{i})')
    ws3.cell(i, 3, f'=SUMIFS({RNG("금액_배분")},{tk},$A{i})').number_format = '#,##0'
    ws3.cell(i, 4, f'=SUMIFS({RNG("대상수")},{tk},$A{i})').number_format = '#,##0'
    ws3.cell(i, 5, f'=IFERROR($D{i}/$B{i},0)').number_format = '#,##0'
ws3.freeze_panes = 'A2'
ws3.column_dimensions['A'].width = 22
for c in 'BCDE':
    ws3.column_dimensions[c].width = 18
TEACHER_N = len(vals('강사'))

# ── 학년별집계 (+ 월×학년 교차표) ─────────────────────────────
GORDER = ['중1','중2','중3','중3(예비고1)','고1','고2','고3','ALL']
grades = vals('학년', GORDER)
ws4 = wb.create_sheet('학년별집계')
end = block(ws4, 1, '학년', '학년', grades, avg=True)
ws4.cell(end + 1, 1, '합계').font = SUB
for i, c in enumerate('BCD', 2):
    ws4.cell(end + 1, i, f'=SUM({c}2:{c}{end})').number_format = '#,##0'

months = vals('월', [f'{m}월' for m in range(1, 13)])
r0 = end + 3
ws4.cell(r0, 1, '월 × 학년 발송 건수').font = SUB
hr = r0 + 1
ws4.cell(hr, 1, '학년')
for j, m in enumerate(months, 2):
    ws4.cell(hr, j, m)
for c in ws4[hr][:len(months) + 1]:
    c.fill, c.font, c.alignment = HDR_FILL, HDR_FONT, Alignment(horizontal='center')
for i, g in enumerate(grades, hr + 1):
    ws4.cell(i, 1, g)
    for j in range(2, len(months) + 2):
        ws4.cell(i, j, f'=COUNTIFS({RNG("학년")},$A{i},{RNG("월")},{CL(j)}${hr},{REP})')
ws4.freeze_panes = 'A2'
ws4.column_dimensions['A'].width = 22
for j in range(2, len(months) + 2):
    ws4.column_dimensions[CL(j)].width = 14

# ── 유형과목별 (유형 / 과목 / 발송성격 / 발송관) ──────────────
ws5 = wb.create_sheet('유형과목별')
KORDER = ['대량홍보','중량','소량','소규모','개별']
r = 1
for label, col, order in [('발송 유형','유형',None), ('과목','과목',None),
                          ('발송 성격','발송성격',KORDER), ('발송관','발송관',None)]:
    r = block(ws5, r, label, col, vals(col, order)) + 2
ws5.freeze_panes = 'A2'
ws5.column_dimensions['A'].width = 22
for c in 'BCD':
    ws5.column_dimensions[c].width = 18

# ── 요약 ──────────────────────────────────────────────────────
d0, d1 = rows[0]['전송일'], max(r['전송일'] for r in rows)
ws0 = wb.create_sheet('요약', 0)
ws0.cell(1, 1, f'대치 아카2000 문자 발송 로그 ({d0} ~ {d1})').font = TITLE
kpi = [
    ('총 발송 건수', f'=COUNTIFS({REP})'),
    ('원본 행 수 (강사 단위 전개)', f'=COUNTA({RNG("보낸사람")})'),
    ('총 발송 비용 (원, 추정)', f'=SUMIFS({RNG("금액")},{REP})'),
    ('누적 발송 대상 (명)', f'=SUMIFS({RNG("대상수")},{REP})'),
    ('대상 1인당 단가 (원)', '=IFERROR(B5/B6,0)'),
    ('발송 건당 평균 비용 (원)', '=IFERROR(B5/B3,0)'),
    ('발송 건당 평균 대상 (명)', '=IFERROR(B6/B3,0)'),
    ('등장 강사 수 (명)', f'=COUNTA(강사별집계!$A$2:$A${TEACHER_N + 1})'),
]
for i, (k, v) in enumerate(kpi, 3):
    ws0.cell(i, 1, k).font = BASE
    ws0.cell(i, 2, v).number_format = '#,##0'

r = 3 + len(kpi) + 1
ws0.cell(r, 1, '시트 구성').font = SUB
guide = [
    ('원본데이터', f'아카2000 문자 발송 원본(aca_sms_messages)을 발송 건 단위로 묶은 표. '
                   f'한 발송에 강사가 여러 명이면 행이 분리됩니다 ({len(rows):,}행).'),
    ('발송건별', f'발송 건 단위로 중복 제거한 {len(uniq):,}건. 금액·대상수 합산은 이 시트 기준으로 하십시오.'),
    ('강사별집계', '강사 단위. 비용은 발송 금액을 등장 강사 수로 나눈 배분액입니다.'),
    ('학년별집계', '학년 단위 + 월×학년 교차표. 대표행 플래그로 중복을 제거해 집계합니다.'),
    ('유형과목별', '발송 유형별 / 과목별 / 발송 성격별 / 발송관별 집계.'),
]
for i, (k, v) in enumerate(guide, r + 1):
    ws0.cell(i, 1, k).font = BASE
    ws0.cell(i, 2, v).font = BASE

r = r + len(guide) + 2
ws0.cell(r, 1, '주의').font = SUB
notes = [
    '· 원본데이터 시트에서 금액 열을 그대로 합산하면 강사 수만큼 중복 계상됩니다. '
    '중복 없는 합계는 금액_배분 열 또는 대표행=1 조건을 쓰십시오.',
    '· 금액은 실제 청구액이 아니라 추정치입니다. 아카2000 로그에는 청구 금액이 없어 '
    '아카 단가(SMS 10원 / LMS 28원, 부가세 별도)를 건별 msg_type 에 적용해 역산했습니다. '
    '현재 적재분은 2,063,033건 전부 LMS 입니다.',
    '· 발송 건 묶음 기준은 (전송일, 보낸사람, 발송관, 제목)입니다. 아카 문자는 본문에 '
    '수신자 이름이 들어가 개인화되므로 본문은 묶음 기준에서 제외했습니다. 같은 날 같은 사람이 '
    '같은 제목으로 서로 다른 내용을 보냈다면 한 건으로 합쳐집니다.',
    '· 전송시각은 그 발송 건에서 가장 이른 시각입니다. 대량 발송은 20분 이상에 걸쳐 '
    '순차 전송되므로 실제 전송은 그 이후로도 이어집니다.',
    '· 발송관은 회신번호로 판별합니다. 회신번호가 매핑되지 않은 12,275건은 (미상)으로 묶었습니다.',
    "· 강사는 본문에서 '○○○T' 패턴으로 추출한 값이라 누락·오탐이 있을 수 있습니다. "
    "패턴이 없으면 (미기재)입니다.",
    '· 학년·학교는 그 발송의 수신자 구성 기준입니다. 한 학년이 99% 이상이면 그 학년, '
    '한 학교가 90% 이상이면 그 학교로 표기하고 아니면 ALL 입니다.',
    '· 본 파일은 아카2000 경유 발송분만 포함합니다. CRM 발송분은 별도 파일을 보십시오.',
]
for i, n in enumerate(notes, r + 1):
    ws0.cell(i, 1, n).font = BASE
ws0.column_dimensions['A'].width = 34
ws0.column_dimensions['B'].width = 20

wb.save(OUT)
print(f'saved {OUT}: {len(rows):,} rows / {len(uniq):,} sends / {TEACHER_N} teachers')
