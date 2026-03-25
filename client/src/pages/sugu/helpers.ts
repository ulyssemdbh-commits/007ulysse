export const FILE_CATEGORIES = [
    { value: "achats", label: "Achats" },
    { value: "frais_generaux", label: "Frais Généraux" },
    { value: "banque", label: "Banque" },
    { value: "rh", label: "Ressources Humaines" },
];

export const PURCHASE_CATEGORIES = ["alimentaire", "boissons", "emballages", "entretien", "comptabilite", "assurances", "vehicules", "plateformes", "materiels", "eau", "energie", "autre"];
export const EXPENSE_CATEGORIES = ["alimentaire", "boissons", "emballages", "entretien", "comptabilite", "assurances", "vehicules", "plateformes", "materiels", "eau", "energie", "autre"];
export const CONTRACT_TYPES = ["CDI", "CDD", "Extra", "Stage"];
export const ABSENCE_TYPES = ["conge", "maladie", "retard", "absence", "formation"];
export const PAYMENT_METHODS = ["virement", "cheque", "carte", "especes", "prelevement"];

export const MOIS_COURT = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];

export function fmt(n: number | null | undefined) {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n ?? 0);
}

export function fmtEur(n: number | null | undefined) {
    return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n ?? 0)) + " €";
}

export function fmtEurSigned(n: number | null | undefined) {
    const val = n ?? 0;
    const abs = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(val));
    if (val > 0) return `+${abs} €`;
    if (val < 0) return `-${abs} €`;
    return `${abs} €`;
}

export function safeFloat(v: string): number {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
}

export function safeInt(v: string): number {
    const n = parseInt(v);
    return isNaN(n) ? 0 : n;
}

export function t(dark: boolean, darkCls: string, lightCls: string) {
    return dark ? darkCls : lightCls;
}

export function fmtDate(d: string) {
    if (!d) return "-";
    return new Date(d).toLocaleDateString("fr-FR");
}

export function fmtDateShort(d: string) {
    if (!d) return "-";
    const dt = new Date(d);
    return `${dt.getDate().toString().padStart(2, "0")}-${MOIS_COURT[dt.getMonth()]}`;
}

export function catLabel(cat: string) {
    return cat.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());
}

export function bankOpType(cat?: string | null): string {
    if (!cat) return "";
    if (["virement_emis", "virement_recu", "encaissement_virement", "virement_interne", "loyer", "salaire", "achat_fournisseur", "credit_divers"].includes(cat)) return "Virement";
    if (["frais_bancaires", "prelevement", "assurance", "charges_sociales", "telecom", "energie", "emprunt", "leasing"].includes(cat)) return "Prél";
    if (["encaissement_cb", "plateforme"].includes(cat)) return "CB";
    if (["carburant", "vehicule", "equipement"].includes(cat)) return "Prél";
    return "Divers";
}
