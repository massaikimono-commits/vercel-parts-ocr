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
    "min-h-11 w-full min-w-0 whitespace-nowrap rounded-lg border px-1.5 py-1.5 text-xs font-semibold leading-none transition sm:text-sm",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2",
    selected
      ? "border-blue-600 bg-white text-blue-700 ring-2 ring-blue-600"
      : "border-emerald-300 bg-emerald-50 text-emerald-800",
    disabled ? "cursor-not-allowed opacity-45" : "active:scale-[0.99]",
  ].join(" ");

const buttonVisualStyle = (selected: boolean) =>
  selected
    ? ({ backgroundColor: "#ffffff", color: "#1d4ed8", borderColor: "#2563eb" } as const)
    : ({ backgroundColor: "#ecfdf5", color: "#047857", borderColor: "#a7f3d0" } as const);

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
          {includeMorningChoices.map((choice) => {
            const selected = valueKey === choice.key;
            return (
              <button
                key={choice.key}
                type="button"
                aria-pressed={selected}
                disabled={disabled || choice.disabled}
                className={buttonClass(selected, disabled || choice.disabled)}
                style={buttonVisualStyle(selected)}
                onClick={choice.onSelect}
              >
                <span className="inline-flex items-center justify-center whitespace-nowrap">
                  {selected && <span className="mr-0.5" aria-hidden="true">✓</span>}
                  {choice.label}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2" style={compactGridStyle} aria-label={`${label} 午後`} data-time-selection-grid="afternoon">
        {SCHEDULE_TIME_PRESETS.map((choice) => {
          const selected = valueKey === choice.key;
          return (
            <button
              key={choice.key}
              type="button"
              aria-pressed={selected}
              className={buttonClass(selected)}
              style={buttonVisualStyle(selected)}
              onClick={() => onPresetChange(choice)}
            >
              <span className="inline-flex items-center justify-center whitespace-nowrap">
                {selected && <span className="mr-0.5" aria-hidden="true">✓</span>}
                {choice.label}
              </span>
            </button>
          );
        })}
      </div>

      <div
        className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2"
        style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", alignItems: "center", gap: "0.5rem" }}
        data-time-selection-range="custom"
      >
        <input
          type="time"
          min="08:30"
          max="17:30"
          step={1800}
          value={customStart}
          onChange={(event) => onCustomStartChange(event.target.value)}
          aria-label="開始時刻"
          className="min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900"
        />
        <span className="font-semibold text-slate-600" aria-hidden="true">～</span>
        <input
          type="time"
          min="08:30"
          max="17:30"
          step={1800}
          value={customEnd}
          onChange={(event) => onCustomEndChange(event.target.value)}
          aria-label="終了時刻"
          className="min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900"
        />
      </div>
      {customError && <p role="alert" className="text-sm font-semibold text-red-700">{customError}</p>}
    </fieldset>
  );
}
