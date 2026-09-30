import { SCHEDULE_TIME_PRESETS, type ScheduleTimeChoice } from "./delivery-time-ux";

type Props = {
  label: string;
  valueKey: string;
  customStart: string;
  customEnd: string;
  onPresetChange: (choice: ScheduleTimeChoice) => void;
  onCustomStartChange: (value: string) => void;
  onCustomEndChange: (value: string) => void;
  customError?: string | null;
  disabled?: boolean;
  includeMorningChoices?: Array<{ key: string; label: string; disabled?: boolean; onSelect: () => void }>;
};

const compactGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: "0.5rem",
} as const;

const buttonClass = (selected: boolean, disabled = false) =>
  [
    "min-h-12 w-full min-w-0 rounded-xl border px-2 py-2 text-sm font-semibold leading-tight transition",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2",
    selected
      ? "border-blue-600 bg-white text-blue-700 ring-2 ring-blue-600"
      : "border-emerald-200 bg-emerald-50 text-emerald-800",
    disabled ? "cursor-not-allowed opacity-45" : "active:scale-[0.99]",
  ].join(" ");

export default function TimeSelection({
  label,
  valueKey,
  customStart,
  customEnd,
  onPresetChange,
  onCustomStartChange,
  onCustomEndChange,
  customError,
  disabled = false,
  includeMorningChoices = [],
}: Props) {
  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="text-sm font-bold text-slate-800">{label}</legend>

      {includeMorningChoices.length > 0 && (
        <div className="grid grid-cols-3 gap-2" style={compactGridStyle} aria-label={`${label} 午前`} data-time-selection-grid="morning">
          {includeMorningChoices.map((choice) => (
            <button
              key={choice.key}
              type="button"
              aria-pressed={valueKey === choice.key}
              disabled={disabled || choice.disabled}
              className={buttonClass(valueKey === choice.key, disabled || choice.disabled)}
              onClick={choice.onSelect}
            >
              {choice.label}
              {valueKey === choice.key && <span className="ml-1" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2" style={compactGridStyle} aria-label={`${label} 午後`} data-time-selection-grid="afternoon">
        {SCHEDULE_TIME_PRESETS.map((choice) => (
          <button
            key={choice.key}
            type="button"
            aria-pressed={valueKey === choice.key}
            className={buttonClass(valueKey === choice.key)}
            onClick={() => onPresetChange(choice)}
          >
            <span>{choice.label}</span>
            {valueKey === choice.key && <span className="ml-1" aria-hidden="true">✓</span>}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2" data-time-selection-range="custom">
        <label className="min-w-0">
          <span className="sr-only">開始時刻</span>
          <input
            type="time"
            min="08:30"
            max="17:30"
            step={1800}
            value={customStart}
            onChange={(event) => onCustomStartChange(event.target.value)}
            aria-label="開始時刻"
            className="min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-base text-slate-900"
          />
        </label>
        <span className="font-semibold text-slate-600" aria-hidden="true">～</span>
        <label className="min-w-0">
          <span className="sr-only">終了時刻</span>
          <input
            type="time"
            min="08:30"
            max="17:30"
            step={1800}
            value={customEnd}
            onChange={(event) => onCustomEndChange(event.target.value)}
            aria-label="終了時刻"
            className="min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-base text-slate-900"
          />
        </label>
      </div>
      {customError && <p role="alert" className="text-sm font-semibold text-red-700">{customError}</p>}
    </fieldset>
  );
}
