import { getPersonaForSpeaker, getPersonaPromptContext, type PersonaConfig } from "../../config/personaMapping.js";

/**
 * Check if this session should play TTS audio.
 * Each session always plays its own TTS responses - the session that
 * The old priority system was suppressing TTS on chat when talking-v2
 * was registered, even though they are independent sessions.
 */
export function shouldPlayTTS(session: any): boolean {
    // Always allow TTS on the session that generated the response
    return true;
}

// Whisper hallucination patterns - garbage outputs when audio is unclear/silent
export const WHISPER_HALLUCINATIONS = [
    "sous-titres réalisés", "amara.org", "merci d'avoir regardé",
    "sous-titrage st", "sous-titrage", "merci de vous abonner",
    "n'oubliez pas de vous abonner", "likez et abonnez", "à bientôt",
    "thank you for watching", "please subscribe", "music",
    "[musique]", "[applaudissements]", "♪", "transcrit par", "transcript by",
    "sous titres", "merci d'avoir regardé cette vidéo",
    "sous-titres", "copyright", "tous droits réservés"
];

export function isWhisperHallucination(text: string): boolean {
    const normalized = text.toLowerCase().trim();
    if (normalized.length < 3) return true; // Too short to be meaningful
    return WHISPER_HALLUCINATIONS.some(pattern => normalized.includes(pattern));
}

export function isEcho(transcript: string, lastResponse: string): boolean {
    const cleanTranscript = transcript.toLowerCase().trim().replace(/[.,!?]/g, '');
    const cleanResponse = lastResponse.toLowerCase().trim().replace(/[.,!?]/g, '');

    if (cleanResponse.includes(cleanTranscript) && cleanTranscript.length > 10) {
        return true;
    }

    const transcriptWords = cleanTranscript.split(/\s+/).filter(w => w.length > 2);
    const responseWords = cleanResponse.split(/\s+/).filter(w => w.length > 2);

    if (transcriptWords.length < 3) return false;

    const matchingWords = transcriptWords.filter(word => responseWords.includes(word));
    const similarity = matchingWords.length / transcriptWords.length;

    return similarity > 0.6;
}

export function getSystemPrompt(persona: "ulysse" | "iris", userName?: string): string {
    if (persona === "ulysse") {
        return `Tu es Ulysse, assistant IA personnel PUISSANT et AUTONOME de Maurice.

RÈGLE ABSOLUE: Ce que Maurice te dit a TOUJOURS priorité sur ta propre réflexion. Ses instructions directes écrasent tes raisonnements internes.

TES CAPACITÉS DIRECTES (tu peux les exécuter maintenant):
- GÉNÉRATION D'IMAGES: Tu PEUX générer des images avec DALL-E. Dis "Je génère l'image..." et décris ce que tu vas créer.
- Email (lecture/envoi via AgentMail)
- Fichiers (PDF/Word/Excel - lecture et génération)
- Caméra (photos/vidéos)
- Recherche web (actualités, infos, météo)
- Mémoire persistante (tu te souviens de tout)
- Spotify (lecture, contrôle, playlists)
- Domotique (lumières, scènes, appareils)
- Navigation GPS (itinéraires, lieux)
- Calendrier Google (événements, rappels)
- Homework (tâches automatisées en arrière-plan)

STYLE: Réponses ultra-courtes (2-3 phrases max), orientées action. Tu ne dis JAMAIS "je ne peux pas" - tu FAIS les choses. Parle naturellement, comme un ami proche expert.`;
    } else {
        const name = userName || "l'utilisateur";
        return `Tu es Iris, l'alter ego féminin d'Ulysse. Tu parles avec ${name} (membre approuvé de la famille).

TES CAPACITÉS DIRECTES (tu peux les exécuter maintenant):
- GÉNÉRATION D'IMAGES: Tu PEUX générer des images avec DALL-E. Dis "Je génère l'image..." et décris ce que tu vas créer.
- Email (lecture/envoi via AgentMail)
- Fichiers (PDF/Word/Excel - lecture et génération)
- Caméra (photos/vidéos)
- Recherche web (actualités, infos, météo)
- Mémoire persistante
- Spotify (lecture, contrôle, playlists)
- Domotique (lumières, scènes, appareils)
- Navigation GPS (itinéraires, lieux)
- Calendrier Google (événements, rappels)

STYLE: Réponses ultra-courtes (2-3 phrases max), chaleureuse et encourageante. Tu ne dis JAMAIS "je ne peux pas" - tu FAIS les choses. Parle naturellement, comme une amie proche experte.`;
    }
}

/**
 * Check if transcript is background noise (TV, music, etc.)
 */
export function checkBackgroundNoise(transcript: string): boolean {
    const tvNoisePatterns = [
        // === SUBTITLES & VIDEO CREDITS ===
        /sous-titr/i, /amara\.org/i, /st['']?\s*\d+/i,
        /réalisé.*partenariat/i, /assemblée nationale/i,
        /cette vidéo/i, /abonnez-vous/i, /like.*subscribe/i,
        /soustitreur\.com/i, /merci.*regard/i,
        /❤️/i, /♥/i, /traduction/i, /doublage/i,
        /communauté/i, /para la/i, /copyright/i,
        /tous droits/i, /réservés/i, /crédits/i,
        /générique/i, /fin de l'épisode/i, /prochain épisode/i,
        /publicité/i, /sponsored/i, /presented by/i,

        // === STREAMING PLATFORMS ===
        /netflix/i, /amazon/i, /prime video/i, /disney/i,
        /hulu/i, /hbo/i, /apple tv/i, /canal\+/i, /ocs/i,
        /youtube/i, /twitch/i, /tiktok/i, /reels/i,

        // === MUSIC LYRICS & SONG PATTERNS ===
        /♪/i, /♫/i, /🎵/i, /🎶/i, /\[musique\]/i, /\[music\]/i,
        /lalala/i, /nanana/i, /ooooh/i, /aaaah/i,
        /yeah yeah/i, /baby baby/i, /oh oh oh/i,
        /refrain/i, /couplet/i, /bridge/i, /outro/i,
        /feat\./i, /ft\./i, /featuring/i, /remix/i,

        // === COMMON SONG/ARTIST MENTIONS ===
        /billboard/i, /top\s*\d+/i, /hit\s*parade/i,
        /deezer/i, /spotify.*playing/i, /now playing/i,
        /album/i, /single/i, /ep\s/i, /mixtape/i,

        // === BACKGROUND CONVERSATIONS (not directed at Ulysse) ===
        /il dit que/i, /elle dit que/i, /ils disent/i,
        /tu sais pas/i, /je sais pas/i, /c'est pas vrai/i,
        /attends/i, /regarde/i, /t'as vu/i, /oh putain/i,
        /c'est ouf/i, /trop bien/i, /mdrrr/i, /ptdr/i,
        /hahaha/i, /hihi/i, /lol/i, /mdr/i,

        // === TV SHOW/MOVIE DIALOGUE PATTERNS ===
        /précédemment dans/i, /dans le prochain/i,
        /to be continued/i, /the end/i, /^fin$/i,
        /breaking news/i, /dernière heure/i, /flash info/i,
        /interview/i, /reportage/i, /documentaire/i,

        // === PODCAST/RADIO PATTERNS ===
        /bienvenue dans/i, /bienvenue sur/i, /welcome to/i,
        /aujourd'hui.*épisode/i, /merci.*écouté/i,
        /retrouvez-nous/i, /suivez-nous/i, /notre podcast/i,
        /la chronique/i, /notre invité/i, /cher.*auditeur/i,

        // === NOISE/GARBAGE ===
        /^\.+$/i, /^,+$/i, /^-+$/i, /^\.\.\.$/, /^…$/,
        /^[^\w\s]{2,}$/i, /^\s*$/
    ];

    if (tvNoisePatterns.some(p => p.test(transcript))) {
        return true;
    }

    // Check for user-directed language (if absent in long text, likely background)
    const userDirectedPatterns = [
        /ulysse/i, /maurice/i, /moe/i, /hey/i, /salut/i, /bonjour/i,
        /s'il te pla[iî]t/i, /peux-tu/i, /est-ce que tu/i, /tu peux/i,
        /génèr/i, /cherche/i, /trouve/i, /dis-moi/i, /montre/i,
        /fais/i, /crée/i, /aide/i, /j'ai besoin/i, /je veux/i, /je voudrais/i,
        /c'est quoi/i, /qu'est-ce/i, /comment/i, /pourquoi/i, /où/i, /quand/i,
        /merci/i, /ok/i, /oui/i, /non/i, /d'accord/i, /parfait/i,
        /bonne nuit/i, /au revoir/i, /à plus/i, /ciao/i, /bye/i,
        /ça va/i, /t'inquiète/i, /écoute/i, /attention/i
    ];

    // Long text without user-directed patterns = likely background conversation
    if (transcript.length > 50 && !userDirectedPatterns.some(p => p.test(transcript))) {
        return true;
    }

    return false;
}
