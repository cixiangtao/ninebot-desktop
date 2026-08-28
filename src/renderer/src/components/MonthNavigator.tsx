import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  createMonthKey,
  currentMonth,
  formatMonth,
  getMonthNumber,
  getMonthYear,
  isFutureMonth,
} from "../lib/format";

interface MonthNavigatorProps {
  month: string;
  visibleYear: number;
  open: boolean;
  disabled: boolean;
  minimumMonth: string | null;
  onToggle: () => void;
  onVisibleYearChange: (year: number) => void;
  onSelect: (month: string) => void;
}

const months = Array.from({ length: 12 }, (_, index) => index + 1);

export const MonthNavigator = ({
  month,
  visibleYear,
  open,
  disabled,
  minimumMonth,
  onToggle,
  onVisibleYearChange,
  onSelect,
}: MonthNavigatorProps) => {
  const thisMonth = currentMonth();
  const thisYear = getMonthYear(thisMonth);
  const selectedYear = getMonthYear(month);
  const selectedMonth = getMonthNumber(month);
  const minimumYear = minimumMonth === null ? null : getMonthYear(minimumMonth);

  return (
    <div className="month-navigation">
      <button
        className="month-button"
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="month-picker"
        disabled={disabled}
      >
        <CalendarDays size={15} />
        <span>{formatMonth(month)}</span>
        <ChevronDown size={14} className={open ? "rotate-180" : ""} />
      </button>

      {open ? (
        <div className="month-picker" id="month-picker">
          <div className="month-picker-year">
            <button
              type="button"
              onClick={() => onVisibleYearChange(visibleYear - 1)}
              aria-label="上一年"
              disabled={minimumYear !== null && visibleYear <= minimumYear}
            >
              <ChevronLeft size={15} />
            </button>
            <strong>{visibleYear}年</strong>
            <button
              type="button"
              onClick={() => onVisibleYearChange(visibleYear + 1)}
              aria-label="下一年"
              disabled={visibleYear >= thisYear}
            >
              <ChevronRight size={15} />
            </button>
          </div>

          <div className="month-grid" aria-label={`${visibleYear}年月份`}>
            {months.map((monthNumber) => {
              const monthKey = createMonthKey(visibleYear, monthNumber);
              const selected = visibleYear === selectedYear && monthNumber === selectedMonth;
              const current = monthKey === thisMonth;
              return (
                <button
                  key={monthKey}
                  className={`${selected ? "month-cell-selected" : ""} ${current ? "month-cell-current" : ""}`}
                  type="button"
                  onClick={() => onSelect(monthKey)}
                  disabled={
                    isFutureMonth(monthKey, thisMonth) ||
                    (minimumMonth !== null && monthKey < minimumMonth)
                  }
                  aria-pressed={selected}
                >
                  {monthNumber}月
                </button>
              );
            })}
          </div>
          {minimumMonth !== null ? (
            <p className="month-picker-boundary">数据从 {formatMonth(minimumMonth)} 开始</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
