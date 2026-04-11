import { pgTable, text, serial, integer, boolean, timestamp, jsonb, real, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const suguvalCategories = pgTable("suguval_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameVi: text("name_vi"),
  nameTh: text("name_th"),
  sheet: text("sheet").notNull().default("Feuil1"),
  zone: integer("zone").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const suguvalItems = pgTable("suguval_items", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").notNull(),
  name: text("name").notNull(),
  nameVi: text("name_vi"),
  nameTh: text("name_th"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const suguvalChecks = pgTable("suguval_checks", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull(),
  checkDate: text("check_date").notNull(),
  isChecked: boolean("is_checked").notNull().default(false),
  checkedAt: timestamp("checked_at"),
  note: text("note"),
});

export const suguvalFutureItems = pgTable("suguval_future_items", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull(),
  targetDate: text("target_date").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const suguvalEmailLogs = pgTable("suguval_email_logs", {
  id: serial("id").primaryKey(),
  sentAt: timestamp("sent_at").defaultNow(),
  emailDate: text("email_date").notNull(),
  itemCount: integer("item_count").notNull(),
  itemsList: text("items_list").notNull(),
  success: boolean("success").notNull().default(true),
  error: text("error"),
});

export const suguvalComments = pgTable("suguval_comments", {
  id: serial("id").primaryKey(),
  author: text("author").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const sugumaillaneCategories = pgTable("sugumaillane_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameVi: text("name_vi"),
  nameTh: text("name_th"),
  sheet: text("sheet").notNull().default("Feuil1"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const sugumaillaneItems = pgTable("sugumaillane_items", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").notNull(),
  name: text("name").notNull(),
  nameVi: text("name_vi"),
  nameTh: text("name_th"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const sugumaillaneChecks = pgTable("sugumaillane_checks", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull(),
  checkDate: text("check_date").notNull(),
  isChecked: boolean("is_checked").notNull().default(false),
  checkedAt: timestamp("checked_at"),
  note: text("note"),
});

export const sugumaillaneFutureItems = pgTable("sugumaillane_future_items", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull(),
  targetDate: text("target_date").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const sugumaillaneEmailLogs = pgTable("sugumaillane_email_logs", {
  id: serial("id").primaryKey(),
  sentAt: timestamp("sent_at").defaultNow(),
  emailDate: text("email_date").notNull(),
  itemCount: integer("item_count").notNull(),
  itemsList: text("items_list").notNull(),
  success: boolean("success").notNull().default(true),
  error: text("error"),
});

export const suguAnalytics = pgTable("sugu_analytics", {
  id: serial("id").primaryKey(),
  store: text("store").notNull(),
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

export const suguSuppliers = pgTable("sugu_suppliers", {
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

export const suguPurchases = pgTable("sugu_purchases", {
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

export const suguExpenses = pgTable("sugu_general_expenses", {
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

export const suguFiles = pgTable("sugu_files", {
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

export const suguTrash = pgTable("sugu_trash", {
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

export const suguBankEntries = pgTable("sugu_bank_entries", {
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

export const suguLoans = pgTable("sugu_loans", {
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

export const suguCashRegister = pgTable("sugu_cash_entries", {
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

export const suguEmployees = pgTable("sugu_employees", {
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

export const suguPayroll = pgTable("sugu_payroll", {
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

export const suguAbsences = pgTable("sugu_absences", {
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

export const suguBackups = pgTable("sugu_backups", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  dataJson: text("data_json").notNull(),
  tableCounts: text("table_counts"),
  sizeBytes: integer("size_bytes").default(0),
});

export const suguSupplierKnowledge = pgTable("sugu_supplier_knowledge", {
  id: serial("id").primaryKey(),
  restaurant: text("restaurant").notNull().default("val"),
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
  uniqueIndex("sugu_supplier_knowledge_restaurant_norm_idx").on(t.restaurant, t.supplierNorm),
]));

export type SuguSupplierKnowledge = typeof suguSupplierKnowledge.$inferSelect;

export const insertSuguvalCategorySchema = createInsertSchema(suguvalCategories).omit({ id: true, createdAt: true });
export const insertSuguvalItemSchema = createInsertSchema(suguvalItems).omit({ id: true, createdAt: true });
export const insertSuguvalCheckSchema = createInsertSchema(suguvalChecks).omit({ id: true });
export const insertSuguvalFutureItemSchema = createInsertSchema(suguvalFutureItems).omit({ id: true, createdAt: true });
export const insertSuguvalEmailLogSchema = createInsertSchema(suguvalEmailLogs).omit({ id: true, sentAt: true });
export const insertSuguvalCommentSchema = createInsertSchema(suguvalComments).omit({ id: true, createdAt: true });
export const insertSugumaillaneCategorySchema = createInsertSchema(sugumaillaneCategories).omit({ id: true, createdAt: true });
export const insertSugumaillaneItemSchema = createInsertSchema(sugumaillaneItems).omit({ id: true, createdAt: true });
export const insertSugumaillaneCheckSchema = createInsertSchema(sugumaillaneChecks).omit({ id: true });
export const insertSugumaillaneFutureItemSchema = createInsertSchema(sugumaillaneFutureItems).omit({ id: true, createdAt: true });
export const insertSugumaillaneEmailLogSchema = createInsertSchema(sugumaillaneEmailLogs).omit({ id: true, sentAt: true });
export const insertSuguAnalyticsSchema = createInsertSchema(suguAnalytics).omit({ id: true, createdAt: true });
export const insertSuguSupplierSchema = createInsertSchema(suguSuppliers).omit({ id: true, createdAt: true });
export const insertSuguPurchaseSchema = createInsertSchema(suguPurchases).omit({ id: true, createdAt: true });
export const insertSuguExpenseSchema = createInsertSchema(suguExpenses).omit({ id: true, createdAt: true });
export const insertSuguFileSchema = createInsertSchema(suguFiles).omit({ id: true, createdAt: true });
export const insertSuguBankEntrySchema = createInsertSchema(suguBankEntries).omit({ id: true, createdAt: true });
export const insertSuguLoanSchema = createInsertSchema(suguLoans).omit({ id: true, createdAt: true });
export const insertSuguCashRegisterSchema = createInsertSchema(suguCashRegister).omit({ id: true, createdAt: true });
export const insertSuguEmployeeSchema = createInsertSchema(suguEmployees).omit({ id: true, createdAt: true });
export const insertSuguPayrollSchema = createInsertSchema(suguPayroll).omit({ id: true, createdAt: true });
export const insertSuguAbsenceSchema = createInsertSchema(suguAbsences).omit({ id: true, createdAt: true });

export type SuguvalCategory = typeof suguvalCategories.$inferSelect;
export type InsertSuguvalCategory = z.infer<typeof insertSuguvalCategorySchema>;

export type SuguvalItem = typeof suguvalItems.$inferSelect;
export type InsertSuguvalItem = z.infer<typeof insertSuguvalItemSchema>;

export type SuguvalCheck = typeof suguvalChecks.$inferSelect;
export type InsertSuguvalCheck = z.infer<typeof insertSuguvalCheckSchema>;

export type SuguvalFutureItem = typeof suguvalFutureItems.$inferSelect;
export type InsertSuguvalFutureItem = z.infer<typeof insertSuguvalFutureItemSchema>;

export type SuguvalEmailLog = typeof suguvalEmailLogs.$inferSelect;
export type InsertSuguvalEmailLog = z.infer<typeof insertSuguvalEmailLogSchema>;

export type SuguvalComment = typeof suguvalComments.$inferSelect;
export type InsertSuguvalComment = z.infer<typeof insertSuguvalCommentSchema>;

export type SugumaillaneCategory = typeof sugumaillaneCategories.$inferSelect;
export type InsertSugumaillaneCategory = z.infer<typeof insertSugumaillaneCategorySchema>;

export type SugumaillaneItem = typeof sugumaillaneItems.$inferSelect;
export type InsertSugumaillaneItem = z.infer<typeof insertSugumaillaneItemSchema>;

export type SugumaillaneCheck = typeof sugumaillaneChecks.$inferSelect;
export type InsertSugumaillaneCheck = z.infer<typeof insertSugumaillaneCheckSchema>;

export type SugumaillaneFutureItem = typeof sugumaillaneFutureItems.$inferSelect;
export type InsertSugumaillaneFutureItem = z.infer<typeof insertSugumaillaneFutureItemSchema>;

export type SugumaillaneEmailLog = typeof sugumaillaneEmailLogs.$inferSelect;
export type InsertSugumaillaneEmailLog = z.infer<typeof insertSugumaillaneEmailLogSchema>;

export type SuguAnalytics = typeof suguAnalytics.$inferSelect;
export type InsertSuguAnalytics = z.infer<typeof insertSuguAnalyticsSchema>;

export type SuguSupplier = typeof suguSuppliers.$inferSelect;
export type InsertSuguSupplier = z.infer<typeof insertSuguSupplierSchema>;

export type SuguPurchase = typeof suguPurchases.$inferSelect;
export type InsertSuguPurchase = z.infer<typeof insertSuguPurchaseSchema>;

export type SuguExpense = typeof suguExpenses.$inferSelect;
export type InsertSuguExpense = z.infer<typeof insertSuguExpenseSchema>;

export type SuguFile = typeof suguFiles.$inferSelect;
export type InsertSuguFile = z.infer<typeof insertSuguFileSchema>;

export type SuguTrashItem = typeof suguTrash.$inferSelect;

export type SuguBankEntry = typeof suguBankEntries.$inferSelect;
export type InsertSuguBankEntry = z.infer<typeof insertSuguBankEntrySchema>;

export type SuguLoan = typeof suguLoans.$inferSelect;
export type InsertSuguLoan = z.infer<typeof insertSuguLoanSchema>;

export type SuguCashRegister = typeof suguCashRegister.$inferSelect;
export type InsertSuguCashRegister = z.infer<typeof insertSuguCashRegisterSchema>;

export type SuguEmployee = typeof suguEmployees.$inferSelect;
export type InsertSuguEmployee = z.infer<typeof insertSuguEmployeeSchema>;

export type SuguPayroll = typeof suguPayroll.$inferSelect;
export type InsertSuguPayroll = z.infer<typeof insertSuguPayrollSchema>;

export type SuguAbsence = typeof suguAbsences.$inferSelect;
export type InsertSuguAbsence = z.infer<typeof insertSuguAbsenceSchema>;

export type SuguBackup = typeof suguBackups.$inferSelect;
