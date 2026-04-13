import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";

const geminiAI = (() => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY || "dummy";
  const opts: any = { apiKey };
  if (process.env.AI_INTEGRATIONS_GEMINI_BASE_URL) {
    opts.httpOptions = { apiVersion: "", baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL };
  }
  return new GoogleGenAI(opts);
})();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ? process.env.AI_INTEGRATIONS_OPENAI_BASE_URL : undefined,
});

let pdfParseFn: any = null;
let pdfModuleLoaded = false;

async function ensurePdfLoaded(): Promise<void> {
  if (pdfModuleLoaded) return;
  try {
    const pdfModule = await import("pdf-parse/lib/pdf-parse.js");
    pdfParseFn = pdfModule.default || pdfModule;
    pdfModuleLoaded = true;
    console.log("[PayrollParser] pdf-parse loaded");
  } catch (e) {
    console.error("[PayrollParser] Failed to load pdf-parse:", e);
  }
}

ensurePdfLoaded().catch(() => {});

export interface ParsedPayrollData {
  employee: {
    firstName: string;
    lastName: string;
    role: string;
    contractType: string;
    weeklyHours: number | null;
    startDate: string | null;
    socialSecurityNumber: string | null;
    employeeNumber: string | null;
    birthDate: string | null;
    nationality: string | null;
    classification: string | null;
    coefficient: number | null;
    echelon: string | null;
  };
  employer: {
    name: string;
    siret: string | null;
    address: string | null;
    ape: string | null;
    conventionCollective: string | null;
    urssafNumber: string | null;
  };
  period: string;
  grossSalary: number;
  netSalary: number;
  netBeforeTax: number | null;
  netImposable: number | null;
  socialCharges: number;
  employerCharges: number | null;
  totalEmployerCost: number | null;
  bonus: number;
  bonusDetails: Array<{ label: string; amount: number }>;
  overtime: number;
  overtimeHours: number | null;
  hoursWorked: number | null;
  hourlyRate: number | null;
  absenceHours: number | null;
  absenceDeduction: number | null;
  mealAllowance: number | null;
  transportAllowance: number | null;
  inKindBenefits: number | null;
  deductions: Array<{
    label: string;
    base: number | null;
    rate: number | null;
    employeeAmount: number;
    employerAmount: number | null;
  }>;
  congesAcquis: number | null;
  congesPris: number | null;
  congesRestants: number | null;
  rttAcquis: number | null;
  rttPris: number | null;
  rttRestants: number | null;
  cumulBrutAnnuel: number | null;
  cumulNetImposableAnnuel: number | null;
  paymentDate: string | null;
  paymentMethod: string | null;
  incomeTax: number | null;
  incomeTaxRate: number | null;
  rawText?: string;
}

export interface PayrollParseResult {
  success: boolean;
  data: ParsedPayrollData | null;
  warnings: string[];
  errors: string[];
  confidence: number;
  source: "core" | "core+ai" | "ai" | "regex";
}

function parseNum(s: string): number {
  if (!s) return 0;
  return parseFloat(s.replace(/\s/g, "").replace(",", ".")) || 0;
}

function parseNumSafe(s: string | undefined | null): number | null {
  if (!s) return null;
  const v = parseNum(s);
  return v > 0 ? v : null;
}

function findAllMatches(text: string, pattern: RegExp): RegExpMatchArray[] {
  const results: RegExpMatchArray[] = [];
  let m: RegExpMatchArray | null;
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  while ((m = re.exec(text)) !== null) {
    results.push(m);
  }
  return results;
}

const MONTH_MAP: Record<string, string> = {
  janvier: "01", fevrier: "02", "février": "02", mars: "03", avril: "04",
  mai: "05", juin: "06", juillet: "07", aout: "08", "août": "08",
  septembre: "09", octobre: "10", novembre: "11", decembre: "12", "décembre": "12",
};

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\t/g, "  ");
}

function createEmptyPayrollData(): ParsedPayrollData {
  return {
    employee: {
      firstName: "", lastName: "", role: "", contractType: "CDI",
      weeklyHours: null, startDate: null, socialSecurityNumber: null,
      employeeNumber: null, birthDate: null, nationality: null,
      classification: null, coefficient: null, echelon: null,
    },
    employer: {
      name: "", siret: null, address: null, ape: null,
      conventionCollective: null, urssafNumber: null,
    },
    period: "",
    grossSalary: 0, netSalary: 0, netBeforeTax: null, netImposable: null,
    socialCharges: 0, employerCharges: null, totalEmployerCost: null,
    bonus: 0, bonusDetails: [],
    overtime: 0, overtimeHours: null, hoursWorked: null, hourlyRate: null,
    absenceHours: null, absenceDeduction: null,
    mealAllowance: null, transportAllowance: null, inKindBenefits: null,
    deductions: [],
    congesAcquis: null, congesPris: null, congesRestants: null,
    rttAcquis: null, rttPris: null, rttRestants: null,
    cumulBrutAnnuel: null, cumulNetImposableAnnuel: null,
    paymentDate: null, paymentMethod: null,
    incomeTax: null, incomeTaxRate: null,
  };
}

function coreParsePayroll(text: string, fileName?: string): ParsedPayrollData {
  text = normalizeText(text);
  const data = createEmptyPayrollData();

  // === EMPLOYER ===
  const siretMatch = text.match(/Siret\s*:?\s*(\d[\d\s]{12}\d)/i);
  if (siretMatch) {
    data.employer.siret = siretMatch[1].replace(/\s/g, "");
  }

  const apeMatch = text.match(/(?:Code\s*(?:NAF|APE)|APE)\s*:?\s*(\d{4}[A-Z])/i);
  if (apeMatch) data.employer.ape = apeMatch[1];

  const urssafMatch = text.match(/(?:URSSAF|N°\s*Employeur|N°\s*URSSAF)\s*:?\s*(\d[\d\s\/]+)/i);
  if (urssafMatch) data.employer.urssafNumber = urssafMatch[1].trim();

  const ccMatch = text.match(/Convention\s*(?:Collective)?\s*:?\s*([^\n]{5,80})/i);
  if (ccMatch) data.employer.conventionCollective = ccMatch[1].trim();

  if (siretMatch) {
    const siretIdx = text.indexOf(siretMatch[0]);
    const beforeSiret = text.substring(Math.max(0, siretIdx - 300), siretIdx);
    const lines = beforeSiret.split("\n").map(l => l.trim()).filter(l => l.length > 2);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (/^\d+\s*(AVENUE|RUE|BOULEVARD|PLACE|CHEMIN|IMPASSE|ALLEE|COURS|ROUTE|LOT|ZONE)/i.test(line)) continue;
      if (/^\d{5}/.test(line)) continue;
      if (/^(BULLETIN|RUBRIQUE|MONTANT|DANS|HEURES|CUMUL|BASES|BRUT|POUR|ALL|TOTAL|NET|EN EUROS|TAUX|COTISATIONS|RETENUES|GAIN)/i.test(line)) continue;
      if (/^[A-ZÀ-Ü][A-ZÀ-Ü\s\-\.]{2,}$/.test(line) && line.length <= 60) {
        data.employer.name = line;
        break;
      }
    }
  }

  if (!data.employer.name) {
    const knownNames = [
      /SUGU\s+\w+/i,
      /(?:RESTAURANT|CAFE|HOTEL|BAR|BRASSERIE|SAS|SARL|EURL|SCI|SA|SASU)\s+[A-ZÀ-Ü\s\-]+/i,
    ];
    for (const pat of knownNames) {
      const m = text.match(pat);
      if (m) { data.employer.name = m[0].trim(); break; }
    }
  }

  const employerAddrMatch = text.match(/(\d+\s*[,]?\s*(?:AVENUE|RUE|BOULEVARD|PLACE|CHEMIN|IMPASSE|ALLEE|COURS|ROUTE|LOT|ZONE)\s+[A-ZÀ-Ü\s\-]+)\n\s*(\d{5})\s*([A-ZÀ-Ü\s]+)/im);
  if (employerAddrMatch) {
    data.employer.address = `${employerAddrMatch[1].trim()}, ${employerAddrMatch[2]} ${employerAddrMatch[3].trim()}`;
  }

  // === PERIOD ===
  const periodPatterns = [
    { re: /P[ée]riode\s*(?:du\s+)?:?\s*(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+(\d{4})/i, type: "month_word" },
    { re: /Du\s*:?\s*\d{1,2}\/(\d{1,2})\/(\d{4})\s*(?:Au|au)/i, type: "du_au" },
    { re: /P[ée]riode\s*:?\s*(\d{1,2})\s*[\/\-]\s*(\d{4})/i, type: "mm_yyyy" },
    { re: /PAIE\s+(?:DU\s+MOIS\s+(?:DE|D')\s+)?(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+(\d{4})/i, type: "month_word" },
    { re: /BULLETIN\s+(?:DE\s+(?:PAIE|SALAIRE)\s+)?(?:DU\s+MOIS\s+(?:DE|D')\s+)?(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+(\d{4})/i, type: "month_word" },
    { re: /Mois\s*:?\s*(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+(\d{4})/i, type: "month_word" },
    { re: /(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+(\d{4})/i, type: "month_word" },
    { re: /(\d{2})[\/\-](\d{4})/, type: "mm_yyyy" },
  ];
  for (const { re, type } of periodPatterns) {
    const m = text.match(re);
    if (m) {
      if (type === "month_word") {
        const monthKey = m[1].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const mm = MONTH_MAP[monthKey];
        if (mm) { data.period = `${m[2]}-${mm}`; break; }
      } else if (type === "du_au" || type === "mm_yyyy") {
        const mm = m[1].padStart(2, "0");
        const yyyy = m[2];
        if (parseInt(mm) >= 1 && parseInt(mm) <= 12) { data.period = `${yyyy}-${mm}`; break; }
      }
    }
  }

  if (!data.period && fileName) {
    const fileMatch = fileName.match(/BS[_\s]*(\d{2})(\d{2})/i);
    if (fileMatch) {
      data.period = `20${fileMatch[2]}-${fileMatch[1]}`;
      console.log(`[PayrollParser:Core] Period from filename: ${data.period}`);
    }
  }

  // === EMPLOYEE ===
  const INVALID_EMPLOYEE_NAMES = new Set([
    "MONTANT", "NET", "TOTAL", "BRUT", "PAYER", "PAIE", "BULLETIN",
    "COTISATIONS", "RETENUES", "GAINS", "RUBRIQUE", "BASE", "TAUX",
    "CUMUL", "HEURES", "SALAIRE", "SUGU", "VALENTINE", "MAILLANE",
    "RESTAURANT", "CAFE", "HOTEL", "BAR", "BRASSERIE", "SAS", "SARL",
    "EURL", "SCI", "SA", "SASU", "LIVREUR", "SERVEUR", "CUISINIER",
    "PLONGEUR", "BARMAN", "COMMIS", "CHEF", "GERANT", "EMPLOYE",
  ]);

  const isValidEmployeeName = (lastName: string, firstName: string): boolean => {
    const ln = (lastName || "").toUpperCase().trim();
    const fn = (firstName || "").toUpperCase().trim();
    if (!ln || ln.length < 2) return false;
    if (INVALID_EMPLOYEE_NAMES.has(ln)) return false;
    if (INVALID_EMPLOYEE_NAMES.has(fn)) return false;
    if (data.employer.name && (
      data.employer.name.toUpperCase().includes(ln) ||
      ln.includes(data.employer.name.toUpperCase().split(/\s+/)[0])
    )) return false;
    if (/^(A\s+PAYER|EN\s+EUROS|DU\s+MOIS)$/i.test(ln)) return false;
    return true;
  };

  const employeePatterns = [
    /(?:Salari[ée]|Employ[ée])\s*:?\s*(?:M\.|Mme|Mr|Mlle)\s+([A-ZÀ-Ü][A-ZÀ-Ü\-]+)\s+([A-ZÀ-Ü][A-ZÀ-Üa-zà-ü\-\s]+?)(?:\n|$)/m,
    /(?:M\.|Mme|Mr|Mlle)\s+([A-ZÀ-Ü][A-ZÀ-Ü\-]+)\s+([A-ZÀ-Ü][A-ZÀ-Üa-zà-ü\-\s]+?)(?:\n|$)/m,
    /(?:M\.|Mme|Mr|Mlle)\s+([A-ZÀ-Ü][A-ZÀ-Ü\-]+)\s+([A-ZÀ-Ü][A-ZÀ-Ü\-\s]+[A-ZÀ-Ü])/m,
    /Nom\s*:?\s*([A-ZÀ-Ü]+)\s+Pr[ée]nom\s*:?\s*([A-ZÀ-Üa-zà-ü\s]+)/i,
    /Salari[ée]\s*:?\s*([A-ZÀ-Ü]+)\s+([A-ZÀ-Üa-zà-ü\s]+)/i,
    /NOM\s*:?\s*([A-ZÀ-Ü\-]+)\s+([A-ZÀ-Üa-zà-ü\-\s]+)/,
  ];
  for (const pat of employeePatterns) {
    const m = text.match(pat);
    if (m) {
      const candidateLN = m[1].trim();
      const rawFN = m[2].trim();
      const fnWords = rawFN.split(/\s+/).filter(w => w.length > 0 && !INVALID_EMPLOYEE_NAMES.has(w.toUpperCase()));
      const candidateFN = fnWords.length > 0 ? fnWords.join(" ") : rawFN.replace(/\s+.*/, "");
      if (isValidEmployeeName(candidateLN, candidateFN)) {
        data.employee.lastName = candidateLN;
        data.employee.firstName = candidateFN;
        break;
      } else {
        console.log(`[PayrollParser:Core] Rejected employee name: ${candidateLN} ${candidateFN} (invalid/employer)`);
      }
    }
  }

  if (fileName) {
    const fnMatch = fileName.match(/BS[\s_]*\d{2,4}[\s_]+(.+?)(?:[\s_]\d{10,})?\.pdf/i);
    if (fnMatch) {
      const parts = fnMatch[1].trim().split(/[\s_]+/).filter(p => p.length > 0);
      if (parts.length >= 2) {
        const allUpper = parts.map(p => p.toUpperCase());
        const fnLastName = allUpper[allUpper.length - 1];
        const fnFirstName = allUpper.slice(0, -1).map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
        if (!data.employee.lastName || !isValidEmployeeName(data.employee.lastName, data.employee.firstName)) {
          data.employee.lastName = fnLastName;
          data.employee.firstName = fnFirstName;
          console.log(`[PayrollParser:Core] Employee from filename: ${data.employee.lastName} ${data.employee.firstName}`);
        } else {
          const parsedFull = `${data.employee.firstName} ${data.employee.lastName}`.toUpperCase();
          const fileFull = allUpper.join(" ");
          if (fileFull.length > parsedFull.length && fileFull.includes(data.employee.lastName.toUpperCase())) {
            data.employee.lastName = fnLastName;
            data.employee.firstName = fnFirstName;
            console.log(`[PayrollParser:Core] Filename has more complete name: ${data.employee.lastName} ${data.employee.firstName} (was: ${parsedFull})`);
          } else if (fnLastName !== data.employee.lastName.toUpperCase()) {
            console.log(`[PayrollParser:Core] Filename name (${fnLastName} ${fnFirstName}) differs from parsed (${data.employee.lastName} ${data.employee.firstName})`);
          }
        }
      }
    }
  }

  const matriculeMatch = text.match(/Matricule\s*:?\s*(\w+)/i);
  if (matriculeMatch) data.employee.employeeNumber = matriculeMatch[1].trim();

  const secuPatterns = [
    /(?:NoS[ée]cu|N°\s*S[ée]cu|S[ée]curit[ée]\s*Sociale|N°\s*SS)\s*\.?\s*:?\s*([12][\d\s]{12,18}\d)/i,
    /\b([12]\s*\d{2}\s*\d{2}\s*(?:\d{2}|2[AB])\s*\d{3}\s*\d{3}\s*\d{2})\b/,
  ];
  for (const pat of secuPatterns) {
    const m = text.match(pat);
    if (m) { data.employee.socialSecurityNumber = m[1].replace(/\s/g, ""); break; }
  }

  const entreePatterns = [
    /Entr[ée](?:\(e\))?\s*(?:le)?\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i,
    /Date\s*d'?entr[ée]e?\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i,
    /Depuis?\s+(?:le\s+)?(\d{2}\/\d{2}\/\d{4})/i,
    /Anciennet[ée]\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i,
  ];
  for (const pat of entreePatterns) {
    const m = text.match(pat);
    if (m) {
      const parts = m[1].split("/");
      data.employee.startDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
      break;
    }
  }

  const birthMatch = text.match(/(?:N[ée]\s*(?:\(e\)\s*)?le|Date\s*naissance)\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (birthMatch) {
    const parts = birthMatch[1].split("/");
    data.employee.birthDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
  }

  const emploiPatterns = [
    /Emploi\s*:?\s*([A-ZÀ-Üa-zà-ü\s\-\/]+?)(?:\s*\d{2}\/\d{2}\/\d{4}|$)/im,
    /Qualification\s*:?\s*([A-ZÀ-Üa-zà-ü\s\-\/]+?)(?:\s*Classif|Coeff|Niv|$)/im,
    /Qualif\s*:?\s*([A-ZÀ-Ü\s\-\/]+?)(?:\s*Classif|Coeff|$)/im,
    /(?:CUISINIER|SERVEUR|PLONGEUR|CHEF\s*DE\s*(?:RANG|CUISINE|PARTIE)|COMMIS|SUSHIMAN|PIZZAIOLO|BARMAN|MANAGER|DIRECTEUR|RESPONSABLE|POLYVALENT|CAISSIER|EQUIPIER|LIVREUR|RECEPTIONNISTE)[A-Z\s\-]*/i,
  ];
  for (const pat of emploiPatterns) {
    const m = text.match(pat);
    if (m) {
      data.employee.role = (m[1] || m[0]).trim().replace(/\s+/g, " ");
      if (data.employee.role.length > 60) data.employee.role = data.employee.role.substring(0, 60);
      break;
    }
  }

  const classifMatch = text.match(/Classification\s*:?\s*([A-Z0-9\s\-]+?)(?:\s|$)/im);
  if (classifMatch) data.employee.classification = classifMatch[1].trim();

  const coeffMatch = text.match(/Coeff(?:icient)?\s*:?\s*(\d+)/i);
  if (coeffMatch) data.employee.coefficient = parseInt(coeffMatch[1]);

  const echelonMatch = text.match(/[EÉ]chelon\s*:?\s*(\w+)/i);
  if (echelonMatch) data.employee.echelon = echelonMatch[1].trim();

  const contractPatterns = [
    { re: /\bCDD\b/i, type: "CDD" },
    { re: /\bExtra\b/i, type: "Extra" },
    { re: /\bInt[ée]rim/i, type: "Intérim" },
    { re: /\bStage\b/i, type: "Stage" },
    { re: /\bApprentissage\b/i, type: "Apprentissage" },
    { re: /\bAlternance\b/i, type: "Alternance" },
    { re: /\bSaisonnier\b/i, type: "Saisonnier" },
    { re: /\bCDI\b/i, type: "CDI" },
  ];
  for (const { re, type } of contractPatterns) {
    if (re.test(text)) {
      data.employee.contractType = type;
      break;
    }
  }

  // === SALARY BASE ===
  const salaireBasePatterns = [
    /SALAIRE\s+DE\s+BASE\s+([\d\s]+[,\.]\d{2})\s+([\d\s]+[,\.]\d{2,4})\s+([\d\s]+[,\.]\d{2})/i,
    /SAL(?:AIRE)?\s*BASE\s+([\d\s]+[,\.]\d{2})\s+([\d\s]+[,\.]\d{2,4})\s+([\d\s]+[,\.]\d{2})/i,
    /(?:Heures\s*normales|H\.Norm)\s+([\d\s]+[,\.]\d{2})\s+([\d\s]+[,\.]\d{2,4})\s+([\d\s]+[,\.]\d{2})/i,
  ];
  for (const pat of salaireBasePatterns) {
    const m = text.match(pat);
    if (m) {
      data.hoursWorked = parseNum(m[1]);
      data.hourlyRate = parseNum(m[2]);
      break;
    }
  }

  const weeklyHoursPatterns = [
    /(?:Dur[ée]e\s+hebdo|Horaire\s+hebdo|Heures?\s+hebdo(?:madaire)?|Heures\/semaine)\s*:?\s*([\d,\.]+)/i,
    /(\d{2})[Hh]\s*(?:00)?\s*\/\s*sem/i,
  ];
  for (const pat of weeklyHoursPatterns) {
    const m = text.match(pat);
    if (m) { data.employee.weeklyHours = parseNum(m[1]); break; }
  }

  // === GROSS ===
  const brutPatterns = [
    /SALAIRE\s+BRUT\s+([\d\s]+[,\.]\d{2})/i,
    /(?:TOTAL\s+)?BRUT\s+([\d\s]+[,\.]\d{2})/i,
    /S\.?\s*BRUT\s+([\d\s]+[,\.]\d{2})/i,
    /BRUT\s+MENSUEL\s+([\d\s]+[,\.]\d{2})/i,
    /BRUT[^\d\n]{0,20}([\d\s]+[,\.]\d{2})/i,
  ];
  for (const pat of brutPatterns) {
    const m = text.match(pat);
    if (m) {
      const val = parseNum(m[1]);
      if (val > 0) { data.grossSalary = val; break; }
    }
  }

  // === NET ===
  const netImposableMatch = text.match(/NET\s+(?:FISCAL\s+)?IMPOSABLE\s+([\d\s]+[,\.]\d{2})/i);
  const netImposableVal = netImposableMatch ? parseNum(netImposableMatch[1]) : 0;
  if (netImposableVal > 0) data.netImposable = netImposableVal;

  const netPayePatterns = [
    /NET\s+[AÀ]\s+PAYER\s+(?:AU\s+)?SALARI[EÉ][^\d]*([\d\s]+[,\.]\d{2})/i,
    /NET\s+[AÀ]\s+PAYER\s+([\d\s]+[,\.]\d{2})/i,
    /MONTANT\s+NET\s+VERS[EÉ]\s+([\d\s]+[,\.]\d{2})/i,
    /NET\s+VERS[EÉ]\s+([\d\s]+[,\.]\d{2})/i,
  ];
  for (const pat of netPayePatterns) {
    const m = text.match(pat);
    if (m) {
      const val = parseNum(m[1]);
      if (val > 0) { data.netSalary = val; break; }
    }
  }

  if (data.netSalary <= 0 && data.grossSalary > 0) {
    const bottomText = text.substring(Math.max(0, text.length - 800));
    const bottomAmounts: number[] = [];
    const re = /([\d\s]+[,\.]\d{2})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(bottomText)) !== null) {
      const v = parseNum(m[1]);
      if (v > 50 && v < 100000) bottomAmounts.push(v);
    }

    const candidateNets: number[] = [];
    for (const amt of bottomAmounts) {
      if (amt < data.grossSalary && amt > data.grossSalary * 0.3 && amt !== netImposableVal
          && amt !== data.grossSalary) {
        candidateNets.push(amt);
      }
    }

    if (candidateNets.length > 0) {
      const counts = new Map<number, number>();
      for (const c of candidateNets) {
        counts.set(c, (counts.get(c) || 0) + 1);
      }

      console.log(`[PayrollParser:Core] Bottom candidates: ${[...counts.entries()].map(([v,c]) => `${v}(${c}x)`).join(', ')}`);

      const repeatedCandidates = [...counts.entries()].filter(([, c]) => c >= 2);

      if (repeatedCandidates.length > 0) {
        if (netImposableVal > 0) {
          const belowNetImposable = repeatedCandidates.filter(([v]) => v < netImposableVal);
          if (belowNetImposable.length > 0) {
            belowNetImposable.sort((a, b) => b[0] - a[0]);
            const bestNet = belowNetImposable[0][0];
            const bestCount = belowNetImposable[0][1];
            data.netSalary = bestNet;
            console.log(`[PayrollParser:Core] Net from bottom analysis: ${bestNet} (appeared ${bestCount}x, highest repeated < netImposable ${netImposableVal})`);
          } else {
            repeatedCandidates.sort((a, b) => b[0] - a[0]);
            data.netSalary = repeatedCandidates[0][0];
            console.log(`[PayrollParser:Core] Net from bottom analysis: ${repeatedCandidates[0][0]} (appeared ${repeatedCandidates[0][1]}x, highest repeated)`);
          }
        } else {
          repeatedCandidates.sort((a, b) => b[0] - a[0]);
          data.netSalary = repeatedCandidates[0][0];
          console.log(`[PayrollParser:Core] Net from bottom analysis: ${repeatedCandidates[0][0]} (appeared ${repeatedCandidates[0][1]}x, highest repeated)`);
        }
      } else if (netImposableVal > 0) {
        const belowNI = [...counts.keys()].filter(v => v < netImposableVal && v > data.grossSalary * 0.35);
        if (belowNI.length > 0) {
          belowNI.sort((a, b) => b - a);
          data.netSalary = belowNI[0];
          console.log(`[PayrollParser:Core] Net from bottom analysis: ${belowNI[0]} (highest single < netImposable ${netImposableVal})`);
        }
      } else {
        const allVals = [...counts.keys()].filter(v => v > data.grossSalary * 0.35 && v < data.grossSalary * 0.70);
        if (allVals.length > 0) {
          allVals.sort((a, b) => b - a);
          data.netSalary = allVals[0];
          console.log(`[PayrollParser:Core] Net from bottom analysis: ${allVals[0]} (highest in 35-70% gross range)`);
        }
      }
    }
  }

  if (data.netSalary > 0 && netImposableVal > 0 && data.netSalary > netImposableVal) {
    const bottomText = text.substring(Math.max(0, text.length - 800));
    const allAmounts: number[] = [];
    const re2 = /([\d\s]+[,\.]\d{2})/g;
    let m2: RegExpExecArray | null;
    while ((m2 = re2.exec(bottomText)) !== null) {
      const v = parseNum(m2[1]);
      if (v > 50 && v < netImposableVal && v > data.grossSalary * 0.3) allAmounts.push(v);
    }
    const counts2 = new Map<number, number>();
    for (const c of allAmounts) counts2.set(c, (counts2.get(c) || 0) + 1);
    const repeated = [...counts2.entries()].filter(([, c]) => c >= 2).sort((a, b) => a[0] - b[0]);
    if (repeated.length > 0) {
      console.log(`[PayrollParser:Core] Net (${data.netSalary}) > NetImposable (${netImposableVal}), correcting to ${repeated[0][0]}`);
      data.netSalary = repeated[0][0];
    }
  }

  // === NET BEFORE TAX ===
  const netBeforeTaxPatterns = [
    /NET\s+[AÀ]\s+PAYER\s+AVANT\s+IMP[OÔ]T\s+(?:SUR\s+LE\s+REVENU\s+)?[^\d]*([\d\s]+[,\.]\d{2})/i,
    /NET\s+AVANT\s+IMP[OÔ]T[^\d]*([\d\s]+[,\.]\d{2})/i,
    /NET\s+AVANT\s+PAS[^\d]*([\d\s]+[,\.]\d{2})/i,
  ];
  for (const pat of netBeforeTaxPatterns) {
    const m = text.match(pat);
    if (m) {
      const val = parseNum(m[1]);
      if (val > 0) { data.netBeforeTax = val; break; }
    }
  }

  if (!data.netBeforeTax && data.grossSalary > 0) {
    const bottomText = text.substring(Math.max(0, text.length - 600));
    const bottomAmounts: number[] = [];
    const re = /([\d\s]+[,\.]\d{2})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(bottomText)) !== null) {
      const v = parseNum(m[1]);
      if (v > 50 && v < 100000) bottomAmounts.push(v);
    }
    for (const amt of bottomAmounts) {
      if (amt < data.grossSalary && amt > data.grossSalary * 0.5
          && amt !== data.netSalary && amt !== netImposableVal
          && amt >= (data.netSalary || 0)) {
        data.netBeforeTax = amt;
        break;
      }
    }
    if (!data.netBeforeTax && data.netSalary > 0) {
      data.netBeforeTax = data.netSalary;
    }
  }

  // === CHARGES ===
  const chargesPatterns = [
    /TOTAL\s+DES\s+RETENUES\s+([\d\s]+[,\.]\d{2})/i,
    /TOTAL\s+(?:DES\s+)?COTISATIONS\s+SALARIALES\s+([\d\s]+[,\.]\d{2})/i,
    /TOTAL\s+(?:DES\s+)?COTISATIONS\s+([\d\s]+[,\.]\d{2})/i,
    /TOT(?:AL)?\s+RETENUES[^\d]*([\d\s]+[,\.]\d{2})/i,
    /PART\s+SALARIALE[^\d]*([\d\s]+[,\.]\d{2})/i,
  ];
  for (const pat of chargesPatterns) {
    const m = text.match(pat);
    if (m) {
      const val = parseNum(m[1]);
      if (val > 0) { data.socialCharges = val; break; }
    }
  }

  const totalRetenuesMatch = text.match(/TOTAL\s+DES\s+RETENUES\s+([\d\s]+[,\.]\d{2})\s+([\d\s]+[,\.]\d{2})/i);
  if (totalRetenuesMatch) {
    data.socialCharges = parseNum(totalRetenuesMatch[1]);
    data.employerCharges = parseNum(totalRetenuesMatch[2]);
  }

  const employerChargesPatterns = [
    /TOTAL\s+(?:DES\s+)?COTISATIONS\s+PATRONALES\s+([\d\s]+[,\.]\d{2})/i,
    /PART\s+PATRONALE[^\d]*([\d\s]+[,\.]\d{2})/i,
    /CO[UÛ]T\s+TOTAL\s+EMPLOYEUR[^\d]*([\d\s]+[,\.]\d{2})/i,
  ];
  if (!data.employerCharges) {
    for (const pat of employerChargesPatterns) {
      const m = text.match(pat);
      if (m) { data.employerCharges = parseNum(m[1]); break; }
    }
  }

  if (data.grossSalary > 0 && data.netSalary > 0 && data.socialCharges <= 0) {
    data.socialCharges = Math.round((data.grossSalary - data.netSalary) * 100) / 100;
  }

  if (data.grossSalary > 0 && data.employerCharges && data.employerCharges > 0) {
    data.totalEmployerCost = Math.round((data.grossSalary + data.employerCharges) * 100) / 100;
  }

  // === INCOME TAX (PAS) ===
  const pasPatterns = [
    /(?:IMP[OÔ]T\s+SUR\s+LE\s+REVENU|PRELEVEMENT\s+A\s+LA\s+SOURCE|PAS)\s*:?\s*([\d\s]+[,\.]\d{2})/i,
    /PAS\s+(?:[\d,\.]+%\s+)?([\d\s]+[,\.]\d{2})/i,
    /IMP[OÔ]T\s+(?:PR[ÉE]LEV[ÉE]\s+)?[AÀ]\s+LA\s+SOURCE\s+([\d\s]+[,\.]\d{2})/i,
  ];
  for (const pat of pasPatterns) {
    const m = text.match(pat);
    if (m) { data.incomeTax = parseNum(m[1]); break; }
  }

  const pasRateMatch = text.match(/(?:Taux\s+PAS|Taux\s+(?:d'?)?imp[oô](?:sit)?t?)\s*:?\s*([\d,\.]+)\s*%/i);
  if (pasRateMatch) data.incomeTaxRate = parseNum(pasRateMatch[1]);

  // === BONUSES (detailed) ===
  const bonusPatterns = [
    { re: /(?:PRIME\s+[A-ZÀ-Üa-zà-ü\s\-]+?)[^\d]*([\d\s]+[,\.]\d{2})/gi, label: "prime" },
    { re: /(?:GRATIFICATION)[^\d]*([\d\s]+[,\.]\d{2})/gi, label: "gratification" },
    { re: /(?:13[èe]me\s+MOIS)[^\d]*([\d\s]+[,\.]\d{2})/gi, label: "13ème mois" },
    { re: /(?:IND(?:EMNIT[EÉ])?\.?\s+(?:REPAS))[^\d]*([\d\s]+[,\.]\d{2})/gi, label: "indemnité repas" },
    { re: /(?:IND(?:EMNIT[EÉ])?\.?\s+(?:TRANSPORT(?:S)?))[^\d]*([\d\s]+[,\.]\d{2})/gi, label: "indemnité transport" },
    { re: /(?:IND(?:EMNIT[EÉ])?\.?\s+(?:DEPLACEMENT))[^\d]*([\d\s]+[,\.]\d{2})/gi, label: "indemnité déplacement" },
    { re: /(?:BONUS)[^\d]*([\d\s]+[,\.]\d{2})/gi, label: "bonus" },
    { re: /(?:POURBOIRE)[^\d]*([\d\s]+[,\.]\d{2})/gi, label: "pourboire" },
  ];
  let totalBonus = 0;
  for (const { re, label } of bonusPatterns) {
    const matches = findAllMatches(text, re);
    for (const m of matches) {
      const val = parseNum(m[1]);
      if (val > 0 && val < 50000) {
        totalBonus += val;
        data.bonusDetails.push({ label: m[0].replace(m[1], "").trim() || label, amount: val });
      }
    }
  }
  data.bonus = Math.round(totalBonus * 100) / 100;

  // === MEAL & TRANSPORT ALLOWANCES ===
  const mealMatch = text.match(/(?:IND(?:EMNIT[ÉE])?\.?\s*(?:COMP(?:ENSATRICE)?\.?)?\s*(?:NOURRITURE|REPAS)|PANIER\s*REPAS|TITRE[S]?\s*RESTAURANT)[^\d]*([\d\s]+[,\.]\d{2})/i);
  if (mealMatch) data.mealAllowance = parseNum(mealMatch[1]);

  const transportMatch = text.match(/(?:IND(?:EMNIT[ÉE])?\.?\s*TRANSPORT|PRIME\s*TRANSPORT|NAVIGO|REMB(?:OURSEMENT)?\s*TRANSPORT)[^\d]*([\d\s]+[,\.]\d{2})/i);
  if (transportMatch) data.transportAllowance = parseNum(transportMatch[1]);

  // === IN-KIND BENEFITS ===
  const avantageMatch = text.match(/AVANTAGE\s+EN\s+NATURE[^\d]*([\d\s]+[,\.]\d{2})/i);
  if (avantageMatch) data.inKindBenefits = parseNum(avantageMatch[1]);

  // === OVERTIME ===
  const heureSupPatterns = [
    /(?:HEURES?\s+SUPP?(?:L[ÉE]MENTAIRES?)?|H\.?\s*SUP)\s*(?:\d+%|25%|50%)?\s*[\d,\.]*\s*[\d,\.]*\s*([\d\s]+[,\.]\d{2})/gi,
    /(?:MAJORATION|MAJ\.?\s+H\.?\s*SUP)[^\d]*([\d\s]+[,\.]\d{2})/gi,
    /(?:HS\s*\d+%)[^\d]*([\d\s]+[,\.]\d{2})/gi,
  ];
  let totalOvertime = 0;
  for (const pat of heureSupPatterns) {
    const matches = findAllMatches(text, pat);
    for (const m of matches) {
      totalOvertime += parseNum(m[1]);
    }
  }
  data.overtime = Math.round(totalOvertime * 100) / 100;

  const hsHoursPatterns = [
    /(?:HS|H\.?\s*SUP)\s*\d*%?\s*([\d,\.]+)\s*h/i,
    /HEURES?\s+SUPP?\s+([\d,\.]+)/i,
  ];
  for (const pat of hsHoursPatterns) {
    const m = text.match(pat);
    if (m) { data.overtimeHours = parseNum(m[1]); break; }
  }

  // === ABSENCES ===
  const absenceHoursMatch = text.match(/(?:ABSENCE[S]?|ABS\.?)\s+(?:NON\s+R[ÉE]MUN[ÉE]R[ÉE]E|MALADIE|INJUSTIFI[ÉE]E)\s+([\d,\.]+)/i);
  if (absenceHoursMatch) data.absenceHours = parseNum(absenceHoursMatch[1]);

  const absenceDeductionMatch = text.match(/(?:ABSENCE[S]?|ABS\.?|RETENUE\s+ABSENCE)\s+[A-ZÀ-Üa-zà-ü\s]*?[\-]?\s*([\d\s]+[,\.]\d{2})/i);
  if (absenceDeductionMatch) {
    const val = parseNum(absenceDeductionMatch[1]);
    if (val > 0 && val < data.grossSalary) data.absenceDeduction = val;
  }

  // === DEDUCTIONS (line-by-line) ===
  const deductionLineRe = /^([A-ZÀ-Ü][A-ZÀ-Ü\s\.\-\/\(\)]+?)\s+([\d\s]+[,\.]\d{2})\s+([\d\s]*[,\.]\d{2,4})?\s+([\d\s]+[,\.]\d{2})(?:\s+([\d\s]+[,\.]\d{2}))?/gm;
  let dm: RegExpExecArray | null;
  while ((dm = deductionLineRe.exec(text)) !== null) {
    const label = dm[1].trim();
    if (label.length < 3 || /^(SALAIRE|AVANTAGE|HEURES|CUMUL|NET|TOTAL|MONTANT|BRUT|PRIME|BONUS|GRATIF)/i.test(label)) continue;
    data.deductions.push({
      label,
      base: dm[2] ? parseNum(dm[2]) : null,
      rate: dm[3] ? parseNum(dm[3]) : null,
      employeeAmount: dm[4] ? parseNum(dm[4]) : 0,
      employerAmount: dm[5] ? parseNum(dm[5]) : null,
    });
  }

  // === CONGES / RTT ===
  const cpAcquisPatterns = [
    /(?:CP|Cong[ée]s?)\s*(?:Pay[ée]s?\s*)?Acquis\s*:?\s*(?:[\d,\.]+\s*\/\s*)?([\d,\.]+)/i,
    /Acquis\s*:?\s*(?:[\d,\.]+\s*\/\s*)?([\d,\.]+)/i,
  ];
  for (const pat of cpAcquisPatterns) {
    const m = text.match(pat);
    if (m) { data.congesAcquis = parseNum(m[1]); break; }
  }

  const cpPrisMatch = text.match(/(?:CP\s+)?(?:Total\s+)?[Pp]ris\s*:?\s*(?:[\d,\.]+\s*\/\s*)?([\d,\.]+)/i);
  if (cpPrisMatch) data.congesPris = parseNum(cpPrisMatch[1]);

  const cpSoldePatterns = [
    /Solde\s*(?:CP)?\s*:?\s*(?:[\d,\.]+\s*\/\s*)?([\d,\.]+)/i,
    /Reste\s*(?:CP)?\s*:?\s*([\d,\.]+)/i,
  ];
  for (const pat of cpSoldePatterns) {
    const m = text.match(pat);
    if (m) { data.congesRestants = parseNum(m[1]); break; }
  }

  const rttAcquisMatch = text.match(/RTT\s+Acquis\s*:?\s*([\d,\.]+)/i);
  if (rttAcquisMatch) data.rttAcquis = parseNum(rttAcquisMatch[1]);

  const rttPrisMatch = text.match(/RTT\s+Pris\s*:?\s*([\d,\.]+)/i);
  if (rttPrisMatch) data.rttPris = parseNum(rttPrisMatch[1]);

  const rttSoldeMatch = text.match(/RTT\s+(?:Solde|Reste)\s*:?\s*([\d,\.]+)/i);
  if (rttSoldeMatch) data.rttRestants = parseNum(rttSoldeMatch[1]);

  // === CUMULS ANNUELS ===
  const cumulBrutMatch = text.match(/CUMUL\s+(?:BRUT|IMPOSABLE)\s+(?:ANNUEL|FISCAL)\s+([\d\s]+[,\.]\d{2})/i);
  if (cumulBrutMatch) data.cumulBrutAnnuel = parseNum(cumulBrutMatch[1]);

  const cumulNetMatch = text.match(/CUMUL\s+NET\s+(?:IMPOSABLE|FISCAL)\s+([\d\s]+[,\.]\d{2})/i);
  if (cumulNetMatch) data.cumulNetImposableAnnuel = parseNum(cumulNetMatch[1]);

  // === PAYMENT ===
  const paiementDatePatterns = [
    /Paiement\s+le\s*:?\s*(\d{2}\/\d{2}\/\d{2,4})/i,
    /Pay[ée]\s+le\s*:?\s*(\d{2}\/\d{2}\/\d{2,4})/i,
    /Date\s+(?:de\s+)?paiement\s*:?\s*(\d{2}\/\d{2}\/\d{2,4})/i,
    /Vers[ée]\s+le\s*:?\s*(\d{2}\/\d{2}\/\d{2,4})/i,
  ];
  for (const pat of paiementDatePatterns) {
    const m = text.match(pat);
    if (m) {
      const parts = m[1].split("/");
      const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
      data.paymentDate = `${year}-${parts[1]}-${parts[0]}`;
      break;
    }
  }

  const payMethodPatterns = [
    { re: /(?:par\s+|mode\s*:?\s*)?virement/i, method: "virement" },
    { re: /(?:par\s+|mode\s*:?\s*)?ch[eè]que/i, method: "chèque" },
    { re: /(?:par\s+|mode\s*:?\s*)?esp[eè]ces/i, method: "espèces" },
  ];
  for (const { re, method } of payMethodPatterns) {
    if (re.test(text)) {
      data.paymentMethod = method;
      break;
    }
  }

  // === SANITY CHECKS ===
  if (data.netSalary > 0 && data.grossSalary > 0 && data.netSalary > data.grossSalary) {
    const tmp = data.grossSalary;
    data.grossSalary = data.netSalary;
    data.netSalary = tmp;
    console.log(`[PayrollParser:Core] Swapped brut/net (brut was < net)`);
  }

  if (data.grossSalary > 0 && data.netSalary > 0 && data.netSalary > data.grossSalary * 0.95) {
    console.log(`[PayrollParser:Core] Warning: net suspiciously close to brut (${data.netSalary}/${data.grossSalary})`);
  }

  return data;
}

function scoreResult(data: ParsedPayrollData): number {
  let score = 0;
  if (data.employee.lastName) score += 10;
  if (data.employee.firstName) score += 10;
  if (data.employee.role && data.employee.role !== "Non précisé") score += 5;
  if (data.employee.socialSecurityNumber) score += 5;
  if (data.employee.employeeNumber) score += 3;
  if (data.employee.startDate) score += 5;
  if (data.employee.contractType && data.employee.contractType !== "CDI") score += 3;
  if (data.employee.weeklyHours) score += 2;
  if (data.employee.classification || data.employee.coefficient) score += 2;
  if (data.employer.name) score += 5;
  if (data.employer.siret) score += 5;
  if (data.employer.ape) score += 2;
  if (data.employer.conventionCollective) score += 2;
  if (data.period && data.period.match(/^\d{4}-\d{2}$/)) score += 15;
  if (data.grossSalary > 0) score += 15;
  if (data.netSalary > 0) score += 15;
  if (data.socialCharges > 0) score += 5;
  if (data.employerCharges && data.employerCharges > 0) score += 3;
  if (data.hoursWorked && data.hoursWorked > 0) score += 3;
  if (data.hourlyRate && data.hourlyRate > 0) score += 3;
  if (data.netBeforeTax && data.netBeforeTax > 0) score += 3;
  if (data.netImposable && data.netImposable > 0) score += 3;
  if (data.incomeTax && data.incomeTax > 0) score += 3;
  if (data.paymentDate) score += 3;
  if (data.paymentMethod) score += 2;
  if (data.congesAcquis !== null) score += 2;
  if (data.deductions.length > 0) score += 5;
  if (data.bonusDetails.length > 0) score += 2;
  if (data.grossSalary > 0 && data.netSalary > 0 && data.grossSalary > data.netSalary) score += 5;
  return score;
}

function mergeData(primary: ParsedPayrollData, secondary: ParsedPayrollData): ParsedPayrollData {
  const result = JSON.parse(JSON.stringify(primary)) as ParsedPayrollData;

  if (!result.employee.lastName && secondary.employee.lastName) {
    result.employee.lastName = secondary.employee.lastName;
    result.employee.firstName = secondary.employee.firstName || result.employee.firstName;
  }
  if (!result.employee.firstName && secondary.employee.firstName) result.employee.firstName = secondary.employee.firstName;
  if ((!result.employee.role || result.employee.role === "Non précisé") && secondary.employee.role) result.employee.role = secondary.employee.role;
  if (!result.employee.socialSecurityNumber && secondary.employee.socialSecurityNumber) result.employee.socialSecurityNumber = secondary.employee.socialSecurityNumber;
  if (!result.employee.employeeNumber && secondary.employee.employeeNumber) result.employee.employeeNumber = secondary.employee.employeeNumber;
  if (!result.employee.startDate && secondary.employee.startDate) result.employee.startDate = secondary.employee.startDate;
  if (!result.employee.weeklyHours && secondary.employee.weeklyHours) result.employee.weeklyHours = secondary.employee.weeklyHours;
  if (!result.employee.birthDate && secondary.employee.birthDate) result.employee.birthDate = secondary.employee.birthDate;
  if (!result.employee.classification && secondary.employee.classification) result.employee.classification = secondary.employee.classification;
  if (!result.employee.coefficient && secondary.employee.coefficient) result.employee.coefficient = secondary.employee.coefficient;
  if (!result.employee.echelon && secondary.employee.echelon) result.employee.echelon = secondary.employee.echelon;
  if (!result.employee.nationality && secondary.employee.nationality) result.employee.nationality = secondary.employee.nationality;

  if (!result.employer.name && secondary.employer.name) result.employer.name = secondary.employer.name;
  if (!result.employer.siret && secondary.employer.siret) result.employer.siret = secondary.employer.siret;
  if (!result.employer.address && secondary.employer.address) result.employer.address = secondary.employer.address;
  if (!result.employer.ape && secondary.employer.ape) result.employer.ape = secondary.employer.ape;
  if (!result.employer.conventionCollective && secondary.employer.conventionCollective) result.employer.conventionCollective = secondary.employer.conventionCollective;
  if (!result.employer.urssafNumber && secondary.employer.urssafNumber) result.employer.urssafNumber = secondary.employer.urssafNumber;

  if (!result.period && secondary.period) result.period = secondary.period;
  if (result.grossSalary <= 0 && secondary.grossSalary > 0) result.grossSalary = secondary.grossSalary;
  if (result.netSalary <= 0 && secondary.netSalary > 0) result.netSalary = secondary.netSalary;
  if (!result.netBeforeTax && secondary.netBeforeTax) result.netBeforeTax = secondary.netBeforeTax;
  if (!result.netImposable && secondary.netImposable) result.netImposable = secondary.netImposable;

  if (result.netSalary > 0 && result.netImposable && result.netImposable > 0) {
    if (Math.abs(result.netSalary - result.netImposable) < 1 && secondary.netSalary > 0 && secondary.netSalary !== result.netSalary) {
      console.log(`[PayrollParser] Net/NetImposable confusion detected: ${result.netSalary} ≈ ${result.netImposable}. Using secondary net: ${secondary.netSalary}`);
      result.netSalary = secondary.netSalary;
    }
    if (result.netSalary > result.netImposable && secondary.netSalary > 0 && secondary.netSalary < result.netImposable) {
      console.log(`[PayrollParser] Net > NetImposable anomaly: ${result.netSalary} > ${result.netImposable}. Using secondary net: ${secondary.netSalary}`);
      result.netSalary = secondary.netSalary;
    }
  }

  if (result.netSalary > 0 && result.grossSalary > 0 && result.netSalary > result.grossSalary * 0.9) {
    if (secondary.netSalary > 0 && secondary.netSalary < result.netSalary && secondary.netSalary < result.grossSalary * 0.9) {
      console.log(`[PayrollParser] Net suspiciously close to gross: ${result.netSalary}/${result.grossSalary}. Using secondary net: ${secondary.netSalary}`);
      result.netSalary = secondary.netSalary;
    }
  }
  if (result.socialCharges <= 0 && secondary.socialCharges > 0) result.socialCharges = secondary.socialCharges;
  if (!result.employerCharges && secondary.employerCharges) result.employerCharges = secondary.employerCharges;
  if (!result.totalEmployerCost && secondary.totalEmployerCost) result.totalEmployerCost = secondary.totalEmployerCost;
  if (result.bonus <= 0 && secondary.bonus > 0) { result.bonus = secondary.bonus; result.bonusDetails = secondary.bonusDetails; }
  if (result.overtime <= 0 && secondary.overtime > 0) result.overtime = secondary.overtime;
  if (!result.hoursWorked && secondary.hoursWorked) result.hoursWorked = secondary.hoursWorked;
  if (!result.hourlyRate && secondary.hourlyRate) result.hourlyRate = secondary.hourlyRate;
  if (!result.overtimeHours && secondary.overtimeHours) result.overtimeHours = secondary.overtimeHours;
  if (!result.absenceHours && secondary.absenceHours) result.absenceHours = secondary.absenceHours;
  if (!result.absenceDeduction && secondary.absenceDeduction) result.absenceDeduction = secondary.absenceDeduction;
  if (!result.mealAllowance && secondary.mealAllowance) result.mealAllowance = secondary.mealAllowance;
  if (!result.transportAllowance && secondary.transportAllowance) result.transportAllowance = secondary.transportAllowance;
  if (!result.inKindBenefits && secondary.inKindBenefits) result.inKindBenefits = secondary.inKindBenefits;
  if (!result.incomeTax && secondary.incomeTax) result.incomeTax = secondary.incomeTax;
  if (!result.incomeTaxRate && secondary.incomeTaxRate) result.incomeTaxRate = secondary.incomeTaxRate;
  if (!result.paymentDate && secondary.paymentDate) result.paymentDate = secondary.paymentDate;
  if (!result.paymentMethod && secondary.paymentMethod) result.paymentMethod = secondary.paymentMethod;
  if (result.congesAcquis === null && secondary.congesAcquis !== null) result.congesAcquis = secondary.congesAcquis;
  if (result.congesPris === null && secondary.congesPris !== null) result.congesPris = secondary.congesPris;
  if (result.congesRestants === null && secondary.congesRestants !== null) result.congesRestants = secondary.congesRestants;
  if (result.rttAcquis === null && secondary.rttAcquis !== null) result.rttAcquis = secondary.rttAcquis;
  if (result.rttPris === null && secondary.rttPris !== null) result.rttPris = secondary.rttPris;
  if (result.rttRestants === null && secondary.rttRestants !== null) result.rttRestants = secondary.rttRestants;
  if (result.cumulBrutAnnuel === null && secondary.cumulBrutAnnuel !== null) result.cumulBrutAnnuel = secondary.cumulBrutAnnuel;
  if (result.cumulNetImposableAnnuel === null && secondary.cumulNetImposableAnnuel !== null) result.cumulNetImposableAnnuel = secondary.cumulNetImposableAnnuel;
  if (result.deductions.length === 0 && secondary.deductions.length > 0) result.deductions = secondary.deductions;

  return result;
}

const EXTRACTION_PROMPT = `Tu es un expert-comptable français spécialisé dans l'analyse de bulletins de paie.
Extrais TOUTES les informations suivantes du bulletin de paie ci-dessous. Réponds UNIQUEMENT en JSON valide, sans commentaires.

Format de réponse EXACT (JSON):
{
  "employee": {
    "firstName": "Prénom",
    "lastName": "NOM",
    "role": "Poste/Emploi/Qualification",
    "contractType": "CDI|CDD|Extra|Stage|Intérim|Apprentissage|Saisonnier",
    "weeklyHours": 35,
    "startDate": "YYYY-MM-DD ou null",
    "socialSecurityNumber": "numéro sécu ou null",
    "employeeNumber": "matricule ou null",
    "birthDate": "YYYY-MM-DD ou null",
    "nationality": "nationalité ou null",
    "classification": "classification conventionnelle ou null",
    "coefficient": 0,
    "echelon": "échelon ou null"
  },
  "employer": {
    "name": "Nom entreprise",
    "siret": "SIRET (14 chiffres) ou null",
    "address": "Adresse complète ou null",
    "ape": "Code APE/NAF ou null",
    "conventionCollective": "Nom convention collective ou null",
    "urssafNumber": "N° URSSAF ou null"
  },
  "period": "YYYY-MM",
  "grossSalary": 0.00,
  "netSalary": 0.00,
  "netBeforeTax": 0.00,
  "netImposable": 0.00,
  "socialCharges": 0.00,
  "employerCharges": 0.00,
  "totalEmployerCost": 0.00,
  "bonus": 0.00,
  "bonusDetails": [{"label": "Nom prime", "amount": 0.00}],
  "overtime": 0.00,
  "overtimeHours": 0,
  "hoursWorked": 0,
  "hourlyRate": 0.00,
  "absenceHours": null,
  "absenceDeduction": null,
  "mealAllowance": null,
  "transportAllowance": null,
  "inKindBenefits": null,
  "deductions": [{"label": "Nom cotisation", "base": 0.00, "rate": 0.00, "employeeAmount": 0.00, "employerAmount": 0.00}],
  "congesAcquis": 0,
  "congesPris": 0,
  "congesRestants": 0,
  "rttAcquis": null,
  "rttPris": null,
  "rttRestants": null,
  "cumulBrutAnnuel": null,
  "cumulNetImposableAnnuel": null,
  "paymentDate": "YYYY-MM-DD ou null",
  "paymentMethod": "virement|chèque|espèces|null",
  "incomeTax": null,
  "incomeTaxRate": null
}

RÈGLES:
- EMPLOYEUR = entreprise (SIRET, raison sociale). EMPLOYÉ = personne physique (nom, prénom, matricule, sécu).
- Convention nom français: NOM en majuscules souvent avant le prénom. Ex: "M FHIMA AVICHAI" → lastName="FHIMA", firstName="AVICHAI".
- Brut > Net toujours
- socialCharges = TOTAL DES RETENUES part salariale
- netSalary = NET A PAYER AU SALARIE (montant final versé)
- netBeforeTax = NET A PAYER AVANT IMPOT SUR LE REVENU
- netImposable = NET IMPOSABLE (base calcul impôt)
- incomeTax = Impôt sur le revenu prélevé à la source (PAS)
- totalEmployerCost = grossSalary + employerCharges
- Période au format YYYY-MM
- Dates françaises (JJ/MM/AAAA) → YYYY-MM-DD
- Montants en euros, 2 décimales
- Si un champ n'est pas trouvé, mettre null (pas 0)`;

function extractJsonFromResponse(text: string): any {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = jsonMatch ? jsonMatch[1].trim() : text;
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (!braceMatch) throw new Error("No JSON found in AI response");
  let jsonStr = braceMatch[0];
  try {
    return JSON.parse(jsonStr);
  } catch {
    jsonStr = jsonStr.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]").replace(/\n/g, " ").replace(/\t/g, " ");
    try {
      return JSON.parse(jsonStr);
    } catch (e2) {
      jsonStr = jsonStr.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      return JSON.parse(jsonStr);
    }
  }
}

function sanitizeAiResult(aiData: any): ParsedPayrollData {
  const base = createEmptyPayrollData();

  if (aiData.employee) {
    base.employee.firstName = aiData.employee.firstName || "";
    base.employee.lastName = aiData.employee.lastName || "";
    base.employee.role = aiData.employee.role || "";
    base.employee.contractType = aiData.employee.contractType || "CDI";
    base.employee.weeklyHours = aiData.employee.weeklyHours || null;
    base.employee.startDate = aiData.employee.startDate || null;
    base.employee.socialSecurityNumber = aiData.employee.socialSecurityNumber || null;
    base.employee.employeeNumber = aiData.employee.employeeNumber || null;
    base.employee.birthDate = aiData.employee.birthDate || null;
    base.employee.nationality = aiData.employee.nationality || null;
    base.employee.classification = aiData.employee.classification || null;
    base.employee.coefficient = aiData.employee.coefficient || null;
    base.employee.echelon = aiData.employee.echelon || null;
  }
  if (aiData.employer) {
    base.employer.name = aiData.employer.name || "";
    base.employer.siret = aiData.employer.siret || null;
    base.employer.address = aiData.employer.address || null;
    base.employer.ape = aiData.employer.ape || null;
    base.employer.conventionCollective = aiData.employer.conventionCollective || null;
    base.employer.urssafNumber = aiData.employer.urssafNumber || null;
  }

  base.period = aiData.period || "";
  base.grossSalary = parseFloat(aiData.grossSalary) || 0;
  base.netSalary = parseFloat(aiData.netSalary) || 0;
  base.netBeforeTax = parseFloat(aiData.netBeforeTax) || null;
  base.netImposable = parseFloat(aiData.netImposable) || null;
  base.socialCharges = parseFloat(aiData.socialCharges) || 0;
  base.employerCharges = parseFloat(aiData.employerCharges) || null;
  base.totalEmployerCost = parseFloat(aiData.totalEmployerCost) || null;
  base.bonus = parseFloat(aiData.bonus) || 0;
  base.overtime = parseFloat(aiData.overtime) || 0;
  base.overtimeHours = parseFloat(aiData.overtimeHours) || null;
  base.hoursWorked = parseFloat(aiData.hoursWorked) || null;
  base.hourlyRate = parseFloat(aiData.hourlyRate) || null;
  base.absenceHours = parseFloat(aiData.absenceHours) || null;
  base.absenceDeduction = parseFloat(aiData.absenceDeduction) || null;
  base.mealAllowance = parseFloat(aiData.mealAllowance) || null;
  base.transportAllowance = parseFloat(aiData.transportAllowance) || null;
  base.inKindBenefits = parseFloat(aiData.inKindBenefits) || null;
  base.incomeTax = parseFloat(aiData.incomeTax) || null;
  base.incomeTaxRate = parseFloat(aiData.incomeTaxRate) || null;
  base.congesAcquis = aiData.congesAcquis ?? null;
  base.congesPris = aiData.congesPris ?? null;
  base.congesRestants = aiData.congesRestants ?? null;
  base.rttAcquis = aiData.rttAcquis ?? null;
  base.rttPris = aiData.rttPris ?? null;
  base.rttRestants = aiData.rttRestants ?? null;
  base.cumulBrutAnnuel = parseFloat(aiData.cumulBrutAnnuel) || null;
  base.cumulNetImposableAnnuel = parseFloat(aiData.cumulNetImposableAnnuel) || null;
  base.paymentDate = aiData.paymentDate || null;
  base.paymentMethod = aiData.paymentMethod || null;

  if (Array.isArray(aiData.deductions)) {
    base.deductions = aiData.deductions.filter((d: any) => d && d.label).map((d: any) => ({
      label: d.label,
      base: parseFloat(d.base) || null,
      rate: parseFloat(d.rate) || null,
      employeeAmount: parseFloat(d.employeeAmount) || 0,
      employerAmount: parseFloat(d.employerAmount) || null,
    }));
  }
  if (Array.isArray(aiData.bonusDetails)) {
    base.bonusDetails = aiData.bonusDetails.filter((b: any) => b && b.label && b.amount).map((b: any) => ({
      label: b.label,
      amount: parseFloat(b.amount) || 0,
    }));
  }

  return base;
}

async function extractPayrollWithVision(pdfBuffer: Buffer, fileName?: string): Promise<ParsedPayrollData | null> {
  const base64Pdf = pdfBuffer.toString("base64");
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
        { 
          role: "user", 
          content: [
            { type: "text", text: `Analyse ce bulletin de paie PDF (fichier: ${fileName || "inconnu"}) et extrais toutes les informations.` },
            { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64Pdf}` } }
          ]
        },
      ],
      temperature: 0,
      max_tokens: 8192,
      response_format: { type: "json_object" },
    });
    const raw = response.choices[0]?.message?.content || "";
    console.log(`[PayrollParser:Vision] OpenAI vision response (${raw.length} chars)`);
    const parsed = extractJsonFromResponse(raw);
    return sanitizeAiResult(parsed);
  } catch (visionErr: any) {
    console.warn(`[PayrollParser:Vision] OpenAI vision failed: ${visionErr.message}, trying Gemini...`);
    try {
      const response = await geminiAI.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              { text: EXTRACTION_PROMPT + `\n\nAnalyse ce bulletin de paie PDF (fichier: ${fileName || "inconnu"}) et extrais toutes les informations.` },
              { inlineData: { mimeType: "application/pdf", data: base64Pdf } }
            ]
          }
        ],
        config: { temperature: 0, maxOutputTokens: 8192 },
      });
      const raw = response.text || "";
      console.log(`[PayrollParser:Vision] Gemini vision response (${raw.length} chars)`);
      const parsed = extractJsonFromResponse(raw);
      return sanitizeAiResult(parsed);
    } catch (geminiErr: any) {
      console.error(`[PayrollParser:Vision] Gemini vision also failed: ${geminiErr.message}`);
      return null;
    }
  }
}

async function extractWithAI(pdfText: string): Promise<ParsedPayrollData | null> {
  try {
    const response = await geminiAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: EXTRACTION_PROMPT + "\n\n--- BULLETIN DE PAIE ---\n" + pdfText,
      config: { temperature: 0, maxOutputTokens: 8192 },
    });
    const raw = response.text || "";
    console.log(`[PayrollParser:AI] Gemini response (${raw.length} chars)`);
    const parsed = extractJsonFromResponse(raw);
    return sanitizeAiResult(parsed);
  } catch (geminiErr: any) {
    console.warn(`[PayrollParser:AI] Gemini failed: ${geminiErr.message}, trying OpenAI...`);
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: EXTRACTION_PROMPT },
          { role: "user", content: "--- BULLETIN DE PAIE ---\n" + pdfText },
        ],
        temperature: 0,
        max_tokens: 8192,
        response_format: { type: "json_object" },
      });
      const raw = response.choices[0]?.message?.content || "";
      console.log(`[PayrollParser:AI] OpenAI response (${raw.length} chars)`);
      const parsed = extractJsonFromResponse(raw);
      return sanitizeAiResult(parsed);
    } catch (openaiErr: any) {
      console.warn(`[PayrollParser:AI] OpenAI also failed: ${openaiErr.message}`);
      return null;
    }
  }
}

export async function parsePayrollPDF(buffer: Buffer, fileName?: string): Promise<PayrollParseResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  await ensurePdfLoaded();
  if (!pdfParseFn) {
    return { success: false, data: null, warnings: [], errors: ["pdf-parse module not available"], confidence: 0, source: "core" };
  }

  const safeBuffer = Buffer.from(buffer);
  
  let pdfText = "";
  let textExtractionFailed = false;
  
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const pdfData = await pdfParseFn(safeBuffer);
      pdfText = pdfData.text || "";
      console.log(`[PayrollParser] PDF parsed (attempt ${attempt}): ${pdfText.length} chars, ${pdfData.numpages} pages`);
      break;
    } catch (e: any) {
      console.warn(`[PayrollParser] pdf-parse attempt ${attempt} failed: ${e.message}`);
      if (attempt === 2) {
        console.log(`[PayrollParser] Text extraction failed, trying AI vision fallback...`);
        textExtractionFailed = true;
      } else {
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  if (textExtractionFailed || pdfText.length < 50) {
    try {
      const aiData = await extractPayrollWithVision(safeBuffer, fileName);
      if (aiData && aiData.employee?.lastName) {
        const score = scoreResult(aiData);
        console.log(`[PayrollParser:Vision] AI vision extracted: ${aiData.employee.lastName} ${aiData.employee.firstName}, score=${score}`);
        
        if (!aiData.employee.role || aiData.employee.role === "") aiData.employee.role = "Non précisé";
        if (!aiData.employee.contractType) aiData.employee.contractType = "CDI";
        if (aiData.grossSalary > 0 && aiData.netSalary > 0 && aiData.socialCharges <= 0) {
          aiData.socialCharges = Math.round((aiData.grossSalary - aiData.netSalary) * 100) / 100;
        }
        
        return {
          success: true,
          data: aiData,
          warnings: ["PDF text extraction failed - parsed via AI vision"],
          errors: [],
          confidence: Math.min(score / 100, 0.90),
          source: "ai",
        };
      }
    } catch (visionErr: any) {
      console.error(`[PayrollParser:Vision] AI vision fallback failed: ${visionErr.message}`);
    }
    return { success: false, data: null, warnings: [], errors: ["PDF parse failed and AI vision fallback unsuccessful"], confidence: 0, source: "core" };
  }

  console.log(`[PayrollParser:Core] === AUTONOMOUS CORE PARSER V3 ===`);
  const coreData = coreParsePayroll(pdfText, fileName);
  const coreScore = scoreResult(coreData);
  console.log(`[PayrollParser:Core] Score: ${coreScore}/140`);
  console.log(`[PayrollParser:Core] Employee: ${coreData.employee.lastName} ${coreData.employee.firstName}`);
  console.log(`[PayrollParser:Core] Period: ${coreData.period}`);
  console.log(`[PayrollParser:Core] Brut: ${coreData.grossSalary}, Net: ${coreData.netSalary}, Charges: ${coreData.socialCharges}`);
  console.log(`[PayrollParser:Core] Hours: ${coreData.hoursWorked}, Rate: ${coreData.hourlyRate}`);
  console.log(`[PayrollParser:Core] Employer: ${coreData.employer.name} (SIRET: ${coreData.employer.siret})`);
  console.log(`[PayrollParser:Core] Payment: ${coreData.paymentDate} by ${coreData.paymentMethod}`);
  console.log(`[PayrollParser:Core] CP: acquired=${coreData.congesAcquis}, taken=${coreData.congesPris}, remaining=${coreData.congesRestants}`);
  console.log(`[PayrollParser:Core] PAS: ${coreData.incomeTax} (${coreData.incomeTaxRate}%)`);
  console.log(`[PayrollParser:Core] Bonuses: ${coreData.bonusDetails.length} items, total=${coreData.bonus}`);

  let finalData = coreData;
  let source: "core" | "core+ai" | "ai" | "regex" = "core";
  let confidence = Math.min(coreScore / 140, 0.95);

  if (coreScore >= 70) {
    console.log(`[PayrollParser:Core] Core parser sufficient (score ${coreScore}), AI enrichment optional`);
    try {
      const aiData = await extractWithAI(pdfText);
      if (aiData) {
        const aiScore = scoreResult(aiData);
        console.log(`[PayrollParser:AI] AI score: ${aiScore}/140`);
        if (aiScore > coreScore) {
          finalData = mergeData(aiData, coreData);
          source = "core+ai";
          console.log(`[PayrollParser] Merged: AI primary + Core fallback`);
        } else {
          finalData = mergeData(coreData, aiData);
          source = "core+ai";
          console.log(`[PayrollParser] Merged: Core primary + AI enrichment`);
        }
      }
    } catch (aiErr: any) {
      console.log(`[PayrollParser] AI unavailable, Core parser standalone: ${aiErr.message}`);
      source = "core";
    }
  } else if (coreScore >= 40) {
    console.log(`[PayrollParser:Core] Core partial (score ${coreScore}), AI enrichment needed`);
    try {
      const aiData = await extractWithAI(pdfText);
      if (aiData) {
        finalData = mergeData(coreData, aiData);
        source = "core+ai";
      }
    } catch {
      source = "core";
    }
  } else {
    console.log(`[PayrollParser:Core] Core low score (${coreScore}), trying AI as primary`);
    try {
      const aiData = await extractWithAI(pdfText);
      if (aiData) {
        finalData = mergeData(aiData, coreData);
        source = "ai";
        confidence = 0.7;
      }
    } catch {
      source = "core";
    }
  }

  // === FINAL SANITY CHECKS ===

  // Prevent employer name from being used as employee name (AI often confuses them)
  const FINAL_INVALID_NAMES = new Set([
    "MONTANT", "NET", "TOTAL", "BRUT", "PAYER", "PAIE", "BULLETIN",
    "COTISATIONS", "RETENUES", "GAINS", "RUBRIQUE", "BASE", "TAUX",
    "CUMUL", "HEURES", "SALAIRE", "SUGU", "VALENTINE", "MAILLANE",
    "RESTAURANT", "CAFE", "HOTEL", "BAR", "BRASSERIE", "SAS", "SARL",
    "EURL", "SCI", "SA", "SASU",
  ]);
  const empLN = (finalData.employee.lastName || "").toUpperCase().trim();
  const empFN = (finalData.employee.firstName || "").toUpperCase().trim();
  const employerNameUpper = (finalData.employer.name || "").toUpperCase();
  const employeeNameIsInvalid = (
    FINAL_INVALID_NAMES.has(empLN) ||
    FINAL_INVALID_NAMES.has(empFN) ||
    (employerNameUpper && (
      employerNameUpper.includes(empLN) && empLN.length >= 3 ||
      empLN.includes(employerNameUpper.split(/\s+/)[0]) && employerNameUpper.split(/\s+/)[0].length >= 3
    )) ||
    (empLN === empFN && empLN.length > 0)
  );

  if (employeeNameIsInvalid) {
    console.log(`[PayrollParser] SANITY: Employee name "${finalData.employee.lastName} ${finalData.employee.firstName}" looks invalid (matches employer/keyword), checking alternatives`);
    if (coreData.employee.lastName && coreData.employee.lastName !== finalData.employee.lastName) {
      finalData.employee.lastName = coreData.employee.lastName;
      finalData.employee.firstName = coreData.employee.firstName;
      console.log(`[PayrollParser] SANITY: Restored core parser name: ${finalData.employee.lastName} ${finalData.employee.firstName}`);
    } else if (fileName) {
      const fnSanity = fileName.match(/BS\s*\d{4}\s+(.+?)\.pdf/i);
      if (fnSanity) {
        const parts = fnSanity[1].trim().split(/\s+/);
        if (parts.length >= 2) {
          finalData.employee.lastName = parts[0].toUpperCase();
          finalData.employee.firstName = parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
          console.log(`[PayrollParser] SANITY: Restored filename name: ${finalData.employee.lastName} ${finalData.employee.firstName}`);
        }
      }
    }
  }

  if (finalData.grossSalary > 0 && finalData.netSalary > 0 && finalData.grossSalary < finalData.netSalary) {
    const tmp = finalData.grossSalary;
    finalData.grossSalary = finalData.netSalary;
    finalData.netSalary = tmp;
    warnings.push("Brut/net inversés - corrigé automatiquement");
  }

  if (finalData.netSalary > 0 && finalData.netImposable && finalData.netImposable > 0
      && finalData.netSalary >= finalData.netImposable && finalData.incomeTax && finalData.incomeTax > 0) {
    const correctedNet = Math.round((finalData.netImposable - finalData.incomeTax) * 100) / 100;
    if (correctedNet > 0 && correctedNet < finalData.netImposable) {
      console.log(`[PayrollParser] SANITY: Net (${finalData.netSalary}) >= NetImposable (${finalData.netImposable}) with PAS=${finalData.incomeTax}. Correcting to ${correctedNet}`);
      finalData.netSalary = correctedNet;
    }
  }

  if (finalData.grossSalary > 0 && finalData.netSalary > 0 && finalData.socialCharges <= 0) {
    finalData.socialCharges = Math.round((finalData.grossSalary - finalData.netSalary) * 100) / 100;
  }

  if (finalData.grossSalary > 0 && finalData.employerCharges && finalData.employerCharges > 0 && !finalData.totalEmployerCost) {
    finalData.totalEmployerCost = Math.round((finalData.grossSalary + finalData.employerCharges) * 100) / 100;
  }

  if (!finalData.employee.role || finalData.employee.role === "") finalData.employee.role = "Non précisé";
  if (!finalData.employee.contractType) finalData.employee.contractType = "CDI";

  const finalScore = scoreResult(finalData);
  confidence = Math.min(finalScore / 140, 0.98);

  if (!finalData.employee.lastName) warnings.push("Nom de l'employé manquant");
  if (!finalData.period) warnings.push("Période manquante");
  if (finalData.grossSalary <= 0) warnings.push("Salaire brut invalide");
  if (finalData.netSalary <= 0) warnings.push("Salaire net invalide");
  if (finalData.grossSalary > 0 && finalData.netSalary > 0 && finalData.netSalary > finalData.grossSalary * 0.95) {
    warnings.push("Ratio net/brut suspicieusement élevé");
  }

  finalData.rawText = pdfText.substring(0, 2000);

  console.log(`[PayrollParser] FINAL: source=${source}, confidence=${confidence.toFixed(2)}, score=${finalScore}`);
  console.log(`[PayrollParser] FINAL: ${finalData.employee.lastName} ${finalData.employee.firstName} | ${finalData.period} | Brut: ${finalData.grossSalary} | Net: ${finalData.netSalary}`);

  return {
    success: true,
    data: finalData,
    warnings,
    errors,
    confidence,
    source,
  };
}
