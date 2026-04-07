import { pgTable, text, serial, integer, boolean, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const sugumTrash = pgTable("sugum_trash", {
  id: serial("id").primaryKey(),
  originalFileId: integer("original_file_id"),
  fileName: text("file_name").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  category: text("category").notNull(),
  fileType: text("file_type").notNull().default("file"),
  supplier: text("supplier"),
  description: text("description"),
  fileDate: text("file_date"),
  storagePath: text("storage_path").notNull(),
  emailedTo: text("emailed_to").array(),
  deletedAt: timestamp("deleted_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const suguMaillaneSuppliers = pgTable("sugum_suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  shortName: text("short_name"),
  siret: text("siret"),
  tvaNumber: text("tva_number"),
  accountNumber: text("account_number"),
  address: text("address"),
  city: text("city"),
  postalCode: text("postal_code"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  contactName: text("contact_name"),
  category: text("category").default("autre"),
  paymentTerms: text("payment_terms"),
  defaultPaymentMethod: text("default_payment_method"),
  bankIban: text("bank_iban"),
  bankBic: text("bank_bic"),
  notes: text("notes"),
  totalPurchases: real("total_purchases").default(0),
  totalExpenses: real("total_expenses").default(0),
  invoiceCount: integer("invoice_count").default(0),
  lastInvoiceDate: text("last_invoice_date"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const suguMaillanePurchases = pgTable("sugum_purchases", {
  id: serial("id").primaryKey(),
  supplier: text("supplier").notNull(),
  supplierId: integer("supplier_id"),
  description: text("description"),
  category: text("category").notNull().default("alimentaire"),
  amount: real("amount").notNull(),
  taxAmount: real("tax_amount").default(0),
  invoiceNumber: text("invoice_number"),
  invoiceDate: text("invoice_date"),
  dueDate: text("due_date"),
  isPaid: boolean("is_paid").notNull().default(false),
  paidDate: text("paid_date"),
  paymentMethod: text("payment_method"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const suguMaillaneExpenses = pgTable("sugum_general_expenses", {
  id: serial("id").primaryKey(),
  label: text("label").default("Non spécifié"),
  supplierId: integer("supplier_id"),
  category: text("category").notNull().default("energie"),
  description: text("description").notNull().default(""),
  amount: real("amount").notNull(),
  taxAmount: real("tax_amount").default(0),
  period: text("period"),
  frequency: text("frequency").default("mensuel"),
  dueDate: text("due_date"),
  isPaid: boolean("is_paid").notNull().default(false),
  paidDate: text("paid_date"),
  paymentMethod: text("payment_method"),
  isRecurring: boolean("is_recurring").notNull().default(false),
  invoiceNumber: text("invoice_number"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const suguMaillaneFiles = pgTable("sugum_files", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  category: text("category").notNull(),
  fileType: text("file_type").notNull().default("file"),
  supplier: text("supplier"),
  description: text("description"),
  fileDate: text("file_date"),
  storagePath: text("storage_path").notNull(),
  employeeId: integer("employee_id"),
  createdAt: timestamp("created_at").defaultNow(),
  emailedTo: text("emailed_to").array(),
});

export const suguMaillaneBankEntries = pgTable("sugum_bank_entries", {
  id: serial("id").primaryKey(),
  bankName: text("bank_name").notNull().default("Banque Principale"),
  entryDate: text("entry_date").notNull(),
  label: text("label").notNull(),
  amount: real("amount").notNull(),
  balance: real("balance"),
  category: text("category"),
  isReconciled: boolean("is_reconciled").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const suguMaillaneLoans = pgTable("sugum_loans", {
  id: serial("id").primaryKey(),
  bankName: text("bank_name").notNull(),
  loanLabel: text("loan_label").notNull(),
  loanType: text("loan_type").notNull().default("emprunt"),
  totalAmount: real("total_amount").notNull(),
  remainingAmount: real("remaining_amount").notNull(),
  monthlyPayment: real("monthly_payment").notNull(),
  interestRate: real("interest_rate"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  notes: text("notes"),
  originalFileId: integer("original_file_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const suguMaillaneCashRegister = pgTable("sugum_cash_entries", {
  id: serial("id").primaryKey(),
  entryDate: text("entry_date").notNull(),
  totalRevenue: real("total_revenue").notNull(),
  cashAmount: real("cash_amount").default(0),
  cbAmount: real("cb_amount").default(0),
  cbzenAmount: real("cbzen_amount").default(0),
  trAmount: real("tr_amount").default(0),
  ctrAmount: real("ctr_amount").default(0),
  ubereatsAmount: real("ubereats_amount").default(0),
  deliverooAmount: real("deliveroo_amount").default(0),
  chequeAmount: real("cheque_amount").default(0),
  virementAmount: real("virement_amount").default(0),
  ticketRestoAmount: real("ticket_resto_amount").default(0),
  onlineAmount: real("online_amount").default(0),
  coversCount: integer("covers_count").default(0),
  averageTicket: real("average_ticket").default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const suguMaillaneEmployees = pgTable("sugum_employees", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  role: text("role").notNull(),
  contractType: text("contract_type").notNull().default("CDI"),
  monthlySalary: real("monthly_salary"),
  hourlyRate: real("hourly_rate"),
  weeklyHours: real("weekly_hours").default(35),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  isActive: boolean("is_active").notNull().default(true),
  phone: text("phone"),
  email: text("email"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const suguMaillanePayroll = pgTable("sugum_payroll", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  period: text("period").notNull(),
  grossSalary: real("gross_salary").notNull(),
  netSalary: real("net_salary").notNull(),
  socialCharges: real("social_charges").default(0),
  employerCharges: real("employer_charges"),
  totalEmployerCost: real("total_employer_cost"),
  bonus: real("bonus").default(0),
  overtime: real("overtime").default(0),
  isPaid: boolean("is_paid").notNull().default(false),
  paidDate: text("paid_date"),
  pdfPath: text("pdf_path"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const suguMaillaneAbsences = pgTable("sugum_absences", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  type: text("type").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  duration: real("duration"),
  isApproved: boolean("is_approved").notNull().default(false),
  reason: text("reason"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSuguMaillaneSupplierSchema = createInsertSchema(suguMaillaneSuppliers).omit({ id: true, createdAt: true });
export const insertSuguMaillanePurchaseSchema = createInsertSchema(suguMaillanePurchases).omit({ id: true, createdAt: true });
export const insertSuguMaillaneExpenseSchema = createInsertSchema(suguMaillaneExpenses).omit({ id: true, createdAt: true });
export const insertSuguMaillaneFileSchema = createInsertSchema(suguMaillaneFiles).omit({ id: true, createdAt: true });
export const insertSuguMaillaneBankEntrySchema = createInsertSchema(suguMaillaneBankEntries).omit({ id: true, createdAt: true });
export const insertSuguMaillaneLoanSchema = createInsertSchema(suguMaillaneLoans).omit({ id: true, createdAt: true });
export const insertSuguMaillaneCashRegisterSchema = createInsertSchema(suguMaillaneCashRegister).omit({ id: true, createdAt: true });
export const insertSuguMaillaneEmployeeSchema = createInsertSchema(suguMaillaneEmployees).omit({ id: true, createdAt: true });
export const insertSuguMaillanePayrollSchema = createInsertSchema(suguMaillanePayroll).omit({ id: true, createdAt: true });
export const insertSuguMaillaneAbsenceSchema = createInsertSchema(suguMaillaneAbsences).omit({ id: true, createdAt: true });

export type SugumTrashItem = typeof sugumTrash.$inferSelect;

export type SuguMaillaneSupplier = typeof suguMaillaneSuppliers.$inferSelect;

export type SuguMaillanePurchase = typeof suguMaillanePurchases.$inferSelect;

export type SuguMaillaneExpense = typeof suguMaillaneExpenses.$inferSelect;

export type SuguMaillaneFile = typeof suguMaillaneFiles.$inferSelect;

export type SuguMaillaneBankEntry = typeof suguMaillaneBankEntries.$inferSelect;

export type SuguMaillaneLoan = typeof suguMaillaneLoans.$inferSelect;

export type SuguMaillaneCashRegister = typeof suguMaillaneCashRegister.$inferSelect;

export type SuguMaillaneEmployee = typeof suguMaillaneEmployees.$inferSelect;

export type SuguMaillanePayroll = typeof suguMaillanePayroll.$inferSelect;

export type SuguMaillaneAbsence = typeof suguMaillaneAbsences.$inferSelect;
