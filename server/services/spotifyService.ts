import { SpotifyApi } from "@spotify/web-api-ts-sdk";
import { globalOptimizerService } from "./globalOptimizerService";
import { connectorBridge } from './connectorBridge';

async function getAccessToken() {
  const conn = await connectorBridge.getSpotify();
  if (conn.source === 'none') {
    throw new Error('Spotify not configured. Set SPOTIFY_ACCESS_TOKEN, SPOTIFY_REFRESH_TOKEN, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET.');
  }

  const refreshToken = conn.refreshToken;
  const accessToken = conn.accessToken;
  const clientId = conn.clientId;
  const clientSecret = conn.clientSecret;
  
  if (!accessToken || !clientId) {
    console.error('[Spotify] Missing credentials:', { 
      hasAccessToken: !!accessToken, 
      hasClientId: !!clientId,
      hasRefreshToken: !!refreshToken 
    });
    throw new Error('Spotify not connected - missing credentials');
  }
  
  return { accessToken, clientId, refreshToken, expiresIn };
}

export async function getSpotifyClient(): Promise<SpotifyApi> {
  // Always fetch fresh tokens - never cache the client
  const { accessToken, clientId, refreshToken, expiresIn } = await getAccessToken();

  const spotify = SpotifyApi.withAccessToken(clientId, {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: expiresIn || 3600,
    refresh_token: refreshToken || "",
  });

  return spotify;
}

export async function isSpotifyConnected(): Promise<boolean> {
  try {
    await getAccessToken();
    return true;
  } catch {
    return false;
  }
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  volumePercent: number;
}

export interface SpotifyPlaybackState {
  isPlaying: boolean;
  deviceId: string | null;
  deviceName: string | null;
  trackName: string | null;
  artistName: string | null;
  albumName: string | null;
  albumArt: string | null;
  progressMs: number;
  durationMs: number;
  volumePercent: number;
  shuffleState: boolean;
  repeatState: string;
}

export async function getPlaybackState(): Promise<SpotifyPlaybackState | null> {
  try {
    const spotify = await getSpotifyClient();
    const state = await spotify.player.getPlaybackState();
    
    if (!state) return null;
    
    const track = state.item && 'album' in state.item ? state.item : null;
    
    return {
      isPlaying: state.is_playing,
      deviceId: state.device?.id || null,
      deviceName: state.device?.name || null,
      trackName: track?.name || null,
      artistName: track?.artists?.map(a => a.name).join(', ') || null,
      albumName: track?.album?.name || null,
      albumArt: track?.album?.images?.[0]?.url || null,
      progressMs: state.progress_ms || 0,
      durationMs: track?.duration_ms || 0,
      volumePercent: state.device?.volume_percent || 0,
      shuffleState: state.shuffle_state,
      repeatState: state.repeat_state,
    };
  } catch (error) {
    console.error('[Spotify] Failed to get playback state:', error);
    return null;
  }
}

export async function getAvailableDevices(): Promise<SpotifyDevice[]> {
  try {
    const spotify = await getSpotifyClient();
    const response = await spotify.player.getAvailableDevices();
    
    return response.devices.map(d => ({
      id: d.id || '',
      name: d.name,
      type: d.type,
      isActive: d.is_active,
      volumePercent: d.volume_percent || 0,
    }));
  } catch (error) {
    console.error('[Spotify] Failed to get devices:', error);
    return [];
  }
}

export async function play(options?: { deviceId?: string; contextUri?: string; uris?: string[]; positionMs?: number }): Promise<boolean> {
  try {
    const spotify = await getSpotifyClient();
    await spotify.player.startResumePlayback(
      options?.deviceId || '',
      options?.contextUri,
      options?.uris,
      undefined,
      options?.positionMs
    );
    return true;
  } catch (error) {
    console.error('[Spotify] Failed to play:', error);
    return false;
  }
}

export async function pause(deviceId?: string): Promise<boolean> {
  try {
    const spotify = await getSpotifyClient();
    await spotify.player.pausePlayback(deviceId || '');
    return true;
  } catch (error) {
    console.error('[Spotify] Failed to pause:', error);
    return false;
  }
}

export async function nextTrack(deviceId?: string): Promise<boolean> {
  try {
    const spotify = await getSpotifyClient();
    await spotify.player.skipToNext(deviceId || '');
    return true;
  } catch (error) {
    console.error('[Spotify] Failed to skip:', error);
    return false;
  }
}

export async function previousTrack(deviceId?: string): Promise<boolean> {
  try {
    const spotify = await getSpotifyClient();
    await spotify.player.skipToPrevious(deviceId || '');
    return true;
  } catch (error) {
    console.error('[Spotify] Failed to go previous:', error);
    return false;
  }
}

export async function setVolume(volumePercent: number, deviceId?: string): Promise<boolean> {
  try {
    const spotify = await getSpotifyClient();
    await spotify.player.setPlaybackVolume(Math.max(0, Math.min(100, volumePercent)), deviceId || '');
    return true;
  } catch (error) {
    console.error('[Spotify] Failed to set volume:', error);
    return false;
  }
}

export async function transferPlayback(deviceId: string, play: boolean = true): Promise<boolean> {
  try {
    const spotify = await getSpotifyClient();
    await spotify.player.transferPlayback([deviceId], play);
    return true;
  } catch (error) {
    console.error('[Spotify] Failed to transfer playback:', error);
    return false;
  }
}

export async function setShuffle(state: boolean, deviceId?: string): Promise<boolean> {
  try {
    const spotify = await getSpotifyClient();
    await spotify.player.togglePlaybackShuffle(state, deviceId || '');
    return true;
  } catch (error) {
    console.error('[Spotify] Failed to toggle shuffle:', error);
    return false;
  }
}

export async function setRepeat(state: 'track' | 'context' | 'off', deviceId?: string): Promise<boolean> {
  try {
    const spotify = await getSpotifyClient();
    await spotify.player.setRepeatMode(state, deviceId || '');
    return true;
  } catch (error) {
    console.error('[Spotify] Failed to set repeat:', error);
    return false;
  }
}

export async function search(query: string, types: ('track' | 'album' | 'artist' | 'playlist')[] = ['track'], limit: number = 10) {
  const cacheKey = `search:${query}:${types.join(',')}:${limit}`;
  
  return globalOptimizerService.getOrFetch(
    cacheKey,
    "default",
    async () => {
      try {
        const spotify = await getSpotifyClient();
        const validLimit = Math.min(50, Math.max(1, limit)) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 | 39 | 40 | 41 | 42 | 43 | 44 | 45 | 46 | 47 | 48 | 49 | 50;
        const results = await spotify.search(query, types, undefined, validLimit);
        return results;
      } catch (error) {
        console.error('[Spotify] Search failed:', error);
        return null;
      }
    },
    { customTTL: 5 * 60 * 1000 } // 5 min TTL for search results
  );
}

export async function getRecentlyPlayed(limit: number = 20) {
  try {
    const spotify = await getSpotifyClient();
    const validLimit = Math.min(50, Math.max(1, limit)) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 | 39 | 40 | 41 | 42 | 43 | 44 | 45 | 46 | 47 | 48 | 49 | 50;
    const results = await spotify.player.getRecentlyPlayedTracks(validLimit);
    return results.items;
  } catch (error) {
    console.error('[Spotify] Failed to get recently played:', error);
    return [];
  }
}

export async function getCurrentUserPlaylists(limit: number = 50) {
  try {
    const spotify = await getSpotifyClient();
    const validLimit = Math.min(50, Math.max(1, limit)) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 | 39 | 40 | 41 | 42 | 43 | 44 | 45 | 46 | 47 | 48 | 49 | 50;
    const results = await spotify.currentUser.playlists.playlists(validLimit);
    return results.items;
  } catch (error) {
    console.error('[Spotify] Failed to get playlists:', error);
    return [];
  }
}

export async function playPlaylist(playlistId: string, deviceId?: string): Promise<boolean> {
  return play({
    deviceId,
    contextUri: `spotify:playlist:${playlistId}`,
  });
}

export async function playTrack(trackUri: string, deviceId?: string): Promise<boolean> {
  return play({
    deviceId,
    uris: [trackUri],
  });
}

export async function playAlbum(albumId: string, deviceId?: string): Promise<boolean> {
  return play({
    deviceId,
    contextUri: `spotify:album:${albumId}`,
  });
}

export async function playArtist(artistId: string, deviceId?: string): Promise<boolean> {
  return play({
    deviceId,
    contextUri: `spotify:artist:${artistId}`,
  });
}
