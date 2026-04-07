import { pgTable, text, serial, integer, boolean, timestamp, jsonb, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const cobaEvents = pgTable("coba_events", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  eventType: text("event_type").notNull(),
  severity: text("severity").default("info"),
  payload: jsonb("payload"),
  sessionId: text("session_id"),
  userId: text("user_id"),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const cobaReports = pgTable("coba_reports", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  reportType: text("report_type").notNull().default("weekly"),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  summary: jsonb("summary"),
  aiInsights: text("ai_insights"),
  pdfUrl: text("pdf_url"),
  pdfPath: text("pdf_path"),
  status: text("status").default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const cobaPurchases = pgTable("coba_purchases", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  supplier: text("supplier").notNull(),
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

export const cobaExpenses = pgTable("coba_expenses", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  label: text("label").default("Non spécifié"),
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

export const cobaBankEntries = pgTable("coba_bank_entries", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
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

export const cobaLoans = pgTable("coba_loans", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
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
  createdAt: timestamp("created_at").defaultNow(),
});

export const cobaCashRegister = pgTable("coba_cash_entries", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  entryDate: text("entry_date").notNull(),
  totalRevenue: real("total_revenue").notNull(),
  cashAmount: real("cash_amount").default(0),
  cbAmount: real("cb_amount").default(0),
  ubereatsAmount: real("ubereats_amount").default(0),
  deliverooAmount: real("deliveroo_amount").default(0),
  onlineAmount: real("online_amount").default(0),
  otherAmount: real("other_amount").default(0),
  coversCount: integer("covers_count").default(0),
  averageTicket: real("average_ticket").default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const cobaEmployees = pgTable("coba_employees", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
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

export const cobaPayroll = pgTable("coba_payroll", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
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
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const cobaChatSessions = pgTable("coba_chat_sessions", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  proUserId: text("pro_user_id").notNull(),
  proUserName: text("pro_user_name"),
  restaurantName: text("restaurant_name"),
  status: text("status").notNull().default("active"),
  messageCount: integer("message_count").notNull().default(0),
  lastMessageAt: timestamp("last_message_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const cobaChatMessages = pgTable("coba_chat_messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  toolCalls: jsonb("tool_calls"),
  toolResults: jsonb("tool_results"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const superChatSessions = pgTable("superchat_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").default("SuperChat"),
  activePersonas: text("active_personas").array().default(["ulysse", "iris", "alfred", "maxai"]),
  messageCount: integer("message_count").notNull().default(0),
  lastMessageAt: timestamp("last_message_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const superChatMessages = pgTable("superchat_messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  sender: text("sender").notNull(),
  senderName: text("sender_name").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCobaEventSchema = createInsertSchema(cobaEvents).omit({ id: true, createdAt: true });
export const insertCobaReportSchema = createInsertSchema(cobaReports).omit({ id: true, createdAt: true });
export const insertCobaPurchaseSchema = createInsertSchema(cobaPurchases).omit({ id: true, createdAt: true });
export const insertCobaExpenseSchema = createInsertSchema(cobaExpenses).omit({ id: true, createdAt: true });
export const insertCobaBankEntrySchema = createInsertSchema(cobaBankEntries).omit({ id: true, createdAt: true });
export const insertCobaLoanSchema = createInsertSchema(cobaLoans).omit({ id: true, createdAt: true });
export const insertCobaCashRegisterSchema = createInsertSchema(cobaCashRegister).omit({ id: true, createdAt: true });
export const insertCobaEmployeeSchema = createInsertSchema(cobaEmployees).omit({ id: true, createdAt: true });
export const insertCobaPayrollSchema = createInsertSchema(cobaPayroll).omit({ id: true, createdAt: true });
export const insertCobaChatSessionSchema = createInsertSchema(cobaChatSessions).omit({ id: true, createdAt: true, lastMessageAt: true, messageCount: true });
export const insertCobaChatMessageSchema = createInsertSchema(cobaChatMessages).omit({ id: true, createdAt: true });
export const insertSuperChatSessionSchema = createInsertSchema(superChatSessions).omit({ id: true, createdAt: true, lastMessageAt: true, messageCount: true });
export const insertSuperChatMessageSchema = createInsertSchema(superChatMessages).omit({ id: true, createdAt: true });

export type CobaEvent = typeof cobaEvents.$inferSelect;
export type InsertCobaEvent = z.infer<typeof insertCobaEventSchema>;

export type CobaReport = typeof cobaReports.$inferSelect;
export type InsertCobaReport = z.infer<typeof insertCobaReportSchema>;

export type CobaPurchase = typeof cobaPurchases.$inferSelect;
export type InsertCobaPurchase = z.infer<typeof insertCobaPurchaseSchema>;

export type CobaExpense = typeof cobaExpenses.$inferSelect;
export type InsertCobaExpense = z.infer<typeof insertCobaExpenseSchema>;

export type CobaBankEntry = typeof cobaBankEntries.$inferSelect;
export type InsertCobaBankEntry = z.infer<typeof insertCobaBankEntrySchema>;

export type CobaLoan = typeof cobaLoans.$inferSelect;
export type InsertCobaLoan = z.infer<typeof insertCobaLoanSchema>;

export type CobaCashRegister = typeof cobaCashRegister.$inferSelect;
export type InsertCobaCashRegister = z.infer<typeof insertCobaCashRegisterSchema>;

export type CobaEmployee = typeof cobaEmployees.$inferSelect;
export type InsertCobaEmployee = z.infer<typeof insertCobaEmployeeSchema>;

export type CobaPayroll = typeof cobaPayroll.$inferSelect;
export type InsertCobaPayroll = z.infer<typeof insertCobaPayrollSchema>;

export type CobaChatSession = typeof cobaChatSessions.$inferSelect;
export type InsertCobaChatSession = z.infer<typeof insertCobaChatSessionSchema>;

export type CobaChatMessage = typeof cobaChatMessages.$inferSelect;
export type InsertCobaChatMessage = z.infer<typeof insertCobaChatMessageSchema>;

export type SuperChatSession = typeof superChatSessions.$inferSelect;
export type InsertSuperChatSession = z.infer<typeof insertSuperChatSessionSchema>;

export type SuperChatMessage = typeof superChatMessages.$inferSelect;
export type InsertSuperChatMessage = z.infer<typeof insertSuperChatMessageSchema>;
