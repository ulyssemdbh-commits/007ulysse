// Discord Bot Service - PRO Edition
// Enables Ulysse to respond to Discord messages and voice calls with full slash commands
import { 
  Client, 
  GatewayIntentBits, 
  Message, 
  Events, 
  ChannelType, 
  AttachmentBuilder, 
  VoiceChannel, 
  GuildMember, 
  VoiceState,
  EmbedBuilder,
  ActivityType,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Colors,
  Options,
  MessageFlags
} from 'discord.js';
import { speechToText } from './voice/core';
import { discordVoiceService } from './discordVoiceService';
import { hearingHub, type HearingInput } from './sensory/HearingHub';
import { voiceOutputHub } from './sensory/VoiceOutputHub';
import { brainHub } from './sensory/BrainHub';
import * as fs from 'fs';
import * as path from 'path';

// File-based persistence for command registration version
const COMMANDS_VERSION_FILE = path.join(process.cwd(), '.discord_commands_version');

function getPersistedCommandVersion(): string | null {
  try {
    if (fs.existsSync(COMMANDS_VERSION_FILE)) {
      return fs.readFileSync(COMMANDS_VERSION_FILE, 'utf8').trim();
    }
  } catch (error) {
    console.log('[DiscordBot] Could not read command version file');
  }
  return null;
}

function persistCommandVersion(version: string): void {
  try {
    fs.writeFileSync(COMMANDS_VERSION_FILE, version, 'utf8');
  } catch (error) {
    console.log('[DiscordBot] Could not persist command version');
  }
}

// Slash commands definition
const slashCommands = [
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Rejoindre ton salon vocal'),
  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Quitter le salon vocal'),
  new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Afficher le statut vocal'),
  new SlashCommandBuilder()
    .setName('parle')
    .setDescription('Faire parler Ulysse dans le vocal')
    .addStringOption(option =>
      option.setName('texte')
        .setDescription('Le texte a prononcer')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('voix')
    .setDescription('Changer les parametres de voix')
    .addStringOption(option =>
      option.setName('voice')
        .setDescription('Type de voix')
        .addChoices(
          { name: 'Onyx (Grave)', value: 'onyx' },
          { name: 'Echo (Naturel)', value: 'echo' },
          { name: 'Nova (Claire)', value: 'nova' },
          { name: 'Fable (Chaude)', value: 'fable' },
          { name: 'Alloy (Moderne)', value: 'alloy' },
          { name: 'Shimmer (Douce)', value: 'shimmer' }
        )),
  new SlashCommandBuilder()
    .setName('ulysse')
    .setDescription('Poser une question a Ulysse')
    .addStringOption(option =>
      option.setName('question')
        .setDescription('Ta question')
        .setRequired(true)),
].map(command => command.toJSON());

// Command version hash for caching (update this when slash commands change)
const SLASH_COMMANDS_VERSION = 'v2.0.0-no-emoji';

class DiscordBotService {
  private client: Client | null = null;
  private botToken: string | null = null;
  private isConnected: boolean = false;
  private isInitializing: boolean = false;
  private ulysseHandler: ((message: string, userId: string) => Promise<string>) | null = null;
  private processedMessages: Set<string> = new Set();
  private messageCleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.botToken = process.env.DISCORD_BOT_TOKEN || null;
  }

  async initialize(ulysseHandler: (message: string, userId: string) => Promise<string>): Promise<boolean> {
    if (!this.botToken) {
      console.log('[DiscordBot] No bot token configured - bot disabled');
      return false;
    }

    // Prevent double initialization
    if (this.isInitializing) {
      console.log('[DiscordBot] Already initializing - skipping duplicate call');
      return false;
    }
    
    if (this.isConnected && this.client) {
      console.log('[DiscordBot] Already connected - skipping re-initialization');
      this.ulysseHandler = ulysseHandler;
      return true;
    }

    this.isInitializing = true;
    this.ulysseHandler = ulysseHandler;

    // Cleanup old message IDs every 5 minutes
    if (!this.messageCleanupInterval) {
      this.messageCleanupInterval = setInterval(() => {
        this.processedMessages.clear();
      }, 5 * 60 * 1000);
    }

    try {
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
          GatewayIntentBits.GuildVoiceStates,
          GatewayIntentBits.GuildMessageReactions
        ],
        makeCache: Options.cacheWithLimits({
          MessageManager: 10,
          GuildMemberManager: 0,
          ReactionManager: 0,
          ReactionUserManager: 0,
          PresenceManager: 0,
          UserManager: 0,
          ThreadManager: 0,
          StageInstanceManager: 0,
          GuildInviteManager: 0,
        })
      });

      this.client.once(Events.ClientReady, async (readyClient) => {
        console.log(`[DiscordBot] Connected as ${readyClient.user.tag}`);
        this.isConnected = true;
        
        // Register slash commands with file-based caching to avoid rate limits
        // Only re-register if version changed across restarts
        const persistedVersion = getPersistedCommandVersion();
        if (persistedVersion !== SLASH_COMMANDS_VERSION) {
          try {
            const rest = new REST({ version: '10' }).setToken(this.botToken!);
            console.log('[DiscordBot] Registering slash commands (version changed)...');
            await rest.put(
              Routes.applicationCommands(readyClient.user.id),
              { body: slashCommands }
            );
            persistCommandVersion(SLASH_COMMANDS_VERSION);
            console.log('[DiscordBot] Slash commands registered: /join, /leave, /voice, /parle, /voix, /ulysse');
          } catch (error: any) {
            console.error('[DiscordBot] Failed to register slash commands:', error.message);
          }
        } else {
          console.log('[DiscordBot] Slash commands up-to-date (skipping registration)');
        }
        
        // Set bot presence
        this.updatePresence('idle');
        
        // Initialize voice service with client
        discordVoiceService.initialize(this.client!, ulysseHandler);
        console.log('[DiscordBot] Voice service initialized');
      });

      // Handle slash commands
      this.client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isChatInputCommand()) return;
        await this.handleSlashCommand(interaction);
      });

      this.client.on(Events.MessageCreate, async (message: Message) => {
        await this.handleMessage(message);
      });

      // Handle voice state updates (user joins/leaves voice channels)
      this.client.on(Events.VoiceStateUpdate, async (oldState: VoiceState, newState: VoiceState) => {
        await this.handleVoiceStateUpdate(oldState, newState);
      });

      this.client.on(Events.Error, (error) => {
        console.error('[DiscordBot] Error:', error.message);
      });

      await this.client.login(this.botToken);
      this.isInitializing = false;
      return true;
    } catch (error: any) {
      console.error('[DiscordBot] Failed to initialize:', error.message);
      this.isInitializing = false;
      return false;
    }
  }

  private async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    // User joined a voice channel - AUTO-JOIN if not already in a channel
    if (!oldState.channel && newState.channel && newState.member && !newState.member.user.bot) {
      const username = newState.member.user.username;
      const channelName = newState.channel.name;
      const guildId = newState.guild.id;
      
      console.log(`[DiscordBot] ${username} joined voice channel ${channelName}`);
      
      // Auto-join: If Ulysse is not already in a voice channel, join automatically
      if (!discordVoiceService.isInChannel(guildId)) {
        console.log(`[DiscordBot] Auto-joining voice channel "${channelName}" to be with ${username}`);
        try {
          // Find text channel for responses
          const textChannel = newState.guild.systemChannel || newState.guild.channels.cache.find(
            ch => ch.type === ChannelType.GuildText && ch.permissionsFor(newState.guild.members.me!)?.has('SendMessages')
          );
          const textChannelId = textChannel?.id;
          
          const voiceChannel = newState.channel as VoiceChannel;
          const result = await discordVoiceService.joinChannel(voiceChannel, textChannelId);
          if (result.success) {
            console.log(`[DiscordBot] Auto-joined voice channel "${channelName}"`);
            this.updatePresence('listening');
            
            // SPEAK a vocal greeting in the voice channel
            const greeting = `Salut ${username} ! Je suis la, pret a discuter. Parle-moi, je t'ecoute.`;
            console.log(`[DiscordBot] Speaking vocal greeting in ${channelName}`);
            await discordVoiceService.speakInChannel(guildId, greeting);
            console.log(`[DiscordBot] Vocal greeting delivered`);
          } else {
            console.error(`[DiscordBot] Failed to auto-join: ${result.error}`);
          }
          
          // Also send a text message for visibility
          if (textChannel && textChannel.type === ChannelType.GuildText) {
            await (textChannel as any).send(`Je suis la, ${username} ! Je t'ecoute dans **${channelName}**. Parle-moi !`);
          }
        } catch (error: any) {
          console.error(`[DiscordBot] Failed to auto-join: ${error.message}`);
        }
      }
    }
    
    // User left a voice channel - check if Ulysse should leave too
    if (oldState.channel && !newState.channel) {
      const guildId = oldState.guild.id;
      if (discordVoiceService.isInChannel(guildId)) {
        // Check if any non-bot users remain in the channel
        const voiceChannel = oldState.channel as VoiceChannel;
        const nonBotMembers = voiceChannel.members.filter(m => !m.user.bot);
        if (nonBotMembers.size === 0) {
          console.log('[DiscordBot] No users left in voice channel, leaving...');
          this.updatePresence('idle');
          await discordVoiceService.leaveChannel(guildId);
          
          // Notify in text channel
          const textChannel = oldState.guild.systemChannel || oldState.guild.channels.cache.find(
            ch => ch.type === ChannelType.GuildText && ch.permissionsFor(oldState.guild.members.me!)?.has('SendMessages')
          );
          if (textChannel && textChannel.type === ChannelType.GuildText) {
            await (textChannel as any).send(`J'ai quitte le salon vocal. A bientot !`);
          }
        }
      }
    }
  }

  private updatePresence(status: 'idle' | 'listening' | 'speaking'): void {
    if (!this.client?.user) return;
    
    const presenceMap = {
      'idle': { name: 'Pret a discuter', type: ActivityType.Watching },
      'listening': { name: 'En ecoute...', type: ActivityType.Listening },
      'speaking': { name: 'En train de parler', type: ActivityType.Playing }
    };
    
    const { name, type } = presenceMap[status];
    this.client.user.setActivity(name, { type });
  }

  private async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const { commandName } = interaction;
    console.log(`[DiscordBot] Slash command: /${commandName} from ${interaction.user.username}`);

    try {
      switch (commandName) {
        case 'join':
          await this.slashJoin(interaction);
          break;
        case 'leave':
          await this.slashLeave(interaction);
          break;
        case 'voice':
          await this.slashVoiceStatus(interaction);
          break;
        case 'parle':
          await this.slashParle(interaction);
          break;
        case 'voix':
          await this.slashVoix(interaction);
          break;
        case 'ulysse':
          await this.slashUlysse(interaction);
          break;
        default:
          await interaction.reply({ content: 'Commande inconnue', ephemeral: true });
      }
    } catch (error: any) {
      console.error(`[DiscordBot] Slash command error:`, error.message);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Une erreur est survenue', ephemeral: true });
      }
    }
  }

  private async slashJoin(interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.member as GuildMember;
    if (!member?.voice?.channel) {
      await interaction.reply({
        embeds: [this.createEmbed('Salon vocal requis', 'Tu dois etre dans un salon vocal pour que je te rejoigne !', Colors.Yellow)],
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply();
    const voiceChannel = member.voice.channel as VoiceChannel;
    const textChannelId = interaction.channelId;
    const result = await discordVoiceService.joinChannel(voiceChannel, textChannelId);

    if (result.success) {
      this.updatePresence('listening');
      await interaction.editReply({
        embeds: [this.createEmbed('Connecte !', `Je t'ai rejoint dans **${voiceChannel.name}**.\nParle-moi, je t'ecoute !`, Colors.Green)]
      });
      await discordVoiceService.speakInChannel(interaction.guildId!, `Salut ${member.user.username} ! Je suis pret.`);
    } else {
      await interaction.editReply({
        embeds: [this.createEmbed('Erreur', result.error || 'Impossible de rejoindre le salon', Colors.Red)]
      });
    }
  }

  private async slashLeave(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId || !discordVoiceService.isInChannel(interaction.guildId)) {
      await interaction.reply({
        embeds: [this.createEmbed('Information', 'Je ne suis pas dans un salon vocal.', Colors.Blue)],
        ephemeral: true
      });
      return;
    }

    await discordVoiceService.speakInChannel(interaction.guildId, 'A bientot !');
    await new Promise(r => setTimeout(r, 1500));
    
    const success = await discordVoiceService.leaveChannel(interaction.guildId);
    this.updatePresence('idle');
    
    await interaction.reply({
      embeds: [this.createEmbed(success ? 'Deconnecte' : 'Erreur', 
        success ? 'J\'ai quitte le salon vocal. A bientot !' : 'Erreur lors de la deconnexion',
        success ? Colors.Green : Colors.Red)]
    });
  }

  private async slashVoiceStatus(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    const sessionInfo = guildId ? discordVoiceService.getSessionInfo(guildId) : null;
    
    const embed = new EmbedBuilder()
      .setTitle('Statut Vocal Ulysse')
      .setColor(sessionInfo ? Colors.Green : Colors.Grey)
      .addFields(
        { name: 'Connexion', value: sessionInfo ? 'Connecte' : 'Non connecte', inline: true },
        { name: 'Ecoute', value: sessionInfo?.isListening ? 'Actif' : 'Inactif', inline: true },
        { name: 'Parole', value: sessionInfo?.isSpeaking ? 'En cours' : 'Aucune', inline: true }
      )
      .setFooter({ text: 'Ulysse Voice System PRO' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  private async slashParle(interaction: ChatInputCommandInteraction): Promise<void> {
    const text = interaction.options.getString('texte', true);
    
    if (!interaction.guildId || !discordVoiceService.isInChannel(interaction.guildId)) {
      await interaction.reply({
        embeds: [this.createEmbed('Non connecte', 'Je dois d\'abord rejoindre un salon vocal. Utilise `/join`', Colors.Yellow)],
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply();
    this.updatePresence('speaking');
    const success = await discordVoiceService.speakInChannel(interaction.guildId, text);
    this.updatePresence('listening');

    await interaction.editReply({
      embeds: [this.createEmbed(
        success ? 'Message vocal' : 'Erreur',
        success ? `J'ai dit: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"` : 'Impossible de parler',
        success ? Colors.Green : Colors.Red
      )]
    });
  }

  private async slashVoix(interaction: ChatInputCommandInteraction): Promise<void> {
    const voice = interaction.options.getString('voice');
    
    if (voice) {
      discordVoiceService.setConfig({ ttsVoice: voice as any });
      await interaction.reply({
        embeds: [this.createEmbed('Voix modifiee', `Ma voix est maintenant: **${voice}**`, Colors.Purple)]
      });
    } else {
      const embed = new EmbedBuilder()
        .setTitle('Options de voix')
        .setColor(Colors.Purple)
        .setDescription('Utilise `/voix voice:<option>` pour changer ma voix')
        .addFields(
          { name: 'Onyx', value: 'Voix grave et profonde', inline: true },
          { name: 'Echo', value: 'Voix naturelle', inline: true },
          { name: 'Nova', value: 'Voix claire', inline: true },
          { name: 'Fable', value: 'Voix chaude', inline: true },
          { name: 'Alloy', value: 'Voix moderne', inline: true },
          { name: 'Shimmer', value: 'Voix douce', inline: true }
        );
      await interaction.reply({ embeds: [embed] });
    }
  }

  private async slashUlysse(interaction: ChatInputCommandInteraction): Promise<void> {
    const question = interaction.options.getString('question', true);
    
    await interaction.deferReply();
    
    if (!this.ulysseHandler) {
      await interaction.editReply({
        embeds: [this.createEmbed('Patience', 'Je suis en cours d\'initialisation...', Colors.Yellow)]
      });
      return;
    }

    // ============== HEARING HUB INTEGRATION ==============
    const hearingInput: HearingInput = {
      content: question,
      metadata: {
        source: "discord_text",
        type: "command",
        timestamp: Date.now(),
        userId: 1,
        persona: "ulysse",
        discordContext: {
          guildId: interaction.guildId || "DM",
          channelId: interaction.channelId,
          memberId: interaction.user.id,
          memberName: interaction.user.username
        }
      }
    };

    const hearingResult = await hearingHub.hear(hearingInput);
    
    // ============== BRAIN HUB - CHEF D'ORCHESTRE ==============
    let slashBrainDecision: any = null;
    try {
      const brainResult = await brainHub.processInput({
        content: hearingResult.resolvedContent,
        source: 'discord_text',
        userId: 1,
        persona: 'ulysse',
        isVoice: false,
        metadata: {
          ...hearingInput.metadata.discordContext,
          discordUserId: interaction.user.id,
          discordUsername: interaction.user.username,
          domain: hearingResult.domain
        }
      });
      slashBrainDecision = brainResult.decision;
      console.log(`[DiscordBot] Slash BrainHub decision: ${brainResult.decision.action} (${(brainResult.decision.confidence * 100).toFixed(0)}%), domain: ${brainResult.decision.domain || 'generic'}`);
      
      if (brainResult.decision.action === 'wait' && brainResult.decision.confidence > 0.8) {
        await interaction.editReply('Un moment, je réfléchis...');
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (brainError) {
      console.error(`[DiscordBot] Slash BrainHub error (fallback):`, brainError);
    }
    
    const response = await this.ulysseHandler(hearingResult.resolvedContent, interaction.user.id);
    
    // Track output through VoiceOutputHub with domain context
    const slashDomain = slashBrainDecision?.domain || hearingResult.domain || 'generic';
    await voiceOutputHub.output({
      content: response,
      metadata: {
        destination: "discord_text",
        type: "text",
        timestamp: Date.now(),
        userId: 1,
        persona: "ulysse",
        requestId: `slash-ulysse-${interaction.id}`,
        domain: slashDomain,
        kpiTag: `discord_${slashDomain}`
      }
    });
    
    // Create response embed
    const embed = new EmbedBuilder()
      .setTitle('Ulysse')
      .setColor(Colors.Blue)
      .setDescription(response.length > 4000 ? response.substring(0, 3997) + '...' : response)
      .setFooter({ text: `Question de ${interaction.user.username}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    
    // If user is in voice channel with bot, also speak the response
    if (interaction.guildId && discordVoiceService.isInChannel(interaction.guildId)) {
      const member = interaction.member as GuildMember;
      if (member?.voice?.channel) {
        const voiceResponse = response.length > 500 ? response.substring(0, 497) + '...' : response;
        
        // Track voice output
        await voiceOutputHub.output({
          content: voiceResponse,
          metadata: {
            destination: "discord_voice",
            type: "voice",
            timestamp: Date.now(),
            userId: 1,
            persona: "ulysse",
            requestId: `slash-ulysse-voice-${interaction.id}`
          }
        });
        
        await discordVoiceService.speakInChannel(interaction.guildId, voiceResponse);
      }
    }
  }

  private createEmbed(title: string, description: string, color: number): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color)
      .setTimestamp();
  }

  private async handleMessage(message: Message): Promise<void> {
    // Prevent duplicate processing of the same message
    const messageId = message.id;
    if (this.processedMessages.has(messageId)) {
      console.log(`[DiscordBot] Skipping duplicate message: ${messageId}`);
      return;
    }
    this.processedMessages.add(messageId);
    
    // Debug: Log all received messages
    console.log(`[DiscordBot] Message received: "${message.content}" from ${message.author.username} in ${message.channel.type === ChannelType.DM ? 'DM' : `#${(message.channel as any).name || 'unknown'}`}`);
    
    // Ignore bot messages to prevent loops
    if (message.author.bot) return;

    let content = message.content.trim();

    // ============ DISCORD VOICE MESSAGE SUPPORT ============
    // Voice messages arrive with empty content but an ogg audio attachment
    if (!content) {
      const voiceAttachment = message.attachments.find(att =>
        (att.contentType?.startsWith("audio/") || att.url.endsWith(".ogg")) &&
        (message.flags.has(MessageFlags.IsVoiceMessage) || att.duration !== null)
      );

      if (voiceAttachment) {
        try {
          console.log(`[DiscordBot] Voice message detected from ${message.author.username} (${voiceAttachment.duration?.toFixed(1)}s)`);
          if ('sendTyping' in message.channel) await (message.channel as any).sendTyping();

          const audioRes = await fetch(voiceAttachment.url);
          if (!audioRes.ok) throw new Error(`Download failed: ${audioRes.status}`);
          const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

          const transcribed = await speechToText(audioBuffer, "fr", voiceAttachment.contentType || "audio/ogg");
          if (!transcribed || !transcribed.trim()) {
            await (message.channel as any).send("*(Message vocal reçu mais incompréhensible — réessaie !)*");
            return;
          }

          console.log(`[DiscordBot] Voice message transcribed: "${transcribed}"`);
          content = transcribed.trim();

          if ('sendTyping' in message.channel) await (message.channel as any).sendTyping();
        } catch (err: any) {
          console.error("[DiscordBot] Failed to transcribe voice message:", err.message);
          await (message.channel as any).send("*(Impossible de transcrire ton message vocal — erreur technique)*");
          return;
        }
      } else {
        return;
      }
    }

    // Check for voice commands first
    const lowerContent = content.toLowerCase();
    
    // !join, !appel, !call - Join user's voice channel
    if (lowerContent === '!join' || lowerContent === '!appel' || lowerContent === '!call' || lowerContent === '!rejoins') {
      await this.handleJoinVoice(message);
      return;
    }
    
    // !leave, !quitte, !bye - Leave voice channel
    if (lowerContent === '!leave' || lowerContent === '!quitte' || lowerContent === '!bye') {
      await this.handleLeaveVoice(message);
      return;
    }
    
    // !parle <text>, !dis <text>, !say <text> - Speak in voice channel
    if (lowerContent.startsWith('!parle ') || lowerContent.startsWith('!dis ') || lowerContent.startsWith('!say ')) {
      const textToSpeak = content.substring(content.indexOf(' ') + 1);
      await this.handleSpeak(message, textToSpeak);
      return;
    }
    
    // !voice, !vocal - Voice status
    if (lowerContent === '!voice' || lowerContent === '!vocal') {
      await this.handleVoiceStatus(message);
      return;
    }

    // Private Discord server: respond to ALL messages from Maurice
    console.log(`[DiscordBot] Message from ${message.author.username}: "${content}"`);

    try {
      if ('sendTyping' in message.channel) {
        await (message.channel as any).sendTyping();
      }

      // ============== HEARING HUB INTEGRATION ==============
      // Route Discord text input through unified sensory system
      const hearingInput: HearingInput = {
        content,
        metadata: {
          source: "discord_text",
          type: "text",
          timestamp: Date.now(),
          userId: 1, // Owner by default for Discord
          persona: "ulysse",
          discordContext: {
            guildId: message.guild?.id || "DM",
            channelId: message.channel.id,
            memberId: message.author.id,
            memberName: message.author.username
          }
        }
      };

      // Process through HearingHub for unified tracking & context enrichment
      const hearingResult = await hearingHub.hear(hearingInput);
      console.log(`[DiscordBot] HearingHub processed: intent=${hearingResult.intent?.domain || 'none'}`);
      
      // ============== BRAIN HUB - CHEF D'ORCHESTRE ==============
      let msgBrainDecision: any = null;
      try {
        const brainResult = await brainHub.processInput({
          content: hearingResult.resolvedContent,
          source: 'discord_text',
          userId: 1,
          persona: 'ulysse',
          isVoice: false,
          metadata: {
            ...hearingInput.metadata.discordContext,
            discordUserId: message.author.id,
            discordUsername: message.author.username,
            domain: hearingResult.domain
          }
        });
        msgBrainDecision = brainResult.decision;
        console.log(`[DiscordBot] BrainHub decision: ${brainResult.decision.action} (${(brainResult.decision.confidence * 100).toFixed(0)}%), domain: ${brainResult.decision.domain || 'generic'}`);
        
        if (brainResult.decision.action === 'wait' && brainResult.decision.confidence > 0.8) {
          await message.channel.send('Un moment, je réfléchis...');
          await new Promise(r => setTimeout(r, 1000));
        }
      } catch (brainError) {
        console.error(`[DiscordBot] BrainHub error (fallback to default):`, brainError);
      }

      if (this.ulysseHandler) {
        // Use resolved content (with reference resolution applied)
        const response = await this.ulysseHandler(hearingResult.resolvedContent, message.author.id);
        
        // Track output through VoiceOutputHub with domain context
        const msgDomain = msgBrainDecision?.domain || hearingResult.domain || 'generic';
        await voiceOutputHub.output({
          content: response,
          metadata: {
            destination: "discord_text",
            type: "text",
            timestamp: Date.now(),
            userId: 1,
            persona: "ulysse",
            requestId: `discord-${message.id}`,
            domain: msgDomain,
            kpiTag: `discord_${msgDomain}`,
            discordContext: hearingInput.metadata.discordContext
          }
        });
        
        if (response.length > 2000) {
          const chunks = this.splitMessage(response, 2000);
          for (const chunk of chunks) {
            await message.reply(chunk);
          }
        } else {
          await message.reply(response);
        }
        
        console.log(`[DiscordBot] Replied to ${message.author.username}`);
        
        // If user is in a voice channel with the bot, ALSO speak the response
        if (message.guild) {
          const guildId = message.guild.id;
          const member = message.member as GuildMember;
          if (member?.voice?.channel && discordVoiceService.isInChannel(guildId)) {
            console.log(`[DiscordBot] User is in voice channel, also speaking response`);
            // Speak the response (limit to 500 chars for voice to avoid long TTS)
            const voiceResponse = response.length > 500 ? response.substring(0, 497) + '...' : response;
            
            // Track voice output through VoiceOutputHub
            await voiceOutputHub.output({
              content: voiceResponse,
              metadata: {
                destination: "discord_voice",
                type: "voice",
                timestamp: Date.now(),
                userId: 1,
                persona: "ulysse",
                requestId: `discord-voice-${message.id}`,
                domain: msgDomain,
                kpiTag: `discord_voice_${msgDomain}`
              }
            });
            
            try {
              await discordVoiceService.speakInChannel(guildId, voiceResponse);
              console.log(`[DiscordBot] Spoke response in voice channel`);
            } catch (voiceError: any) {
              console.error(`[DiscordBot] Failed to speak:`, voiceError.message);
            }
          }
        }
      } else {
        await message.reply('Je suis en cours d\'initialisation, réessaie dans quelques secondes.');
      }
    } catch (error: any) {
      console.error('[DiscordBot] Error handling message:', error.message);
      await message.reply('Désolé, une erreur s\'est produite. Réessaie dans un moment.');
    }
  }

  private async handleJoinVoice(message: Message): Promise<void> {
    try {
      // Check if voice is supported
      if (!discordVoiceService.isVoiceSupported()) {
        await message.reply('La fonction vocale n\'est pas disponible (OPENAI_API_KEY requis pour TTS/STT).');
        return;
      }

      // Get the user's current voice channel
      const member = message.member as GuildMember;
      if (!member?.voice?.channel) {
        await message.reply('Tu dois etre dans un salon vocal pour que je te rejoigne !');
        return;
      }

      const voiceChannel = member.voice.channel as VoiceChannel;
      console.log(`[DiscordBot] Joining voice channel: ${voiceChannel.name}`);

      const textChannelId = message.channel.id;
      const result = await discordVoiceService.joinChannel(voiceChannel, textChannelId);
      
      if (result.success) {
        await message.reply(`Je suis dans **${voiceChannel.name}** ! Parle-moi, je t'ecoute.`);
        
        // Say hello in voice
        setTimeout(async () => {
          await discordVoiceService.speakInChannel(
            message.guild!.id,
            "Salut Maurice ! Je suis pret a discuter. Dis-moi ce que tu veux."
          );
        }, 1000);
      } else {
        await message.reply(`Impossible de rejoindre le salon: ${result.error}`);
      }
    } catch (error: any) {
      console.error('[DiscordBot] Join voice error:', error.message);
      await message.reply('Erreur lors de la connexion au salon vocal.');
    }
  }

  private async handleLeaveVoice(message: Message): Promise<void> {
    try {
      if (!message.guild) {
        await message.reply('Cette commande ne fonctionne que sur un serveur.');
        return;
      }

      const guildId = message.guild.id;
      
      if (!discordVoiceService.isInChannel(guildId)) {
        await message.reply('Je ne suis dans aucun salon vocal.');
        return;
      }

      // Say goodbye before leaving
      await discordVoiceService.speakInChannel(guildId, "A plus tard Maurice !");
      
      // Wait a bit for the message to play
      await new Promise(resolve => setTimeout(resolve, 2000));

      const success = await discordVoiceService.leaveChannel(guildId);
      
      if (success) {
        await message.reply('J\'ai quitte le salon vocal.');
      } else {
        await message.reply('Erreur en quittant le salon.');
      }
    } catch (error: any) {
      console.error('[DiscordBot] Leave voice error:', error.message);
      await message.reply('Erreur lors de la deconnexion.');
    }
  }

  private async handleSpeak(message: Message, text: string): Promise<void> {
    try {
      if (!message.guild) {
        await message.reply('Cette commande ne fonctionne que sur un serveur.');
        return;
      }

      const guildId = message.guild.id;
      
      if (!discordVoiceService.isInChannel(guildId)) {
        await message.reply('Je ne suis dans aucun salon vocal. Utilise `!join` d\'abord.');
        return;
      }

      if (!text || text.trim().length === 0) {
        await message.reply('Dis-moi ce que tu veux que je dise : `!parle Bonjour tout le monde`');
        return;
      }

      // Acknowledge the speak command
      await message.reply(`Je dis: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
      
      const success = await discordVoiceService.speakInChannel(guildId, text);
      
      if (!success) {
        await message.reply('Impossible de parler dans le salon vocal.');
      }
    } catch (error: any) {
      console.error('[DiscordBot] Speak error:', error.message);
      await message.reply('Erreur lors de la synthese vocale.');
    }
  }

  private async handleVoiceStatus(message: Message): Promise<void> {
    try {
      if (!message.guild) {
        await message.reply('Cette commande ne fonctionne que sur un serveur.');
        return;
      }

      const guildId = message.guild.id;
      const sessionInfo = discordVoiceService.getSessionInfo(guildId);
      const voiceSupported = discordVoiceService.isVoiceSupported();

      let statusMessage = '**Statut Vocal Ulysse**\n';
      statusMessage += `- Support TTS/STT: ${voiceSupported ? 'Actif' : 'Non disponible'}\n`;
      
      if (sessionInfo) {
        const channel = await this.client?.channels.fetch(sessionInfo.channelId) as VoiceChannel;
        statusMessage += `- Salon actuel: **${channel?.name || 'Inconnu'}**\n`;
        statusMessage += `- Etat: ${sessionInfo.isListening ? 'Ecoute' : sessionInfo.isSpeaking ? 'Parle' : 'Inactif'}\n`;
      } else {
        statusMessage += '- Salon actuel: Aucun\n';
      }

      statusMessage += '\n**Commandes:**\n';
      statusMessage += '- `!join` / `!appel` - Rejoindre ton salon vocal\n';
      statusMessage += '- `!leave` / `!quitte` - Quitter le salon\n';
      statusMessage += '- `!parle <texte>` - Me faire parler\n';

      await message.reply(statusMessage);
    } catch (error: any) {
      console.error('[DiscordBot] Voice status error:', error.message);
      await message.reply('Erreur lors de la recuperation du statut.');
    }
  }

  private splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      let splitIndex = remaining.lastIndexOf('\n', maxLength);
      if (splitIndex === -1 || splitIndex < maxLength / 2) {
        splitIndex = remaining.lastIndexOf(' ', maxLength);
      }
      if (splitIndex === -1 || splitIndex < maxLength / 2) {
        splitIndex = maxLength;
      }

      chunks.push(remaining.substring(0, splitIndex));
      remaining = remaining.substring(splitIndex).trim();
    }

    return chunks;
  }

  isReady(): boolean {
    return this.isConnected && this.client !== null;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.destroy();
      this.isConnected = false;
      console.log('[DiscordBot] Disconnected');
    }
  }

  getBotUsername(): string | null {
    return this.client?.user?.username || null;
  }

  async sendMessage(channelId: string, content: string): Promise<boolean> {
    if (!this.isConnected || !this.client) {
      console.error('[DiscordBot] Cannot send message - not connected');
      return false;
    }

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        console.error('[DiscordBot] Channel not found or not text-based:', channelId);
        return false;
      }

      if (content.length > 2000) {
        const chunks = this.splitMessage(content, 2000);
        for (const chunk of chunks) {
          await (channel as any).send(chunk);
        }
      } else {
        await (channel as any).send(content);
      }

      console.log(`[DiscordBot] Sent message to channel ${channelId}`);
      return true;
    } catch (error: any) {
      console.error('[DiscordBot] Failed to send message:', error.message);
      return false;
    }
  }

  async getGuilds(): Promise<Array<{ id: string; name: string }>> {
    if (!this.client) return [];
    return this.client.guilds.cache.map(g => ({ id: g.id, name: g.name }));
  }

  async getChannels(guildId: string): Promise<Array<{ id: string; name: string; type: string }>> {
    if (!this.client) return [];
    try {
      const guild = await this.client.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();
      return channels
        .filter(c => c && c.isTextBased())
        .map(c => ({ id: c!.id, name: c!.name, type: c!.type.toString() }));
    } catch {
      return [];
    }
  }

  // Add reaction to a message
  async addReaction(channelId: string, messageId: string, emoji: string): Promise<boolean> {
    if (!this.isConnected || !this.client) {
      console.error('[DiscordBot] Cannot add reaction - not connected');
      return false;
    }

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        console.error('[DiscordBot] Channel not found or not text-based:', channelId);
        return false;
      }

      const message = await (channel as any).messages.fetch(messageId);
      await message.react(emoji);
      console.log(`[DiscordBot] Added reaction ${emoji} to message ${messageId}`);
      return true;
    } catch (error: any) {
      console.error('[DiscordBot] Failed to add reaction:', error.message);
      return false;
    }
  }

  // Remove reaction from a message
  async removeReaction(channelId: string, messageId: string, emoji: string): Promise<boolean> {
    if (!this.isConnected || !this.client) {
      console.error('[DiscordBot] Cannot remove reaction - not connected');
      return false;
    }

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        return false;
      }

      const message = await (channel as any).messages.fetch(messageId);
      await message.reactions.cache.get(emoji)?.users.remove(this.client.user!.id);
      console.log(`[DiscordBot] Removed reaction ${emoji} from message ${messageId}`);
      return true;
    } catch (error: any) {
      console.error('[DiscordBot] Failed to remove reaction:', error.message);
      return false;
    }
  }

  // Delete a message
  async deleteMessage(channelId: string, messageId: string): Promise<boolean> {
    if (!this.isConnected || !this.client) {
      console.error('[DiscordBot] Cannot delete message - not connected');
      return false;
    }

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        return false;
      }

      const message = await (channel as any).messages.fetch(messageId);
      await message.delete();
      console.log(`[DiscordBot] Deleted message ${messageId}`);
      return true;
    } catch (error: any) {
      console.error('[DiscordBot] Failed to delete message:', error.message);
      return false;
    }
  }

  // Send file/image to a channel
  async sendFile(channelId: string, fileUrl: string, fileName: string, content?: string): Promise<boolean> {
    if (!this.isConnected || !this.client) {
      console.error('[DiscordBot] Cannot send file - not connected');
      return false;
    }

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        return false;
      }

      // Fetch URL to buffer for discord.js v14 compatibility
      const response = await fetch(fileUrl);
      if (!response.ok) {
        console.error('[DiscordBot] Failed to fetch file URL:', response.statusText);
        return false;
      }
      
      const buffer = Buffer.from(await response.arrayBuffer());
      const attachment = new AttachmentBuilder(buffer, { name: fileName });
      
      await (channel as any).send({ 
        content: content || undefined, 
        files: [attachment] 
      });
      console.log(`[DiscordBot] Sent file ${fileName} to channel ${channelId}`);
      return true;
    } catch (error: any) {
      console.error('[DiscordBot] Failed to send file:', error.message);
      return false;
    }
  }

  // Create server invitation
  async createInvitation(channelId: string, maxAge?: number, maxUses?: number): Promise<string | null> {
    if (!this.isConnected || !this.client) {
      console.error('[DiscordBot] Cannot create invitation - not connected');
      return null;
    }

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel) {
        return null;
      }

      const invite = await (channel as any).createInvite({
        maxAge: maxAge || 86400, // Default 24 hours
        maxUses: maxUses || 0,   // 0 = unlimited
        unique: true
      });
      
      console.log(`[DiscordBot] Created invitation: ${invite.url}`);
      return invite.url;
    } catch (error: any) {
      console.error('[DiscordBot] Failed to create invitation:', error.message);
      return null;
    }
  }

  // Get voice channels
  async getVoiceChannels(guildId: string): Promise<Array<{ id: string; name: string; memberCount: number }>> {
    if (!this.client) return [];
    try {
      const guild = await this.client.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();
      return channels
        .filter(c => c && c.type === ChannelType.GuildVoice)
        .map(c => {
          const vc = c as VoiceChannel;
          return { 
            id: vc.id, 
            name: vc.name, 
            memberCount: vc.members.size 
          };
        });
    } catch {
      return [];
    }
  }

  // Get voice channel status (who's in it)
  async getVoiceChannelMembers(channelId: string): Promise<Array<{ id: string; username: string; speaking: boolean }>> {
    if (!this.isConnected || !this.client) {
      return [];
    }

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        return [];
      }

      const vc = channel as VoiceChannel;
      return vc.members.map(m => ({
        id: m.id,
        username: m.user.username,
        speaking: false // Speaking status requires voice connection receiver
      }));
    } catch (error: any) {
      console.error('[DiscordBot] Failed to get voice members:', error.message);
      return [];
    }
  }

  // Get full status including voice
  async getFullStatus(): Promise<{
    connected: boolean;
    botName: string | null;
    guilds: Array<{ id: string; name: string }>;
    voiceSupported: boolean;
  }> {
    const guilds = await this.getGuilds();
    return {
      connected: this.isConnected,
      botName: this.getBotUsername(),
      guilds,
      voiceSupported: true
    };
  }
}

export const discordBotService = new DiscordBotService();
