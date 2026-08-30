import type { OrderRegisterRow } from "./order-register";

export type OrderExportInput = {
  rows: OrderRegisterRow[];
  filterLabel: string;
  formatAmount: (value: number, currency?: string) => string;
};

function fileStem(filterLabel: string) {
  const safe = filterLabel.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "all";
  return `order-register-${safe}-${new Date().toISOString().slice(0, 10)}`;
}

function sheetRows(input: OrderExportInput) {
  const { rows, formatAmount } = input;
  const headers = [
    "Order",
    "Client",
    "Supplier",
    "Description",
    "Status",
    "Created",
    "Expected",
    "Purchase price",
    "Purchase currency",
    "Sale price",
    "Sale currency",
    "Commission %",
  ];
  const body = rows.map((row) => [
    row.orderNo,
    row.client,
    row.supplier,
    row.description,
    row.status,
    row.createdAt || "—",
    row.expectedDate || "—",
    formatAmount(row.purchasePrice, row.purchaseCurrency),
    row.purchaseCurrency,
    formatAmount(row.salePrice, row.saleCurrency),
    row.saleCurrency,
    row.commissionPercent,
  ]);
  return { headers, body };
}

export async function downloadOrderRegisterExcel(input: OrderExportInput) {
  const XLSX = await import("xlsx");
  const { headers, body } = sheetRows(input);
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Order register"],
    [`Filters: ${input.filterLabel}`],
    [],
    headers,
    ...body,
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Orders");
  XLSX.writeFile(workbook, `${fileStem(input.filterLabel)}.xlsx`);
}

export async function downloadOrderRegisterPdf(input: OrderExportInput) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const { headers, body } = sheetRows(input);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const margin = 40;
  doc.setFontSize(16);
  doc.text("Order register", margin, 36);
  doc.setFontSize(10);
  doc.text(`Filters: ${input.filterLabel}`, margin, 54);
  doc.text(`${input.rows.length} orders`, margin, 68);
  autoTable(doc, {
    startY: 82,
    head: [headers],
    body: body.map((row) => row.map((cell) => String(cell ?? ""))),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [23, 111, 143] },
    margin: { left: margin, right: margin },
  });
  doc.save(`${fileStem(input.filterLabel)}.pdf`);
}
