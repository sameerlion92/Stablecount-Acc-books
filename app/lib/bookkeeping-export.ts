import type { GeneralLedgerAccount, JournalEntryGroup, PartyLedger, RegisterRow, TaxRegisterRow, AccountBalance } from "./bookkeeping";
import type { OrderRegisterRow } from "./order-register";
import { accountingBook } from "./accounting-books";
import { exportFileStem, formatPeriodLabel } from "./bookkeeping-period";

export type ExportSheet = {
  name: string;
  headers: string[];
  rows: Array<Array<string | number>>;
};

export type BookExportInput = {
  bookId: string;
  bookTitle: string;
  periodLabel: string;
  financialYear: string;
  month: string;
  currency: string;
  journalGroups?: JournalEntryGroup[];
  generalLedger?: GeneralLedgerAccount[];
  bookAccounts?: AccountBalance[];
  bookJournal?: Array<Record<string, string | number | boolean | null>>;
  salesRegister?: RegisterRow[];
  purchaseRegister?: RegisterRow[];
  debtors?: PartyLedger[];
  creditors?: PartyLedger[];
  taxRegisters?: TaxRegisterRow[];
  banks?: Array<Record<string, string | number | boolean | null> & { id: number }>;
  orderRegister?: OrderRegisterRow[];
  formatAmount?: (value: number, currency?: string) => string;
};

function amount(value: number, currency: string, formatAmount?: BookExportInput["formatAmount"]) {
  if (formatAmount) return formatAmount(value, currency);
  return Number(value.toFixed(2));
}

function sanitizeSheetName(name: string) {
  return name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet";
}

export function buildBookExportSheets(input: BookExportInput): ExportSheet[] {
  const { bookId, currency, formatAmount } = input;
  const fmt = (value: number, rowCurrency = currency) => amount(value, rowCurrency, formatAmount);

  if (bookId === "journal" && input.journalGroups) {
    return [{
      name: "Journal",
      headers: ["Date", "Reference", "Memo", "Account", "Client", "Debit", "Credit"],
      rows: input.journalGroups.flatMap((entry) => entry.lines.map((line, index) => [
        index === 0 ? entry.entry_date : "",
        index === 0 ? `${entry.reference_type} #${entry.reference_id}` : "",
        index === 0 ? entry.memo : "",
        `${line.account_code} ${line.account_name}`,
        line.client_name || "—",
        line.debit ? fmt(line.debit) : "",
        line.credit ? fmt(line.credit) : "",
      ])),
    }];
  }

  if (bookId === "general-ledger" && input.generalLedger) {
    return input.generalLedger.map((account) => ({
      name: sanitizeSheetName(`${account.code} ${account.name}`),
      headers: ["Date", "Memo", "Client", "Debit", "Credit", "Balance"],
      rows: [
        ...account.transactions.map((row) => [
          row.entry_date,
          row.memo,
          row.client_name || "—",
          row.debit ? fmt(row.debit) : "",
          row.credit ? fmt(row.credit) : "",
          "",
        ]),
        ["", "", "Account total", fmt(account.debit), fmt(account.credit), fmt(account.balance)],
      ],
    }));
  }

  if ((bookId === "sales-register" || bookId === "purchase-register")) {
    const rows = bookId === "sales-register" ? input.salesRegister ?? [] : input.purchaseRegister ?? [];
    return [{
      name: sanitizeSheetName(accountingBook(bookId).title),
      headers: ["Date", "Document", "Party", "Reference", "Subtotal", "Tax", "Total", "Paid", "Status", "Currency"],
      rows: rows.map((row) => [
        row.date,
        row.document,
        row.party,
        row.reference,
        fmt(row.subtotal, row.currency),
        fmt(row.tax, row.currency),
        fmt(row.total, row.currency),
        fmt(row.paid, row.currency),
        row.status,
        row.currency,
      ]),
    }];
  }

  if (bookId === "order-register" && input.orderRegister) {
    return [{
      name: "Order register",
      headers: ["Order", "Client", "Supplier", "Description", "Status", "Created", "Expected", "Purchase price", "Purchase currency", "Sale price", "Sale currency", "Commission %"],
      rows: input.orderRegister.map((row) => [
        row.orderNo,
        row.client,
        row.supplier,
        row.description,
        row.status,
        row.createdAt || "—",
        row.expectedDate || "—",
        fmt(row.purchasePrice, row.purchaseCurrency),
        row.purchaseCurrency,
        fmt(row.salePrice, row.saleCurrency),
        row.saleCurrency,
        row.commissionPercent,
      ]),
    }];
  }

  if ((bookId === "debtors-ledger" || bookId === "creditors-ledger")) {
    const parties = bookId === "debtors-ledger" ? input.debtors ?? [] : input.creditors ?? [];
    const summary: ExportSheet = {
      name: "Summary",
      headers: ["Party", "Balance", "Currency"],
      rows: parties.map((party) => [party.name, fmt(party.balance, party.currency), party.currency]),
    };
    const detail = parties.map((party) => ({
      name: sanitizeSheetName(party.name),
      headers: ["Date", "Memo", "Debit", "Credit", "Balance"],
      rows: party.transactions.map((row) => [
        row.entry_date,
        row.memo,
        row.debit ? fmt(row.debit, party.currency) : "",
        row.credit ? fmt(row.credit, party.currency) : "",
        fmt(row.balance, party.currency),
      ]),
    }));
    return detail.length ? [summary, ...detail] : [summary];
  }

  if (bookId === "tax-registers" && input.taxRegisters) {
    return [{
      name: "Tax registers",
      headers: ["Account", "Name", "Debit", "Credit", "Balance", "Invoice tax in", "Invoice tax out"],
      rows: input.taxRegisters.map((row) => [
        row.code,
        row.name,
        row.debit ? fmt(row.debit) : "",
        row.credit ? fmt(row.credit) : "",
        row.debit || row.credit ? fmt(row.balance) : "",
        row.invoiceTaxIn ? fmt(row.invoiceTaxIn) : "",
        row.invoiceTaxOut ? fmt(row.invoiceTaxOut) : "",
      ]),
    }];
  }

  const sheets: ExportSheet[] = [];
  if (input.bookAccounts?.length) {
    sheets.push({
      name: "Accounts",
      headers: ["Account", "Name", "Debit", "Credit", "Balance"],
      rows: input.bookAccounts.map((row) => [
        row.code,
        row.name,
        row.debit ? fmt(row.debit) : "",
        row.credit ? fmt(row.credit) : "",
        row.debit || row.credit ? fmt(row.balance) : "",
      ]),
    });
  }
  if (bookId === "bank-book" && input.banks?.length) {
    sheets.push({
      name: "Bank balances",
      headers: ["Bank account", "Current balance", "Currency"],
      rows: input.banks.map((bank) => [
        String(bank.nickname || bank.bank_name || "Bank"),
        fmt(Number(bank.balance || 0), String(bank.currency || currency)),
        String(bank.currency || currency),
      ]),
    });
  }
  if (input.bookJournal?.length) {
    sheets.push({
      name: "Postings",
      headers: ["Date", "Reference", "Account", "Client", "Debit", "Credit"],
      rows: input.bookJournal.map((row) => [
        String(row.entry_date || ""),
        String(row.memo || ""),
        `${row.account_code} ${row.account_name}`,
        String(row.client_name || "—"),
        Number(row.debit) ? fmt(Number(row.debit)) : "",
        Number(row.credit) ? fmt(Number(row.credit)) : "",
      ]),
    });
  }
  return sheets.length ? sheets : [{ name: "Register", headers: ["Message"], rows: [["No rows for the selected period."]] }];
}

export async function downloadBookExcel(input: BookExportInput) {
  const XLSX = await import("xlsx");
  const sheets = buildBookExportSheets(input);
  const rangeLabel = input.bookId === "order-register" ? "Filters" : "Period";
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet([[input.bookTitle], [`${rangeLabel}: ${input.periodLabel}`], [`Currency: ${input.currency}`], [], sheet.headers, ...sheet.rows]);
    XLSX.utils.book_append_sheet(workbook, worksheet, sanitizeSheetName(sheet.name));
  }
  const stem = exportFileStem(input.bookTitle, input.financialYear, input.month);
  XLSX.writeFile(workbook, `${stem}.xlsx`);
}

export async function downloadBookPdf(input: BookExportInput) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const sheets = buildBookExportSheets(input);
  const margin = 40;
  let first = true;

  for (const sheet of sheets) {
    if (!first) doc.addPage();
    first = false;
    const rangeLabel = input.bookId === "order-register" ? "Filters" : "Period";
    doc.setFontSize(16);
    doc.text(input.bookTitle, margin, 36);
    doc.setFontSize(10);
    doc.text(`${rangeLabel}: ${input.periodLabel}`, margin, 54);
    doc.text(`Currency: ${input.currency}`, margin, 68);
    if (sheets.length > 1) doc.text(sheet.name, margin, 82);

    autoTable(doc, {
      startY: sheets.length > 1 ? 92 : 82,
      head: [sheet.headers],
      body: sheet.rows.map((row) => row.map((cell) => String(cell ?? ""))),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [23, 111, 143] },
      margin: { left: margin, right: margin },
    });
  }

  const stem = exportFileStem(input.bookTitle, input.financialYear, input.month);
  doc.save(`${stem}.pdf`);
}

export function periodLabelForExport(financialYear: string, month: string) {
  return formatPeriodLabel(financialYear, month);
}
