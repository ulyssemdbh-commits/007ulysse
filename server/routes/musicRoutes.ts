/**
 * Music API Routes
 * Combines MusicBrainz (metadata) + Spotify (playback)
 * Design based on Ulysse's mini API spec
 */

import { Router } from 'express';
import { musicBrainzService } from '../services/musicBrainzService';
import * as spotify from '../services/spotifyService';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// METADATA (MusicBrainz) - /api/music/meta/*
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/music/meta/track
 * Search for a track by artist and title
 * Query params: artist, title
 */
router.get('/meta/track', async (req, res) => {
  const { artist, title } = req.query;
  
  if (!artist || !title) {
    return res.status(400).json({ error: 'Missing artist or title parameter' });
  }

  try {
    // Get metadata from MusicBrainz
    const metadata = await musicBrainzService.searchTrack(
      artist as string,
      title as string
    );

    if (!metadata) {
      return res.status(404).json({ error: 'Track not found' });
    }

    // Enrich with Spotify data
    const spotifyData = await spotify.search(
      `track:${title} artist:${artist}`,
      ['track'],
      1
    );
    
    const spotifyTrack = spotifyData?.tracks?.items?.[0];
    
    const response = {
      ...metadata,
      spotify: spotifyTrack ? {
        trackId: `spotify:track:${spotifyTrack.id}`,
        previewUrl: spotifyTrack.preview_url,
        externalUrl: spotifyTrack.external_urls?.spotify,
        imageUrl: spotifyTrack.album?.images?.[0]?.url,
      } : null,
    };

    res.json(response);
  } catch (error) {
    console.error('[Music API] /meta/track error:', error);
    res.status(500).json({ error: 'Failed to fetch track metadata' });
  }
});

/**
 * GET /api/music/meta/artist
 * Get artist info
 * Query params: name
 */
router.get('/meta/artist', async (req, res) => {
  const { name } = req.query;
  
  if (!name) {
    return res.status(400).json({ error: 'Missing name parameter' });
  }

  try {
    const artistInfo = await musicBrainzService.getArtist(name as string);

    if (!artistInfo) {
      return res.status(404).json({ error: 'Artist not found' });
    }

    res.json(artistInfo);
  } catch (error) {
    console.error('[Music API] /meta/artist error:', error);
    res.status(500).json({ error: 'Failed to fetch artist info' });
  }
});

/**
 * GET /api/music/meta/search
 * Generic search
 * Query params: q, type (track,artist,album)
 */
router.get('/meta/search', async (req, res) => {
  const { q, type } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: 'Missing q (query) parameter' });
  }

  const types = type 
    ? (type as string).split(',').filter(t => ['track', 'artist', 'album'].includes(t)) as ('track' | 'artist' | 'album')[]
    : ['track', 'artist'];

  try {
    const results = await musicBrainzService.search(q as string, types);
    res.json({ query: q, results });
  } catch (error) {
    console.error('[Music API] /meta/search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ═══════════════════════════════════════════════════════════════
// PLAYER (Spotify) - /api/music/player/*
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/music/player/status
 * Check if Spotify is connected
 */
router.get('/player/status', async (_req, res) => {
  try {
    const connected = await spotify.isSpotifyConnected();
    res.json({ connected });
  } catch (error) {
    res.json({ connected: false });
  }
});

/**
 * GET /api/music/player/now-playing
 * Get currently playing track
 */
router.get('/player/now-playing', async (_req, res) => {
  try {
    const state = await spotify.getPlaybackState();
    
    if (!state) {
      return res.json({ isPlaying: false });
    }

    // Get devices
    const devices = await spotify.getAvailableDevices();
    const activeDevice = devices.find(d => d.isActive);

    res.json({
      isPlaying: state.isPlaying,
      device: activeDevice ? {
        name: activeDevice.name,
        type: activeDevice.type,
        volume: activeDevice.volumePercent,
      } : null,
      track: state.trackName ? {
        artist: state.artistName,
        title: state.trackName,
        album: state.albumName,
        durationMs: state.durationMs,
        progressMs: state.progressMs,
        imageUrl: state.albumArt,
      } : null,
      shuffle: state.shuffleState,
      repeat: state.repeatState,
    });
  } catch (error) {
    console.error('[Music API] /player/now-playing error:', error);
    res.status(500).json({ error: 'Failed to get playback state' });
  }
});

/**
 * GET /api/music/player/devices
 * Get available Spotify devices
 */
router.get('/player/devices', async (_req, res) => {
  try {
    const devices = await spotify.getAvailableDevices();
    res.json({ devices });
  } catch (error) {
    console.error('[Music API] /player/devices error:', error);
    res.status(500).json({ error: 'Failed to get devices' });
  }
});

/**
 * POST /api/music/player/play-track
 * Play a specific track
 * Body: { spotifyId: "spotify:track:xxx" }
 */
router.post('/player/play-track', async (req, res) => {
  const { spotifyId, deviceId } = req.body;
  
  if (!spotifyId) {
    return res.status(400).json({ error: 'Missing spotifyId' });
  }

  try {
    const trackUri = spotifyId.startsWith('spotify:track:') 
      ? spotifyId 
      : `spotify:track:${spotifyId}`;
    
    const success = await spotify.playTrack(trackUri, deviceId);
    res.json({ status: success ? 'ok' : 'error' });
  } catch (error) {
    console.error('[Music API] /player/play-track error:', error);
    res.status(500).json({ error: 'Failed to play track' });
  }
});

/**
 * POST /api/music/player/play-context
 * Play an album or playlist
 * Body: { type: "album" | "playlist", spotifyId: "xxx" }
 */
router.post('/player/play-context', async (req, res) => {
  const { type, spotifyId, deviceId } = req.body;
  
  if (!type || !spotifyId) {
    return res.status(400).json({ error: 'Missing type or spotifyId' });
  }

  try {
    let success = false;
    if (type === 'album') {
      success = await spotify.playAlbum(spotifyId, deviceId);
    } else if (type === 'playlist') {
      success = await spotify.playPlaylist(spotifyId, deviceId);
    } else if (type === 'artist') {
      success = await spotify.playArtist(spotifyId, deviceId);
    }
    
    res.json({ status: success ? 'ok' : 'error' });
  } catch (error) {
    console.error('[Music API] /player/play-context error:', error);
    res.status(500).json({ error: 'Failed to play context' });
  }
});

/**
 * POST /api/music/player/pause
 */
router.post('/player/pause', async (_req, res) => {
  try {
    const success = await spotify.pause();
    res.json({ status: success ? 'ok' : 'error' });
  } catch (error) {
    console.error('[Music API] /player/pause error:', error);
    res.status(500).json({ error: 'Failed to pause' });
  }
});

/**
 * POST /api/music/player/resume
 */
router.post('/player/resume', async (req, res) => {
  try {
    const success = await spotify.play({ deviceId: req.body?.deviceId });
    res.json({ status: success ? 'ok' : 'error' });
  } catch (error) {
    console.error('[Music API] /player/resume error:', error);
    res.status(500).json({ error: 'Failed to resume' });
  }
});

/**
 * POST /api/music/player/next
 */
router.post('/player/next', async (_req, res) => {
  try {
    const success = await spotify.nextTrack();
    res.json({ status: success ? 'ok' : 'error' });
  } catch (error) {
    console.error('[Music API] /player/next error:', error);
    res.status(500).json({ error: 'Failed to skip' });
  }
});

/**
 * POST /api/music/player/previous
 */
router.post('/player/previous', async (_req, res) => {
  try {
    const success = await spotify.previousTrack();
    res.json({ status: success ? 'ok' : 'error' });
  } catch (error) {
    console.error('[Music API] /player/previous error:', error);
    res.status(500).json({ error: 'Failed to go previous' });
  }
});

/**
 * POST /api/music/player/volume
 * Body: { volume: 0-100 }
 */
router.post('/player/volume', async (req, res) => {
  const { volume, deviceId } = req.body;
  
  if (volume === undefined || typeof volume !== 'number') {
    return res.status(400).json({ error: 'Missing or invalid volume parameter' });
  }

  try {
    const success = await spotify.setVolume(volume, deviceId);
    res.json({ status: success ? 'ok' : 'error' });
  } catch (error) {
    console.error('[Music API] /player/volume error:', error);
    res.status(500).json({ error: 'Failed to set volume' });
  }
});

/**
 * POST /api/music/player/shuffle
 * Body: { state: true/false }
 */
router.post('/player/shuffle', async (req, res) => {
  const { state, deviceId } = req.body;
  
  if (state === undefined) {
    return res.status(400).json({ error: 'Missing state parameter' });
  }

  try {
    const success = await spotify.setShuffle(!!state, deviceId);
    res.json({ status: success ? 'ok' : 'error' });
  } catch (error) {
    console.error('[Music API] /player/shuffle error:', error);
    res.status(500).json({ error: 'Failed to toggle shuffle' });
  }
});

/**
 * POST /api/music/player/repeat
 * Body: { state: "track" | "context" | "off" }
 */
router.post('/player/repeat', async (req, res) => {
  const { state, deviceId } = req.body;
  
  if (!state || !['track', 'context', 'off'].includes(state)) {
    return res.status(400).json({ error: 'Invalid state - must be track, context, or off' });
  }

  try {
    const success = await spotify.setRepeat(state, deviceId);
    res.json({ status: success ? 'ok' : 'error' });
  } catch (error) {
    console.error('[Music API] /player/repeat error:', error);
    res.status(500).json({ error: 'Failed to set repeat mode' });
  }
});

/**
 * POST /api/music/player/transfer
 * Transfer playback to a different device
 * Body: { deviceId: "xxx", play?: boolean }
 */
router.post('/player/transfer', async (req, res) => {
  const { deviceId, play } = req.body;
  
  if (!deviceId) {
    return res.status(400).json({ error: 'Missing deviceId' });
  }

  try {
    const success = await spotify.transferPlayback(deviceId, play !== false);
    res.json({ status: success ? 'ok' : 'error' });
  } catch (error) {
    console.error('[Music API] /player/transfer error:', error);
    res.status(500).json({ error: 'Failed to transfer playback' });
  }
});

// ═══════════════════════════════════════════════════════════════
// STATS - /api/music/stats/*
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/music/stats/recently-played
 * Get recently played tracks
 */
router.get('/stats/recently-played', async (req, res) => {
  const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
  
  try {
    const tracks = await spotify.getRecentlyPlayed(limit);
    res.json({
      tracks: tracks.map((item: any) => ({
        playedAt: item.played_at,
        artist: item.track.artists?.map((a: any) => a.name).join(', '),
        title: item.track.name,
        album: item.track.album?.name,
        spotifyId: `spotify:track:${item.track.id}`,
        imageUrl: item.track.album?.images?.[0]?.url,
      })),
    });
  } catch (error) {
    console.error('[Music API] /stats/recently-played error:', error);
    res.status(500).json({ error: 'Failed to get recently played' });
  }
});

/**
 * GET /api/music/stats/playlists
 * Get user's playlists
 */
router.get('/stats/playlists', async (req, res) => {
  const limit = Math.min(50, parseInt(req.query.limit as string) || 50);
  
  try {
    const playlists = await spotify.getCurrentUserPlaylists(limit);
    res.json({
      playlists: playlists.map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        owner: p.owner?.display_name,
        trackCount: p.tracks?.total,
        imageUrl: p.images?.[0]?.url,
        spotifyId: `spotify:playlist:${p.id}`,
        externalUrl: p.external_urls?.spotify,
      })),
    });
  } catch (error) {
    console.error('[Music API] /stats/playlists error:', error);
    res.status(500).json({ error: 'Failed to get playlists' });
  }
});

/**
 * GET /api/music/search
 * Unified search across Spotify
 */
router.get('/search', async (req, res) => {
  const { q, type, limit } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: 'Missing q (query) parameter' });
  }

  const searchTypes = type 
    ? (type as string).split(',').filter(t => ['track', 'album', 'artist', 'playlist'].includes(t)) as ('track' | 'album' | 'artist' | 'playlist')[]
    : ['track'];
  
  const searchLimit = Math.min(50, parseInt(limit as string) || 10);

  try {
    const results = await spotify.search(q as string, searchTypes, searchLimit);
    
    if (!results) {
      return res.status(500).json({ error: 'Search failed' });
    }

    res.json({
      query: q,
      tracks: results.tracks?.items?.map((t: any) => ({
        spotifyId: `spotify:track:${t.id}`,
        artist: t.artists?.map((a: any) => a.name).join(', '),
        title: t.name,
        album: t.album?.name,
        imageUrl: t.album?.images?.[0]?.url,
        previewUrl: t.preview_url,
        externalUrl: t.external_urls?.spotify,
      })) || [],
      albums: results.albums?.items?.map((a: any) => ({
        spotifyId: `spotify:album:${a.id}`,
        name: a.name,
        artist: a.artists?.map((ar: any) => ar.name).join(', '),
        imageUrl: a.images?.[0]?.url,
        releaseDate: a.release_date,
        totalTracks: a.total_tracks,
      })) || [],
      artists: results.artists?.items?.map((a: any) => ({
        spotifyId: `spotify:artist:${a.id}`,
        name: a.name,
        genres: a.genres,
        imageUrl: a.images?.[0]?.url,
        followers: a.followers?.total,
      })) || [],
      playlists: results.playlists?.items?.map((p: any) => ({
        spotifyId: `spotify:playlist:${p.id}`,
        name: p.name,
        owner: p.owner?.display_name,
        imageUrl: p.images?.[0]?.url,
        trackCount: p.tracks?.total,
      })) || [],
    });
  } catch (error) {
    console.error('[Music API] /search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

export default router;
