import { agentMailService } from '../server/services/agentMailService';
import fs from 'fs';

async function sendPdfEmails() {
  const pdfPath = './tmp/Ulysse_Outils_Capacites.pdf';
  const pdfBuffer = fs.readFileSync(pdfPath);
  const pdfBase64 = pdfBuffer.toString('base64');
  
  const recipients = [
    'djedoumaurice@gmail.com',
    'ulysse@agentmail.to'
  ];
  
  const subject = 'Ulysse - Documentation des 33 Outils et 247 Capacites';
  const body = `
<h2>Documentation Ulysse</h2>
<p>Bonjour,</p>
<p>Veuillez trouver en piece jointe le document PDF contenant:</p>
<ul>
  <li><strong>33 Outils</strong> - Les actions que l'IA peut executer</li>
  <li><strong>247 Capacites</strong> - Les fonctionnalites techniques du systeme</li>
</ul>
<p>Cordialement,<br>Ulysse</p>
  `;
  
  for (const to of recipients) {
    try {
      const result = await agentMailService.sendEmailWithAttachments({
        to,
        subject,
        body,
        attachments: [{
          filename: 'Ulysse_Outils_Capacites.pdf',
          content: pdfBase64,
          contentType: 'application/pdf'
        }]
      }, 'ulysse');
      console.log('Email envoye a:', to, result.success ? 'OK' : 'ERREUR');
    } catch (error: any) {
      console.error('Erreur envoi a', to, ':', error.message);
    }
  }
  
  console.log('Termine!');
  process.exit(0);
}

sendPdfEmails();
