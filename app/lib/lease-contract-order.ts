type ContractOrderRow = {
  id: string;
  contract_start_date: string | null;
  contract_end_date: string | null;
  created_at: string;
};

/** Match the database's DESC, NULLS LAST contract history ordering. */
export function sortLeaseContracts<T extends ContractOrderRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    for (const key of ["contract_start_date", "contract_end_date", "created_at", "id"] as const) {
      const left = a[key], right = b[key];
      if (left === right) continue;
      if (left === null) return 1;
      if (right === null) return -1;
      return left > right ? -1 : 1;
    }
    return 0;
  });
}
