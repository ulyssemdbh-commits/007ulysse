import PDFDocument from 'pdfkit';
import fs from 'fs';
import { db } from '../server/db';
import { capabilityRegistry } from '../shared/schema';
import { asc } from 'drizzle-orm';

const tools = [
  { name: "query_suguval_history", category: "SUGU", description: "Consulte l'historique des achats Suguval ou Sugumaillane" },
  { name: "query_sports_data", category: "Sports", description: "Récupère données sportives: matchs, cotes, classements, prédictions" },
  { name: "query_matchendirect", category: "Sports", description: "Récupère le calendrier mondial des matchs de football depuis matchendirect.fr" },
  { name: "query_brain", category: "Mémoire", description: "Recherche dans la mémoire/cerveau d'Ulysse" },
  { name: "query_stock_data", category: "Finance", description: "Récupère données boursières: analyse technique ou résumé marchés" },
  { name: "calendar_list_events", category: "Calendrier", description: "Liste les événements du calendrier Google pour une période donnée" },
  { name: "calendar_create_event", category: "Calendrier", description: "Crée un nouvel événement dans le calendrier Google" },
  { name: "email_list_inbox", category: "Email", description: "Liste les emails récents de la boîte AgentMail" },
  { name: "email_send", category: "Email", description: "Envoie un email via AgentMail avec support des pièces jointes" },
  { name: "smarthome_control", category: "Domotique", description: "Contrôle les appareils domotiques (lumières, prises, thermostats)" },
  { name: "location_get_weather", category: "Météo", description: "Récupère la météo actuelle à Marseille ou autre lieu" },
  { name: "web_search", category: "Recherche", description: "Effectue une recherche web via Serper/Perplexity" },
  { name: "read_url", category: "Recherche", description: "Lit et extrait le contenu textuel d'une page web" },
  { name: "spotify_control", category: "Musique", description: "Contrôle la lecture Spotify" },
  { name: "discord_send_message", category: "Discord", description: "Envoie un message sur Discord dans un canal spécifique" },
  { name: "discord_status", category: "Discord", description: "Vérifie le statut de connexion du bot Discord" },
  { name: "discord_add_reaction", category: "Discord", description: "Ajoute une réaction emoji à un message Discord" },
  { name: "discord_remove_reaction", category: "Discord", description: "Retire une réaction emoji d'un message Discord" },
  { name: "discord_delete_message", category: "Discord", description: "Supprime un message Discord" },
  { name: "discord_send_file", category: "Discord", description: "Envoie un fichier ou une image sur Discord" },
  { name: "discord_create_invitation", category: "Discord", description: "Crée un lien d'invitation pour le serveur Discord" },
  { name: "discord_voice_status", category: "Discord", description: "Vérifie qui est dans les canaux vocaux Discord" },
  { name: "memory_save", category: "Mémoire", description: "Sauvegarde une information dans la mémoire d'Ulysse" },
  { name: "image_generate", category: "Images", description: "Génère une image avec DALL-E" },
  { name: "todoist_create_task", category: "Tâches", description: "Crée une tâche dans Todoist" },
  { name: "todoist_list_tasks", category: "Tâches", description: "Liste les tâches Todoist du jour ou en retard" },
  { name: "todoist_complete_task", category: "Tâches", description: "Marque une tâche comme terminée" },
  { name: "kanban_create_task", category: "Kanban", description: "Crée une tâche dans le Kanban DevFlow" },
  { name: "analyze_file", category: "Fichiers", description: "Analyse intelligente de n'importe quel fichier (PDF, Excel, Word, images, CSV)" },
  { name: "analyze_invoice", category: "Factures", description: "Analyse spécialisée d'une facture avec extraction précise de toutes les données" },
  { name: "generate_file", category: "Fichiers", description: "Génère un fichier (Excel, CSV, PDF)" },
  { name: "export_analysis", category: "Export", description: "Exporte les résultats d'une analyse de fichier vers un nouveau format" },
  { name: "export_invoice_excel", category: "Export", description: "Exporte les données de factures vers un fichier Excel" }
];

async function generatePDF() {
  const capabilities = await db.select().from(capabilityRegistry).orderBy(asc(capabilityRegistry.category), asc(capabilityRegistry.name));
  
  // Ensure tmp directory exists
  if (!fs.existsSync('./tmp')) fs.mkdirSync('./tmp', { recursive: true });
  
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const filePath = './tmp/Ulysse_Outils_Capacites.pdf';
  const writeStream = fs.createWriteStream(filePath);
  doc.pipe(writeStream);
  
  // Title page
  doc.fontSize(28).font('Helvetica-Bold').text('ULYSSE', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(18).font('Helvetica').text('Outils et Capacites', { align: 'center' });
  doc.moveDown(2);
  doc.fontSize(12).text(`Genere le ${new Date().toLocaleDateString('fr-FR')}`, { align: 'center' });
  doc.moveDown(2);
  doc.fontSize(14).text(`33 Outils - ${capabilities.length} Capacites`, { align: 'center' });
  
  doc.addPage();
  
  // TOOLS SECTION
  doc.fontSize(22).font('Helvetica-Bold').fillColor('#2563eb').text('OUTILS (33)', { align: 'left' });
  doc.moveDown(0.5);
  doc.fontSize(10).font('Helvetica').fillColor('#666666').text('Actions que l\'IA peut executer pendant les conversations');
  doc.moveDown(1);
  
  const categories = [...new Set(tools.map(t => t.category))];
  
  for (const cat of categories) {
    const catTools = tools.filter(t => t.category === cat);
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1e40af').text(`${cat} (${catTools.length})`);
    doc.moveDown(0.3);
    
    for (const tool of catTools) {
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text(`- ${tool.name}`);
      doc.fontSize(9).font('Helvetica').fillColor('#444444').text(`  ${tool.description}`, { indent: 10 });
      doc.moveDown(0.3);
    }
    doc.moveDown(0.5);
  }
  
  doc.addPage();
  
  // CAPABILITIES SECTION
  doc.fontSize(22).font('Helvetica-Bold').fillColor('#059669').text(`CAPACITES (${capabilities.length})`, { align: 'left' });
  doc.moveDown(0.5);
  doc.fontSize(10).font('Helvetica').fillColor('#666666').text('Fonctionnalites techniques du systeme');
  doc.moveDown(1);
  
  const capCategories = [...new Set(capabilities.map(c => c.category))];
  
  for (const cat of capCategories) {
    const catCaps = capabilities.filter(c => c.category === cat);
    
    if (doc.y > 700) doc.addPage();
    
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#047857').text(`${cat} (${catCaps.length})`);
    doc.moveDown(0.3);
    
    for (const cap of catCaps) {
      if (doc.y > 750) doc.addPage();
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text(`- ${cap.name}`);
      doc.fontSize(9).font('Helvetica').fillColor('#444444').text(`  ${cap.description}`, { indent: 10, width: 480 });
      doc.moveDown(0.3);
    }
    doc.moveDown(0.5);
  }
  
  doc.end();
  
  await new Promise<void>((resolve) => {
    writeStream.on('finish', () => {
      console.log('PDF genere:', filePath);
      resolve();
    });
  });
}

generatePDF().catch(e => {
  console.error(e);
  process.exit(1);
});
