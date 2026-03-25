export interface Purchase {
    id: number; supplier: string; category: string; description?: string;
    amount: number; taxAmount?: number; invoiceNumber?: string; invoiceDate: string;
    dueDate?: string; isPaid: boolean; paymentMethod?: string;
}

export interface Expense {
    id: number; label: string; category: string; description?: string; amount: number;
    taxAmount?: number; period: string; dueDate?: string; isPaid: boolean; paidDate?: string;
    paymentMethod?: string; isRecurring: boolean; frequency?: string; notes?: string;
}

export interface BankEntry {
    id: number; bankName: string; entryDate: string; label: string;
    amount: number; balance?: number; category?: string; isReconciled: boolean; notes?: string;
}

export interface Loan {
    id: number; loanLabel: string; bankName: string; loanType: string; totalAmount: number;
    remainingAmount: number; monthlyPayment: number; interestRate?: number;
    startDate: string; endDate?: string; notes?: string; originalFileId?: number | null;
    originalFile?: SuguFile | null;
}

export interface CashEntry {
    id: number; entryDate: string; totalRevenue: number; cashAmount?: number;
    cbAmount?: number; cbzenAmount?: number; trAmount?: number; ctrAmount?: number;
    ubereatsAmount?: number; deliverooAmount?: number; chequeAmount?: number; virementAmount?: number;
    ticketRestoAmount?: number; onlineAmount?: number;
    coversCount?: number; averageTicket?: number; notes?: string;
}

export interface Employee {
    id: number; firstName: string; lastName: string; role: string;
    contractType: string; startDate: string; monthlySalary: number | null;
    hourlyRate?: number | null; weeklyHours?: number | null; isActive: boolean;
    phone?: string | null; email?: string | null; notes?: string | null;
}

export interface Payroll {
    id: number; employeeId: number; period: string; grossSalary: number;
    netSalary: number; socialCharges?: number; bonus?: number; overtime?: number;
    pdfPath?: string | null;
}

export interface Absence {
    id: number; employeeId: number; type: string; startDate: string;
    endDate?: string; duration?: number; reason?: string; isApproved: boolean;
}

export interface AuditOverview {
    year: string; requestedYear?: string; availableYears?: string[];
    totalRevenue: number; totalCosts: number; operatingProfit: number;
    profitMargin: string; totalCovers: number; operatingDays: number;
    avgDailyRevenue: number; avgTicket: number; activeEmployees: number;
    costBreakdown: { achats: number; fraisGeneraux: number; salaires: number; chargesSociales: number; emprunts: number };
    monthlyRevenue: Record<string, number>; monthlyCosts?: Record<string, number>;
    unpaidPurchases: number; unpaidExpenses: number; totalRemainingLoans: number;
    totalBankDebits?: number; totalBankCredits?: number; bankEntriesCount?: number;
    purchasesCount?: number; expensesCount?: number;
    topSuppliers?: Array<{ name: string; total: number }>;
}

export interface SuguFile {
    id: number; fileName: string; originalName: string; mimeType: string;
    fileSize: number; category: string; fileType: string; supplier?: string;
    description?: string; fileDate?: string; storagePath: string; createdAt: string;
}

export interface SugumTrashItem {
    id: number; originalFileId?: number; fileName: string; originalName: string;
    mimeType: string; fileSize: number; category: string; fileType: string;
    supplier?: string; description?: string; fileDate?: string;
    storagePath: string; emailedTo?: string[];
    deletedAt: string; expiresAt: string;
}

export interface Supplier {
    id: number; name: string; shortName?: string; siret?: string; tvaNumber?: string;
    accountNumber?: string; address?: string; city?: string; postalCode?: string;
    phone?: string; email?: string; website?: string; contactName?: string;
    category?: string; paymentTerms?: string; defaultPaymentMethod?: string;
    bankIban?: string; bankBic?: string; notes?: string;
    totalPurchases?: number; totalExpenses?: number; invoiceCount?: number;
    lastInvoiceDate?: string; isActive: boolean; createdAt?: string;
}

export interface Anomaly {
    type: string; severity: string; description: string;
}

export interface AnomaliesResponse {
    success: boolean; période: string; totalAnomalies: number;
    parSévérité: { haute: number; moyenne: number; info: number };
    anomalies: Anomaly[];
}
