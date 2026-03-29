import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { FileText, Loader2, Download, Mail, Calendar, BarChart3, Sparkles, X, Send, ChevronDown, ChevronUp } from "lucide-react";
import { useSuguDark } from "./context";
import { Card } from "./shared";

interface ExpertReportProps {
  defaultYear?: string;
  defaultTab?: "audit" | "comptabilite";
}

export function ExpertReport({ defaultYear, defaultTab = "audit" }: ExpertReportProps) {
  const dk = useSuguDark();
  const { toast } = useToast();
  const currentYear = new Date().getFullYear();
  const currentMonth = (new Date().getMonth() + 1).toString().padStart(2, "0");

  const [reportType, setReportType] = useState<"monthly" | "annual">("annual");
  const [year, setYear] = useState(defaultYear || currentYear.toString());
  const [month, setMonth] = useState(currentMonth);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<{ analysis: string; period: string; type: string; data: any } | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [emailModal, setEmailModal] = useState(false);
  const [emailTo, setEmailTo] = useState("x.markassuza@eyssautier.com");
  const [sending, setSending] = useState(false);

  const months = [
    { v: "01", l: "Janvier" }, { v: "02", l: "Février" }, { v: "03", l: "Mars" },
    { v: "04", l: "Avril" }, { v: "05", l: "Mai" }, { v: "06", l: "Juin" },
    { v: "07", l: "Juillet" }, { v: "08", l: "Août" }, { v: "09", l: "Septembre" },
    { v: "10", l: "Octobre" }, { v: "11", l: "Novembre" }, { v: "12", l: "Décembre" }
  ];

  const generateReport = async () => {
    setLoading(true);
    setReport(null);
    try {
      const body: any = { year, type: reportType };
      if (reportType === "monthly") body.month = month;

      const res = await apiRequest("POST", "/api/v2/sugu-management/analytics/expert-report", body);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Erreur");
      setReport(data);
      setExpanded(true);
      toast({ title: "Rapport généré", description: `${data.period} — Analyse prête` });
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message || "Impossible de générer le rapport", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const downloadReport = async () => {
    if (!report) return;
    try {
      const res = await fetch("/api/v2/sugu-management/analytics/expert-report/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis: report.analysis, period: report.period, type: report.type })
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Rapport_${report.period.replace(/\s/g, "_")}.html`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Téléchargement lancé" });
    } catch {
      toast({ title: "Erreur téléchargement", variant: "destructive" });
    }
  };

  const sendEmail = async () => {
    if (!report || !emailTo) return;
    setSending(true);
    try {
      const res = await apiRequest("POST", "/api/v2/sugu-management/analytics/expert-report/email", {
        analysis: report.analysis,
        period: report.period,
        type: report.type,
        email: emailTo
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      toast({ title: "Email envoyé", description: `Rapport envoyé à ${emailTo}` });
      setEmailModal(false);
    } catch (err: any) {
      toast({ title: "Erreur envoi", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const btnClass = (active: boolean) =>
    `px-4 py-2 rounded-lg text-sm font-medium transition-all ${active
      ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20"
      : dk ? "bg-white/5 text-white/60 hover:bg-white/10" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
    }`;

  const selectClass = `px-3 py-2 rounded-xl border text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/50 ${dk ? "bg-[#1e293b] border-white/10 text-white" : "bg-white border-slate-200 text-slate-800 shadow-sm"}`;

  return (
    <Card title="Analyse Expert-Comptable IA" icon={Sparkles}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button data-testid="btn-report-annual" onClick={() => setReportType("annual")} className={btnClass(reportType === "annual")}>
            <span className="flex items-center gap-1.5"><BarChart3 className="w-3.5 h-3.5" /> Bilan annuel</span>
          </button>
          <button data-testid="btn-report-monthly" onClick={() => setReportType("monthly")} className={btnClass(reportType === "monthly")}>
            <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Synthèse mensuelle</span>
          </button>

          <select data-testid="select-report-year" value={year} onChange={e => setYear(e.target.value)} className={selectClass}>
            {Array.from({ length: 5 }, (_, i) => (currentYear - i).toString()).map(y =>
              <option key={y} value={y}>{y}</option>
            )}
          </select>

          {reportType === "monthly" && (
            <select data-testid="select-report-month" value={month} onChange={e => setMonth(e.target.value)} className={selectClass}>
              {months.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
          )}

          <button
            data-testid="btn-generate-report"
            onClick={generateReport}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 text-white text-sm font-semibold hover:opacity-90 transition shadow-lg shadow-orange-500/20 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? "Analyse en cours..." : "Générer le rapport"}
          </button>
        </div>

        {loading && (
          <div className={`flex items-center gap-3 p-4 rounded-xl ${dk ? "bg-orange-500/10 border border-orange-500/20" : "bg-orange-50 border border-orange-200"}`}>
            <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
            <div>
              <p className={`text-sm font-medium ${dk ? "text-orange-400" : "text-orange-700"}`}>Analyse IA en cours...</p>
              <p className={`text-xs ${dk ? "text-white/40" : "text-slate-500"}`}>L'expert-comptable IA analyse vos données financières. Cela peut prendre 15 à 30 secondes.</p>
            </div>
          </div>
        )}

        {report && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <button
                data-testid="btn-toggle-report"
                onClick={() => setExpanded(!expanded)}
                className={`flex items-center gap-2 text-sm font-semibold ${dk ? "text-orange-400" : "text-orange-600"}`}
              >
                <FileText className="w-4 h-4" />
                {report.period}
                {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              <div className="flex items-center gap-2">
                <button
                  data-testid="btn-download-report"
                  onClick={downloadReport}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${dk ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}
                >
                  <Download className="w-3.5 h-3.5" /> Télécharger
                </button>
                <button
                  data-testid="btn-email-report"
                  onClick={() => setEmailModal(true)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${dk ? "bg-blue-500/10 text-blue-400 hover:bg-blue-500/20" : "bg-blue-50 text-blue-700 hover:bg-blue-100"}`}
                >
                  <Mail className="w-3.5 h-3.5" /> Envoyer par email
                </button>
              </div>
            </div>

            {expanded && (
              <div
                data-testid="report-content"
                className={`prose prose-sm max-w-none p-5 rounded-xl border ${dk
                  ? "bg-[#0f172a] border-white/10 prose-invert prose-headings:text-orange-400 prose-strong:text-white prose-p:text-white/80 prose-li:text-white/70"
                  : "bg-white border-slate-200 prose-headings:text-slate-800 prose-p:text-slate-700"
                } overflow-auto max-h-[600px]`}
                dangerouslySetInnerHTML={{ __html: markdownToHtml(report.analysis) }}
              />
            )}
          </div>
        )}

        {emailModal && report && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setEmailModal(false)}>
            <div
              className={`w-full max-w-md rounded-2xl p-6 shadow-2xl ${dk ? "bg-[#1e293b] border border-white/10" : "bg-white border border-slate-200"}`}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className={`text-lg font-bold ${dk ? "text-white" : "text-slate-800"}`}>Envoyer le rapport</h3>
                <button data-testid="btn-close-email-modal" onClick={() => setEmailModal(false)} className={`p-1 rounded-lg ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"}`}>
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className={`text-sm mb-3 ${dk ? "text-white/60" : "text-slate-500"}`}>{report.period}</p>
              <input
                data-testid="input-email-to"
                type="email"
                value={emailTo}
                onChange={e => setEmailTo(e.target.value)}
                placeholder="adresse@email.com"
                className={`w-full px-4 py-2.5 rounded-xl border text-sm ${dk ? "bg-[#0f172a] border-white/10 text-white placeholder:text-white/30" : "bg-slate-50 border-slate-200 text-slate-800 placeholder:text-slate-400"} focus:outline-none focus:ring-2 focus:ring-orange-500/50`}
              />
              <div className="flex justify-end gap-3 mt-4">
                <button data-testid="btn-cancel-email" onClick={() => setEmailModal(false)} className={`px-4 py-2 rounded-xl text-sm ${dk ? "bg-white/5 text-white/60 hover:bg-white/10" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                  Annuler
                </button>
                <button
                  data-testid="btn-send-email"
                  onClick={sendEmail}
                  disabled={sending || !emailTo}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 text-white text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {sending ? "Envoi..." : "Envoyer"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function markdownToHtml(md: string): string {
  // Escape raw HTML first to prevent XSS, then apply safe markdown transforms
  return escapeHtml(md)
    .replace(/^### (.*$)/gm, '<h3>$1</h3>')
    .replace(/^## (.*$)/gm, '<h2>$1</h2>')
    .replace(/^# (.*$)/gm, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^\d+\. (.*$)/gm, '<li>$1</li>')
    .replace(/^[\-\*] (.*$)/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\|(.+)\|/g, (match) => {
      const cells = match.split('|').filter(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c.trim()))) return '';
      return '<tr>' + cells.map(c => `<td>${c.trim()}</td>`).join('') + '</tr>';
    })
    .replace(/(<tr>.*<\/tr>\n?)+/g, '<table class="border-collapse w-full text-sm">$&</table>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n(?!<)/g, '<br>');
}
