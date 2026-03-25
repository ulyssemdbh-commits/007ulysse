import type { ChatCompletionTool } from "openai/resources/chat/completions";

// === DISCORD TOOL DEFINITIONS (8 tools) ===
export const discordToolDefs: ChatCompletionTool[] = [
    {
        type: "function",
        function: {
            name: "discord_send_message",
            description: "Envoie un message sur Discord dans un canal spécifique. EXÉCUTE IMMÉDIATEMENT sans demander confirmation.",
            parameters: {
                type: "object",
                properties: {
                    channel: { type: "string", enum: ["général", "le-sport-la-politique"], description: "Nom du canal Discord (défaut: général)" },
                    message: { type: "string", description: "Message à envoyer sur Discord" }
                },
                required: ["message"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "discord_status",
            description: "Vérifie le statut de connexion du bot Discord et liste les canaux vocaux.",
            parameters: {
                type: "object",
                properties: {}
            }
        }
    },
    {
        type: "function",
        function: {
            name: "discord_add_reaction",
            description: "Ajoute une réaction emoji à un message Discord. EXÉCUTE IMMÉDIATEMENT.",
            parameters: {
                type: "object",
                properties: {
                    channel: { type: "string", enum: ["général", "le-sport-la-politique"], description: "Nom du canal Discord" },
                    message_id: { type: "string", description: "ID du message Discord" },
                    emoji: { type: "string", description: "Emoji à ajouter (ex: 👍, ❤️, 🔥)" }
                },
                required: ["message_id", "emoji"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "discord_remove_reaction",
            description: "Retire une réaction emoji d'un message Discord. EXÉCUTE IMMÉDIATEMENT.",
            parameters: {
                type: "object",
                properties: {
                    channel: { type: "string", enum: ["général", "le-sport-la-politique"], description: "Nom du canal Discord" },
                    message_id: { type: "string", description: "ID du message Discord" },
                    emoji: { type: "string", description: "Emoji à retirer" }
                },
                required: ["message_id", "emoji"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "discord_delete_message",
            description: "Supprime un message Discord. EXÉCUTE IMMÉDIATEMENT.",
            parameters: {
                type: "object",
                properties: {
                    channel: { type: "string", enum: ["général", "le-sport-la-politique"], description: "Nom du canal Discord" },
                    message_id: { type: "string", description: "ID du message à supprimer" }
                },
                required: ["message_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "discord_send_file",
            description: "Envoie un fichier ou une image sur Discord. EXÉCUTE IMMÉDIATEMENT.",
            parameters: {
                type: "object",
                properties: {
                    channel: { type: "string", enum: ["général", "le-sport-la-politique"], description: "Nom du canal Discord" },
                    file_url: { type: "string", description: "URL du fichier ou image à envoyer" },
                    file_name: { type: "string", description: "Nom du fichier" },
                    message: { type: "string", description: "Message optionnel accompagnant le fichier" }
                },
                required: ["file_url", "file_name"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "discord_create_invitation",
            description: "Crée un lien d'invitation pour le serveur Discord. EXÉCUTE IMMÉDIATEMENT.",
            parameters: {
                type: "object",
                properties: {
                    channel: { type: "string", enum: ["général", "le-sport-la-politique"], description: "Canal pour l'invitation" },
                    max_age_hours: { type: "number", description: "Durée de validité en heures (défaut: 24)" },
                    max_uses: { type: "number", description: "Nombre max d'utilisations (0 = illimité)" }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "discord_voice_status",
            description: "Vérifie qui est dans les canaux vocaux Discord.",
            parameters: {
                type: "object",
                properties: {}
            }
        }
    },
];

// === PRIVATE HELPER ===

async function getDiscordChannelId(channelName: string): Promise<{ channelId: string; guildId: string } | null> {
    const { discordBotService } = await import("../discordBotService.js");

    if (!discordBotService.isReady()) return null;

    const guilds = await discordBotService.getGuilds();
    if (guilds.length === 0) return null;

    const channels = await discordBotService.getChannels(guilds[0].id);
    const targetName = channelName || "général";

    const channel = channels.find(c =>
        c.name === targetName ||
        c.name === targetName.replace("é", "e") ||
        c.name.toLowerCase() === targetName.toLowerCase()
    );

    if (!channel) return null;
    return { channelId: channel.id, guildId: guilds[0].id };
}

// === HANDLER FUNCTIONS ===

export async function executeDiscordSendMessage(args: { channel?: string; message: string }, userId: number): Promise<string> {
    try {
        const { discordBotService } = await import("../discordBotService.js");

        if (!discordBotService.isReady()) {
            return JSON.stringify({ error: "Bot Discord non connecté" });
        }

        const guilds = await discordBotService.getGuilds();
        if (guilds.length === 0) {
            return JSON.stringify({ error: "Bot n'est dans aucun serveur Discord" });
        }

        const channels = await discordBotService.getChannels(guilds[0].id);
        const targetChannelName = args.channel || "général";

        const channel = channels.find(c =>
            c.name === targetChannelName ||
            c.name === targetChannelName.replace("é", "e") ||
            c.name.toLowerCase() === targetChannelName.toLowerCase()
        );

        if (!channel) {
            return JSON.stringify({
                error: `Canal "${targetChannelName}" non trouvé`,
                available_channels: channels.map(c => c.name)
            });
        }

        const success = await discordBotService.sendMessage(channel.id, args.message);

        if (success) {
            console.log(`[Discord] Message envoyé dans #${channel.name}: ${args.message.substring(0, 50)}...`);
            return JSON.stringify({
                success: true,
                channel: channel.name,
                server: guilds[0].name,
                message_preview: args.message.substring(0, 100)
            });
        } else {
            return JSON.stringify({ error: "Échec de l'envoi du message" });
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
    }
}

export async function executeDiscordStatus(userId: number): Promise<string> {
    try {
        const { discordBotService } = await import("../discordBotService.js");

        const isReady = discordBotService.isReady();
        const botUsername = discordBotService.getBotUsername();
        const guilds = await discordBotService.getGuilds();

        let channels: { id: string; name: string }[] = [];
        let voiceChannels: { id: string; name: string; memberCount: number }[] = [];
        if (guilds.length > 0) {
            channels = await discordBotService.getChannels(guilds[0].id);
            voiceChannels = await discordBotService.getVoiceChannels(guilds[0].id);
        }

        return JSON.stringify({
            connected: isReady,
            botUsername,
            servers: guilds.map(g => g.name),
            textChannels: channels.map(c => c.name),
            voiceChannels: voiceChannels.map(vc => ({ name: vc.name, members: vc.memberCount }))
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
    }
}

export async function executeDiscordAddReaction(args: { channel?: string; message_id: string; emoji: string }, userId: number): Promise<string> {
    try {
        const { discordBotService } = await import("../discordBotService.js");

        const channelInfo = await getDiscordChannelId(args.channel || "général");
        if (!channelInfo) {
            return JSON.stringify({ error: "Canal Discord non trouvé ou bot non connecté" });
        }

        const success = await discordBotService.addReaction(channelInfo.channelId, args.message_id, args.emoji);

        if (success) {
            console.log(`[Discord] Réaction ${args.emoji} ajoutée au message ${args.message_id}`);
            return JSON.stringify({ success: true, emoji: args.emoji, message_id: args.message_id });
        } else {
            return JSON.stringify({ error: "Échec de l'ajout de la réaction" });
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
    }
}

export async function executeDiscordRemoveReaction(args: { channel?: string; message_id: string; emoji: string }, userId: number): Promise<string> {
    try {
        const { discordBotService } = await import("../discordBotService.js");

        const channelInfo = await getDiscordChannelId(args.channel || "général");
        if (!channelInfo) {
            return JSON.stringify({ error: "Canal Discord non trouvé ou bot non connecté" });
        }

        const success = await discordBotService.removeReaction(channelInfo.channelId, args.message_id, args.emoji);

        if (success) {
            console.log(`[Discord] Réaction ${args.emoji} retirée du message ${args.message_id}`);
            return JSON.stringify({ success: true, emoji: args.emoji, message_id: args.message_id, removed: true });
        } else {
            return JSON.stringify({ error: "Échec du retrait de la réaction" });
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
    }
}

export async function executeDiscordDeleteMessage(args: { channel?: string; message_id: string }, userId: number): Promise<string> {
    try {
        const { discordBotService } = await import("../discordBotService.js");

        const channelInfo = await getDiscordChannelId(args.channel || "général");
        if (!channelInfo) {
            return JSON.stringify({ error: "Canal Discord non trouvé ou bot non connecté" });
        }

        const success = await discordBotService.deleteMessage(channelInfo.channelId, args.message_id);

        if (success) {
            console.log(`[Discord] Message ${args.message_id} supprimé`);
            return JSON.stringify({ success: true, message_id: args.message_id, deleted: true });
        } else {
            return JSON.stringify({ error: "Échec de la suppression du message" });
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
    }
}

export async function executeDiscordSendFile(args: { channel?: string; file_url: string; file_name: string; message?: string }, userId: number): Promise<string> {
    try {
        const { discordBotService } = await import("../discordBotService.js");

        const channelInfo = await getDiscordChannelId(args.channel || "général");
        if (!channelInfo) {
            return JSON.stringify({ error: "Canal Discord non trouvé ou bot non connecté" });
        }

        const success = await discordBotService.sendFile(channelInfo.channelId, args.file_url, args.file_name, args.message);

        if (success) {
            console.log(`[Discord] Fichier ${args.file_name} envoyé`);
            return JSON.stringify({ success: true, file_name: args.file_name, sent: true });
        } else {
            return JSON.stringify({ error: "Échec de l'envoi du fichier" });
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
    }
}

export async function executeDiscordCreateInvitation(args: { channel?: string; max_age_hours?: number; max_uses?: number }, userId: number): Promise<string> {
    try {
        const { discordBotService } = await import("../discordBotService.js");

        const channelInfo = await getDiscordChannelId(args.channel || "général");
        if (!channelInfo) {
            return JSON.stringify({ error: "Canal Discord non trouvé ou bot non connecté" });
        }

        const maxAgeSeconds = (args.max_age_hours || 24) * 3600;
        const inviteUrl = await discordBotService.createInvitation(channelInfo.channelId, maxAgeSeconds, args.max_uses || 0);

        if (inviteUrl) {
            console.log(`[Discord] Invitation créée: ${inviteUrl}`);
            return JSON.stringify({
                success: true,
                invitation_url: inviteUrl,
                expires_in_hours: args.max_age_hours || 24,
                max_uses: args.max_uses || "illimité"
            });
        } else {
            return JSON.stringify({ error: "Échec de la création de l'invitation" });
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
    }
}

export async function executeDiscordVoiceStatus(userId: number): Promise<string> {
    try {
        const { discordBotService } = await import("../discordBotService.js");

        if (!discordBotService.isReady()) {
            return JSON.stringify({ error: "Bot Discord non connecté" });
        }

        const guilds = await discordBotService.getGuilds();
        if (guilds.length === 0) {
            return JSON.stringify({ error: "Bot n'est dans aucun serveur" });
        }

        const voiceChannels = await discordBotService.getVoiceChannels(guilds[0].id);

        const voiceStatus = await Promise.all(
            voiceChannels.map(async (vc) => {
                const members = await discordBotService.getVoiceChannelMembers(vc.id);
                return {
                    channel: vc.name,
                    members: members.map(m => m.username),
                    member_count: members.length
                };
            })
        );

        return JSON.stringify({
            server: guilds[0].name,
            voice_channels: voiceStatus,
            total_in_voice: voiceStatus.reduce((sum, vc) => sum + vc.member_count, 0)
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
    }
}
