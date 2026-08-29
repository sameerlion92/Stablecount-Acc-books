export type BookkeepingAccount = { code: string; name: string };
export type BookkeepingSection = {
  id: string;
  title: string;
  description: string;
  accounts: BookkeepingAccount[];
};

export const BOOKKEEPING_SECTIONS: BookkeepingSection[] = [
  {
    id: "sales",
    title: "Sales / Revenue",
    description: "Sales invoices, credit notes, sales returns, other income",
    accounts: [
      { code: "4000", name: "Sales invoices" },
      { code: "4010", name: "Credit notes" },
      { code: "4020", name: "Sales returns" },
      { code: "4090", name: "Other income" },
    ],
  },
  {
    id: "purchases",
    title: "Purchases",
    description: "Purchase bills, debit notes, purchase returns",
    accounts: [
      { code: "5000", name: "Purchase bills" },
      { code: "5010", name: "Debit notes" },
      { code: "5020", name: "Purchase returns" },
    ],
  },
  {
    id: "receivables",
    title: "Receivables / Debtors",
    description: "Customer-wise balances, invoices outstanding, advances received",
    accounts: [
      { code: "1100", name: "Accounts receivable" },
      { code: "1110", name: "Invoices outstanding" },
      { code: "1120", name: "Advances received" },
    ],
  },
  {
    id: "payables",
    title: "Payables / Creditors",
    description: "Supplier-wise balances, bills payable, advances paid",
    accounts: [
      { code: "2000", name: "Accounts payable" },
      { code: "2010", name: "Bills payable" },
      { code: "2020", name: "Advances paid" },
    ],
  },
  {
    id: "cash",
    title: "Cash",
    description: "Cash receipts, cash payments, petty cash, cash balance",
    accounts: [
      { code: "1010", name: "Cash on hand" },
      { code: "1011", name: "Petty cash" },
      { code: "1012", name: "Cash receipts & payments" },
    ],
  },
  {
    id: "bank",
    title: "Bank",
    description: "Bank receipts/payments, bank balance, bank reconciliation",
    accounts: [
      { code: "1000", name: "Bank accounts" },
      { code: "1001", name: "Bank reconciliation" },
    ],
  },
  {
    id: "expenses",
    title: "Expenses",
    description: "Rent, salaries, electricity, travel, marketing, professional fees, etc.",
    accounts: [
      { code: "6100", name: "Rent" },
      { code: "6200", name: "Salaries & wages" },
      { code: "6300", name: "Electricity & utilities" },
      { code: "6400", name: "Travel" },
      { code: "6500", name: "Marketing" },
      { code: "6600", name: "Professional fees" },
      { code: "6900", name: "Other expenses" },
    ],
  },
  {
    id: "inventory",
    title: "Inventory / Stock",
    description: "Opening stock, purchases, consumption/sales, closing stock and valuation",
    accounts: [
      { code: "1200", name: "Opening stock" },
      { code: "1210", name: "Purchases for stock" },
      { code: "1220", name: "Consumption / sales transfer" },
      { code: "1230", name: "Closing stock" },
    ],
  },
  {
    id: "fixed-assets",
    title: "Fixed Assets",
    description: "Asset purchases, disposals, depreciation, accumulated depreciation",
    accounts: [
      { code: "1500", name: "Fixed asset cost" },
      { code: "1510", name: "Accumulated depreciation" },
      { code: "1520", name: "Depreciation expense" },
      { code: "1530", name: "Disposals & gains/losses" },
    ],
  },
  {
    id: "loans",
    title: "Loans & Borrowings",
    description: "Principal outstanding, interest accrued/paid, repayments",
    accounts: [
      { code: "2100", name: "Loan principal" },
      { code: "2110", name: "Interest accrued" },
      { code: "2120", name: "Interest paid" },
    ],
  },
  {
    id: "capital",
    title: "Capital / Equity",
    description: "Capital introduced, drawings/withdrawals, retained earnings",
    accounts: [
      { code: "3000", name: "Capital introduced" },
      { code: "3010", name: "Drawings / withdrawals" },
      { code: "3020", name: "Retained earnings" },
    ],
  },
  {
    id: "taxes",
    title: "Taxes",
    description: "GST input/output, TDS receivable/payable, income-tax provisions/advances, etc.",
    accounts: [
      { code: "1310", name: "GST / VAT input" },
      { code: "1320", name: "GST / VAT output" },
      { code: "2210", name: "TDS receivable" },
      { code: "2220", name: "TDS payable" },
      { code: "2230", name: "Income tax provision" },
      { code: "2240", name: "Tax advances" },
    ],
  },
  {
    id: "payroll",
    title: "Payroll",
    description: "Salary payable, employee advances, reimbursements and statutory deductions",
    accounts: [
      { code: "6150", name: "Salary payable" },
      { code: "6151", name: "Employee advances" },
      { code: "6152", name: "Reimbursements payable" },
      { code: "6153", name: "Statutory deductions payable" },
    ],
  },
  {
    id: "accruals",
    title: "Accruals & Provisions",
    description: "Expenses payable but not yet billed/paid",
    accounts: [
      { code: "2300", name: "Accrued expenses" },
      { code: "2310", name: "Provisions" },
    ],
  },
  {
    id: "prepaid",
    title: "Prepaid Expenses",
    description: "Expenses paid in advance",
    accounts: [{ code: "1400", name: "Prepaid expenses" }],
  },
  {
    id: "deferred",
    title: "Deferred / Unearned Revenue",
    description: "Money received before revenue is earned",
    accounts: [{ code: "2500", name: "Deferred / unearned revenue" }],
  },
];

/** Maps legacy journal account names/codes to the chart above. */
export const LEGACY_ACCOUNT_ALIASES: Record<string, string> = {
  "4000": "4000",
  "Sales Revenue": "4000",
  "Sales invoices": "4000",
  "5000": "5000",
  "Cost of Sales": "5000",
  "Purchase bills": "5000",
  "1100": "1100",
  "Accounts Receivable": "1100",
  "Accounts receivable": "1100",
  "2000": "2000",
  "Accounts Payable": "2000",
  "Accounts payable": "2000",
  "1000": "1000",
  Bank: "1000",
  "Bank accounts": "1000",
};

export const ALL_ACCOUNT_CODES = new Set(BOOKKEEPING_SECTIONS.flatMap((section) => section.accounts.map((account) => account.code)));

export function accountCodesForSection(sectionId: string) {
  const section = BOOKKEEPING_SECTIONS.find((item) => item.id === sectionId);
  return section ? section.accounts.map((account) => account.code) : [];
}

export function sectionForAccountCode(code: string) {
  const normalized = LEGACY_ACCOUNT_ALIASES[code] ?? code;
  return BOOKKEEPING_SECTIONS.find((section) => section.accounts.some((account) => account.code === normalized)) ?? null;
}

export function normalizeAccountCode(code: unknown, name?: unknown) {
  const raw = String(code ?? "").trim();
  if (LEGACY_ACCOUNT_ALIASES[raw]) return LEGACY_ACCOUNT_ALIASES[raw];
  const byName = name ? LEGACY_ACCOUNT_ALIASES[String(name)] : undefined;
  if (byName) return byName;
  return raw;
}
