const spreadsheetFormulaPrefix = /^[=+\-@\t\r]/;

const serializeValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const escapeCsvCell = (value) => {
  const serialized = serializeValue(value);
  const safeValue = spreadsheetFormulaPrefix.test(serialized)
    ? `'${serialized}`
    : serialized;
  return `"${safeValue.replaceAll('"', '""')}"`;
};

export function downloadCsv(filename, rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const headers = [...new Set(safeRows.flatMap((row) => Object.keys(row || {})))];
  const csv = [
    headers.map(escapeCsvCell).join(","),
    ...safeRows.map((row) => headers.map((header) => escapeCsvCell(row?.[header])).join(",")),
  ].join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
