import { discordService } from '../server/services/discordService';

async function test() {
  console.log('Testing Discord webhook...');
  
  const connected = await discordService.checkConnection();
  console.log('Webhook configured:', connected);
  
  if (connected) {
    const success = await discordService.sendNotification({
      title: '🤖 Ulysse est connecté !',
      message: 'Test réussi ! Je peux maintenant envoyer des notifications sur Discord.',
      type: 'success'
    });
    console.log('Message sent:', success);
  } else {
    console.log('Webhook URL not configured. Set DISCORD_WEBHOOK_URL secret.');
  }
}

test().catch(console.error);
