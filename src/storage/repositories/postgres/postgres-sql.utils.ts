export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error("chunk size must be > 0");
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function buildValuesPlaceholders(
  rowCount: number,
  columnCount: number,
  startParameterIndex = 1,
): string {
  if (rowCount <= 0) {
    throw new Error("rowCount must be > 0");
  }
  if (columnCount <= 0) {
    throw new Error("columnCount must be > 0");
  }

  const rows: string[] = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const columns: string[] = [];
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const parameterIndex = startParameterIndex + rowIndex * columnCount + columnIndex;
      columns.push(`$${parameterIndex}`);
    }
    rows.push(`(${columns.join(", ")})`);
  }
  return rows.join(", ");
}

export function minIso(a: string, b: string): string {
  return a <= b ? a : b;
}

export function maxIso(a: string, b: string): string {
  return a >= b ? a : b;
}

export function minNullableIso(a?: string, b?: string): string | undefined {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return minIso(a, b);
}
