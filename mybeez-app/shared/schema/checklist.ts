import { pgTable, text, serial, integer, boolean, timestamp, jsonb, real, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Checklist tables ────────────────────────────────────────────────

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameVi: text("name_vi"),
  nameTh: text("name_th"),
  sheet: text("sheet").notNull().default("Feuil1"),
  zone: integer("zone"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const items = pgTable("items", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").notNull(),
  name: text("name").notNull(),
  nameVi: text("name_vi"),
  nameTh: text("name_th"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const checks = pgTable("checks", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull(),
  checkDate: text("check_date").notNull(),
  isChecked: boolean("is_checked").notNull().default(false),
  checkedAt: timestamp("checked_at"),
  note: text("note"),
});

export const futureItems = pgTable("future_items", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull(),
  targetDate: text("target_date").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const emailLogs = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  sentAt: timestamp("sent_at").defaultNow(),
  emailDate: text("email_date").notNull(),
  itemCount: integer("item_count").notNull(),
  itemsList: text("items_list").notNull(),
  success: boolean("success").notNull().default(true),
  error: text("error"),
});

export const comments = pgTable("comments", {
  id: serial("id").primaryKey(),
  author: text("author").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Business tables ─────────────────────────────────────────────────

export const suppliers = pgTable("suppliers", {
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

export const purchases = pgTable("purchases", {
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

export const generalExpenses = pgTable("general_expenses", {
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

export const files = pgTable("files", {
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

export const trash = pgTable("trash", {
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

export const bankEntries = pgTable("bank_entries", {
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

export const loans = pgTable("loans", {
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

export const cashEntries = pgTable("cash_entries", {
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

export const employees = pgTable("employees", {
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
  socialSecurityNumber: text("social_security_number"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const payroll = pgTable("payroll", {
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

export const absences = pgTable("absences", {
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

export const backups = pgTable("backups", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  dataJson: text("data_json").notNull(),
  tableCounts: text("table_counts"),
  sizeBytes: integer("size_bytes").default(0),
});

// ─── Analytics tables ────────────────────────────────────────────────

export const analytics = pgTable("analytics", {
  id: serial("id").primaryKey(),
  analysisType: text("analysis_type").notNull(),
  itemId: integer("item_id"),
  itemName: text("item_name"),
  categoryId: integer("category_id"),
  categoryName: text("category_name"),
  period: text("period").notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  metrics: jsonb("metrics").notNull(),
  insights: jsonb("insights"),
  severity: text("severity"),
  actionRequired: boolean("action_required").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const supplierKnowledge = pgTable("supplier_knowledge", {
  id: serial("id").primaryKey(),
  supplierNorm: text("supplier_norm").notNull(),
  supplierDisplay: text("supplier_display").notNull(),
  category: text("category").notNull(),
  categoryConfidence: real("category_confidence").notNull().default(0),
  totalInvoices: integer("total_invoices").notNull().default(0),
  avgAmount: real("avg_amount"),
  minAmount: real("min_amount"),
  maxAmount: real("max_amount"),
  categoryBreakdown: jsonb("category_breakdown").default({}),
  lastLearned: timestamp("last_learned").defaultNow(),
}, (t) => ([
  uniqueIndex("supplier_knowledge_norm_idx").on(t.supplierNorm),
]));

// ─── Insert schemas ──────────────────────────────────────────────────

export const insertCategorySchema = createInsertSchema(categories).omit({ id: true, createdAt: true });
export const insertItemSchema = createInsertSchema(items).omit({ id: true, createdAt: true });
export const insertCheckSchema = createInsertSchema(checks).omit({ id: true });
export const insertFutureItemSchema = createInsertSchema(futureItems).omit({ id: true, createdAt: true });
export const insertEmailLogSchema = createInsertSchema(emailLogs).omit({ id: true, sentAt: true });
export const insertCommentSchema = createInsertSchema(comments).omit({ id: true, createdAt: true });
export const insertSupplierSchema = createInsertSchema(suppliers).omit({ id: true, createdAt: true });
export const insertPurchaseSchema = createInsertSchema(purchases).omit({ id: true, createdAt: true });
export const insertExpenseSchema = createInsertSchema(generalExpenses).omit({ id: true, createdAt: true });
export const insertFileSchema = createInsertSchema(files).omit({ id: true, createdAt: true });
export const insertBankEntrySchema = createInsertSchema(bankEntries).omit({ id: true, createdAt: true });
export const insertLoanSchema = createInsertSchema(loans).omit({ id: true, createdAt: true });
export const insertCashEntrySchema = createInsertSchema(cashEntries).omit({ id: true, createdAt: true });
export const insertEmployeeSchema = createInsertSchema(employees).omit({ id: true, createdAt: true });
export const insertPayrollSchema = createInsertSchema(payroll).omit({ id: true, createdAt: true });
export const insertAbsenceSchema = createInsertSchema(absences).omit({ id: true, createdAt: true });
export const insertAnalyticsSchema = createInsertSchema(analytics).omit({ id: true, createdAt: true });
export const insertSupplierKnowledgeSchema = createInsertSchema(supplierKnowledge).omit({ id: true, lastLearned: true });

// ─── Types ───────────────────────────────────────────────────────────

export type Category = typeof categories.$inferSelect;
export type InsertCategory = z.infer<typeof insertCategorySchema>;

export type Item = typeof items.$inferSelect;
export type InsertItem = z.infer<typeof insertItemSchema>;

export type Check = typeof checks.$inferSelect;
export type InsertCheck = z.infer<typeof insertCheckSchema>;

export type FutureItem = typeof futureItems.$inferSelect;
export type InsertFutureItem = z.infer<typeof insertFutureItemSchema>;

export type EmailLog = typeof emailLogs.$inferSelect;
export type InsertEmailLog = z.infer<typeof insertEmailLogSchema>;

export type Comment = typeof comments.$inferSelect;
export type InsertComment = z.infer<typeof insertCommentSchema>;

export type Supplier = typeof suppliers.$inferSelect;
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;

export type Purchase = typeof purchases.$inferSelect;
export type InsertPurchase = z.infer<typeof insertPurchaseSchema>;

export type Expense = typeof generalExpenses.$inferSelect;
export type InsertExpense = z.infer<typeof insertExpenseSchema>;

export type File = typeof files.$inferSelect;
export type InsertFile = z.infer<typeof insertFileSchema>;

export type TrashItem = typeof trash.$inferSelect;

export type BankEntry = typeof bankEntries.$inferSelect;
export type InsertBankEntry = z.infer<typeof insertBankEntrySchema>;

export type Loan = typeof loans.$inferSelect;
export type InsertLoan = z.infer<typeof insertLoanSchema>;

export type CashEntry = typeof cashEntries.$inferSelect;
export type InsertCashEntry = z.infer<typeof insertCashEntrySchema>;

export type Employee = typeof employees.$inferSelect;
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;

export type Payroll = typeof payroll.$inferSelect;
export type InsertPayroll = z.infer<typeof insertPayrollSchema>;

export type Absence = typeof absences.$inferSelect;
export type InsertAbsence = z.infer<typeof insertAbsenceSchema>;

export type Backup = typeof backups.$inferSelect;

export type Analytics = typeof analytics.$inferSelect;
export type InsertAnalytics = z.infer<typeof insertAnalyticsSchema>;

export type SupplierKnowledge = typeof supplierKnowledge.$inferSelect;
export type InsertSupplierKnowledge = z.infer<typeof insertSupplierKnowledgeSchema>;
