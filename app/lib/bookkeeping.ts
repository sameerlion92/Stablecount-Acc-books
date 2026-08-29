import { accountCodesForSection, BOOKKEEPING_SECTIONS, normalizeAccountCode } from "./chart-of-accounts";
import { accountingBook, ACCOUNTING_BOOKS } from "./accounting-books";
import { dateKey, isDateInRange, type DateRange } from "./bookkeeping-period";

type JournalRow = Record<string, string | number | boolean | null>;
type PartyRow = Record<string, string | number | boolean | null> & { id: number };
type InvoiceRow = Record<string, string | number | boolean | null> & { id: number };

export type AccountBalance = {
  code: string;
  name: string;
  debit: number;
  credit: number;
  balance: number;
};

export type SectionBalance = {
  id: string;
  title: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  accounts: AccountBalance[];
};

export type JournalEntryGroup = {
  id: number;
  entry_date: string;
  reference_type: string;
  reference_id: number;
  memo: string;
  debit: number;
  credit: number;
  lines: Array<{ account_code: string; account_name: string; debit: number; credit: number; client_name: string }>;
};

export type GeneralLedgerAccount = AccountBalance & {
  name: string;
  transactions: Array<{ entry_date: string; memo: string; client_name: string; debit: number; credit: number }>;
};

export type PartyLedger = {
  id: number;
  name: string;
  balance: number;
  currency: string;
  transactions: Array<{ entry_date: string; memo: string; debit: number; credit: number; balance: number }>;
};

export type RegisterRow = {
  id: number;
  date: string;
  document: string;
  party: string;
  reference: string;
  subtotal: number;
  tax: number;
  total: number;
  paid: number;
  status: string;
  currency: string;
};

export type TaxRegisterRow = {
  code: string;
  name: string;
  debit: number;
  credit: number;
  balance: number;
  invoiceTaxIn: number;
  invoiceTaxOut: number;
};

function totalsForCode(journal: JournalRow[], code: string) {
  let debit = 0;
  let credit = 0;
  for (const row of journal) {
    if (normalizeAccountCode(row.account_code, row.account_name) !== code) continue;
    debit += Number(row.debit || 0);
    credit += Number(row.credit || 0);
  }
  return { debit, credit, balance: debit - credit };
}

export function buildSectionBalances(input: {
  journal: JournalRow[];
  reportingCurrency: string;
  summary: { receivables: number; payables: number; cash: number };
  clients: PartyRow[];
  banks: PartyRow[];
}) {
  const { journal, summary, clients, banks } = input;

  return BOOKKEEPING_SECTIONS.map((section): SectionBalance => {
    const accounts = section.accounts.map((account) => {
      const totals = totalsForCode(journal, account.code);
      return { code: account.code, name: account.name, ...totals };
    });

    if (section.id === "receivables") {
      const receivable = accounts.find((account) => account.code === "1100" || account.code === "1110");
      if (receivable && receivable.debit === 0 && receivable.credit === 0 && summary.receivables > 0) {
        receivable.debit = summary.receivables;
        receivable.balance = summary.receivables;
      }
    }

    if (section.id === "payables") {
      const payable = accounts.find((account) => account.code === "2000" || account.code === "2010");
      if (payable && payable.credit === 0 && payable.debit === 0 && summary.payables > 0) {
        payable.credit = summary.payables;
        payable.balance = -summary.payables;
      }
    }

    if (section.id === "bank") {
      const bank = accounts.find((account) => account.code === "1000");
      const bankTotal = banks.reduce((sum, row) => sum + Number(row.balance || 0), 0);
      if (bank && bank.debit === 0 && bank.credit === 0 && bankTotal > 0) {
        bank.debit = bankTotal;
        bank.balance = bankTotal;
      }
    }

    if (section.id === "sales") {
      const sales = accounts.find((account) => account.code === "4000");
      const salesCredit = journal.reduce((sum, row) => normalizeAccountCode(row.account_code, row.account_name) === "4000" ? sum + Number(row.credit || 0) : sum, 0);
      if (sales && sales.credit === 0 && salesCredit > 0) {
        sales.credit = salesCredit;
        sales.balance = -salesCredit;
      }
    }

    const debit = accounts.reduce((sum, account) => sum + account.debit, 0);
    const credit = accounts.reduce((sum, account) => sum + account.credit, 0);
    return {
      id: section.id,
      title: section.title,
      description: section.description,
      debit,
      credit,
      balance: debit - credit,
      accounts,
    };
  });
}

export function filterJournalByPeriod(journal: JournalRow[], range: DateRange | null) {
  if (!range) return journal;
  return journal.filter((row) => isDateInRange(row.entry_date, range));
}

export function filterInvoicesByPeriod(invoices: InvoiceRow[], range: DateRange | null) {
  if (!range) return invoices;
  return invoices.filter((invoice) => isDateInRange(invoice.issue_date, range));
}

export function collectBookkeepingDates(journal: JournalRow[], invoices: InvoiceRow[]) {
  const dates: string[] = [];
  for (const row of journal) {
    const key = dateKey(row.entry_date);
    if (key) dates.push(key);
  }
  for (const invoice of invoices) {
    const key = dateKey(invoice.issue_date);
    if (key) dates.push(key);
  }
  return dates;
}

export function journalSummary(journal: JournalRow[]) {
  const debit = journal.reduce((sum, row) => sum + Number(row.debit || 0), 0);
  const credit = journal.reduce((sum, row) => sum + Number(row.credit || 0), 0);
  const entries = new Set(journal.map((row) => row.id)).size;
  return { debit, credit, entries };
}

export function groupJournalEntries(journal: JournalRow[]): JournalEntryGroup[] {
  const grouped = new Map<number, JournalEntryGroup>();
  for (const row of journal) {
    const id = Number(row.id);
    if (!grouped.has(id)) {
      grouped.set(id, {
        id,
        entry_date: String(row.entry_date || ""),
        reference_type: String(row.reference_type || ""),
        reference_id: Number(row.reference_id || 0),
        memo: String(row.memo || ""),
        debit: 0,
        credit: 0,
        lines: [],
      });
    }
    const entry = grouped.get(id)!;
    const debit = Number(row.debit || 0);
    const credit = Number(row.credit || 0);
    entry.debit += debit;
    entry.credit += credit;
    entry.lines.push({
      account_code: String(row.account_code || ""),
      account_name: String(row.account_name || ""),
      debit,
      credit,
      client_name: String(row.client_name || ""),
    });
  }
  return Array.from(grouped.values()).sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date)) || b.id - a.id);
}

export function buildGeneralLedger(journal: JournalRow[]): GeneralLedgerAccount[] {
  const accounts = new Map<string, GeneralLedgerAccount>();
  for (const section of BOOKKEEPING_SECTIONS) {
    for (const account of section.accounts) {
      accounts.set(account.code, {
        code: account.code,
        name: account.name,
        debit: 0,
        credit: 0,
        balance: 0,
        transactions: [],
      });
    }
  }
  for (const row of journal) {
    const code = normalizeAccountCode(row.account_code, row.account_name);
    const account = accounts.get(code) ?? {
      code,
      name: String(row.account_name || code),
      debit: 0,
      credit: 0,
      balance: 0,
      transactions: [],
    };
    const debit = Number(row.debit || 0);
    const credit = Number(row.credit || 0);
    account.debit += debit;
    account.credit += credit;
    account.balance += debit - credit;
    account.transactions.push({
      entry_date: String(row.entry_date || ""),
      memo: String(row.memo || ""),
      client_name: String(row.client_name || ""),
      debit,
      credit,
    });
    accounts.set(code, account);
  }
  return Array.from(accounts.values())
    .filter((account) => account.debit || account.credit || account.transactions.length)
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function filterJournalByBook(journal: JournalRow[], bookId: string) {
  const book = accountingBook(bookId);
  if (!book.accountCodes.length) return journal;
  const codes = new Set(book.accountCodes);
  return journal.filter((row) => codes.has(normalizeAccountCode(row.account_code, row.account_name)));
}

export function invoiceRegister(invoices: InvoiceRow[], direction: "sale" | "purchase"): RegisterRow[] {
  return invoices
    .filter((invoice) => String(invoice.direction) === direction)
    .map((invoice) => ({
      id: invoice.id,
      date: String(invoice.issue_date || ""),
      document: String(invoice.invoice_no || ""),
      party: String(invoice.client_name || ""),
      reference: String(invoice.reference || invoice.order_no || "—"),
      subtotal: Number(invoice.subtotal || 0),
      tax: Number(invoice.tax_amount || 0),
      total: Number(invoice.total || 0),
      paid: Number(invoice.paid_amount || 0),
      status: String(invoice.status || ""),
      currency: String(invoice.currency || "RUB"),
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export function partyLedgers(journal: JournalRow[], clients: PartyRow[], kind: "debtors" | "creditors"): PartyLedger[] {
  const codes = new Set(kind === "debtors" ? ["1100", "1110", "1120"] : ["2000", "2010", "2020"]);
  const balanceField = kind === "debtors" ? "receivable" : "payable";
  const relevantClients = clients.filter((client) => Number(client[balanceField] || 0) > 0 || journal.some((row) => Number(row.client_id || 0) === client.id && codes.has(normalizeAccountCode(row.account_code, row.account_name))));

  return relevantClients.map((client) => {
    const lines = journal
      .filter((row) => Number(row.client_id || 0) === client.id && codes.has(normalizeAccountCode(row.account_code, row.account_name)))
      .sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)));
    let running = 0;
    const transactions = lines.map((row) => {
      const debit = Number(row.debit || 0);
      const credit = Number(row.credit || 0);
      running += debit - credit;
      return {
        entry_date: String(row.entry_date || ""),
        memo: String(row.memo || ""),
        debit,
        credit,
        balance: running,
      };
    });
    const balance = running || Number(client[balanceField] || 0);
    return {
      id: client.id,
      name: String(client.name),
      balance,
      currency: String(client.currency || "RUB"),
      transactions,
    };
  }).sort((a, b) => b.balance - a.balance);
}

export function buildTaxRegisters(journal: JournalRow[], invoices: InvoiceRow[]): TaxRegisterRow[] {
  const section = BOOKKEEPING_SECTIONS.find((item) => item.id === "taxes");
  const salesTax = invoices.filter((invoice) => String(invoice.direction) === "sale").reduce((sum, invoice) => sum + Number(invoice.tax_amount || 0), 0);
  const purchaseTax = invoices.filter((invoice) => String(invoice.direction) === "purchase").reduce((sum, invoice) => sum + Number(invoice.tax_amount || 0), 0);

  return (section?.accounts ?? []).map((account) => {
    const totals = totalsForCode(journal, account.code);
    const row: TaxRegisterRow = { code: account.code, name: account.name, ...totals, invoiceTaxIn: 0, invoiceTaxOut: 0 };
    if (account.code === "1310" || account.code === "2210" || account.code === "2240") row.invoiceTaxIn = purchaseTax;
    if (account.code === "1320" || account.code === "2220" || account.code === "2230") row.invoiceTaxOut = salesTax;
    return row;
  });
}

export function sectionForBook(bookId: string) {
  const book = accountingBook(bookId);
  if (!book.sectionId) return null;
  return book.sectionId;
}

export function accountsForBook(bookId: string, sections: SectionBalance[]) {
  const sectionId = sectionForBook(bookId);
  if (!sectionId) return [];
  return sections.find((section) => section.id === sectionId)?.accounts ?? [];
}

export { ACCOUNTING_BOOKS, accountCodesForSection };

export function filterJournalBySection(journal: JournalRow[], sectionId: string | null) {
  if (!sectionId) return journal;
  const codes = new Set(accountCodesForSection(sectionId));
  return journal.filter((row) => codes.has(normalizeAccountCode(row.account_code, row.account_name)));
}

export function partyBalancesForSection(sectionId: string, clients: PartyRow[]) {
  if (sectionId === "receivables") {
    return clients
      .filter((client) => Number(client.receivable || 0) > 0)
      .map((client) => ({ id: client.id, name: String(client.name), amount: Number(client.receivable || 0), currency: String(client.currency || "RUB") }))
      .sort((a, b) => b.amount - a.amount);
  }
  if (sectionId === "payables") {
    return clients
      .filter((client) => Number(client.payable || 0) > 0)
      .map((client) => ({ id: client.id, name: String(client.name), amount: Number(client.payable || 0), currency: String(client.currency || "RUB") }))
      .sort((a, b) => b.amount - a.amount);
  }
  return [];
}
