export type AccountingBook = {
  id: string;
  title: string;
  description: string;
  accountCodes: string[];
  sectionId?: string;
};

export const ACCOUNTING_BOOKS: AccountingBook[] = [
  {
    id: "journal",
    title: "Journal",
    description: "Chronological record of every debit and credit posting",
    accountCodes: [],
  },
  {
    id: "general-ledger",
    title: "General Ledger",
    description: "Account-wise balances across the full chart of accounts",
    accountCodes: [],
  },
  {
    id: "cash-book",
    title: "Cash Book",
    description: "Cash receipts, cash payments, petty cash, and cash balance",
    accountCodes: ["1010", "1011", "1012"],
    sectionId: "cash",
  },
  {
    id: "bank-book",
    title: "Bank Book",
    description: "Bank receipts and payments, balances, and reconciliation",
    accountCodes: ["1000", "1001"],
    sectionId: "bank",
  },
  {
    id: "sales-register",
    title: "Sales Register",
    description: "Sales invoices, credit notes, returns, and other income",
    accountCodes: ["4000", "4010", "4020", "4090"],
    sectionId: "sales",
  },
  {
    id: "purchase-register",
    title: "Purchase Register",
    description: "Purchase bills, debit notes, and purchase returns",
    accountCodes: ["5000", "5010", "5020"],
    sectionId: "purchases",
  },
  {
    id: "debtors-ledger",
    title: "Debtors Ledger",
    description: "Customer-wise balances, invoices outstanding, advances received",
    accountCodes: ["1100", "1110", "1120"],
    sectionId: "receivables",
  },
  {
    id: "creditors-ledger",
    title: "Creditors Ledger",
    description: "Supplier-wise balances, bills payable, advances paid",
    accountCodes: ["2000", "2010", "2020"],
    sectionId: "payables",
  },
  {
    id: "fixed-asset-register",
    title: "Fixed Asset Register",
    description: "Asset purchases, disposals, depreciation, and accumulated depreciation",
    accountCodes: ["1500", "1510", "1520", "1530"],
    sectionId: "fixed-assets",
  },
  {
    id: "inventory-records",
    title: "Inventory Records",
    description: "Opening stock, purchases, consumption, closing stock and valuation",
    accountCodes: ["1200", "1210", "1220", "1230"],
    sectionId: "inventory",
  },
  {
    id: "tax-registers",
    title: "Tax Registers",
    description: "GST / VAT input and output, TDS, income-tax provisions and advances",
    accountCodes: ["1310", "1320", "2210", "2220", "2230", "2240"],
    sectionId: "taxes",
  },
];

export function accountingBook(id: string) {
  return ACCOUNTING_BOOKS.find((book) => book.id === id) ?? ACCOUNTING_BOOKS[0];
}
