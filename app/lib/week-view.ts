export function weekDaysForViewport(days: readonly string[], today: string, compact: boolean) {
  if (!compact || !days.includes(today)) return [...days];
  return [today, ...days.filter(day => day !== today)];
}
