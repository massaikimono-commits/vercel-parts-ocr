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

const buttonClass = (selected: boolean, disabled = false) =>
  [
    "min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold transition",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700 focus-visible:ring-offset-2",
    selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-800",
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
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={`${label} 午前`}>
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
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={`${label} 午後`}>
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

      <div className="rounded-xl border border-slate-300 bg-slate-50 p-3">
        <div className="mb-2 text-sm font-semibold text-slate-800">任意時間帯</div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <label className="min-w-0">
            <span className="sr-only">開始時刻</span>
            <input
              type="time"
              min="08:30"
              max="17:30"
              step={1800}
              value={customStart}
              onChange={(event) => onCustomStartChange(event.target.value)}
              className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-base text-slate-900"
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
              className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-base text-slate-900"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-600">08:30～17:30・30分刻み。開始時刻は終了時刻より前にしてください。</p>
        {customError && <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{customError}</p>}
      </div>
    </fieldset>
  );
}
