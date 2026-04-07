import { Router, Request, Response } from 'express';
import * as spotifyService from '../../services/spotifyService';

const router = Router();

function isOwner(req: Request): boolean {
  return (req as any).isOwner === true;
}

function requireOwner(req: Request, res: Response): boolean {
  if (!isOwner(req)) {
    res.status(403).json({ error: 'Owner access required for Spotify control' });
    return false;
  }
  return true;
}

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const connected = await spotifyService.isSpotifyConnected();
    res.json({ 
      connected,
      message: connected ? 'Spotify connected' : 'Spotify not connected'
    });
  } catch (error) {
    res.json({ connected: false, message: 'Spotify not configured' });
  }
});

router.get('/playback', async (_req: Request, res: Response) => {
  try {
    const state = await spotifyService.getPlaybackState();
    res.json(state || { isPlaying: false });
  } catch (error) {
    console.error('[Spotify API] Playback error:', error);
    res.status(500).json({ error: 'Failed to get playback state' });
  }
});

router.get('/devices', async (_req: Request, res: Response) => {
  try {
    const devices = await spotifyService.getAvailableDevices();
    res.json(devices);
  } catch (error) {
    console.error('[Spotify API] Devices error:', error);
    res.status(500).json({ error: 'Failed to get devices' });
  }
});

router.post('/play', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    const { deviceId, contextUri, uris, positionMs } = req.body;
    const success = await spotifyService.play({ deviceId, contextUri, uris, positionMs });
    res.json({ success });
  } catch (error) {
    console.error('[Spotify API] Play error:', error);
    res.status(500).json({ error: 'Failed to play' });
  }
});

router.post('/pause', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    const { deviceId } = req.body;
    const success = await spotifyService.pause(deviceId);
    res.json({ success });
  } catch (error) {
    console.error('[Spotify API] Pause error:', error);
    res.status(500).json({ error: 'Failed to pause' });
  }
});

router.post('/next', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    const { deviceId } = req.body;
    const success = await spotifyService.nextTrack(deviceId);
    res.json({ success });
  } catch (error) {
    console.error('[Spotify API] Next error:', error);
    res.status(500).json({ error: 'Failed to skip' });
  }
});

router.post('/previous', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    const { deviceId } = req.body;
    const success = await spotifyService.previousTrack(deviceId);
    res.json({ success });
  } catch (error) {
    console.error('[Spotify API] Previous error:', error);
    res.status(500).json({ error: 'Failed to go previous' });
  }
});

router.post('/volume', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    const { volume, deviceId } = req.body;
    if (typeof volume !== 'number') {
      return res.status(400).json({ error: 'Volume must be a number' });
    }
    const success = await spotifyService.setVolume(volume, deviceId);
    res.json({ success });
  } catch (error) {
    console.error('[Spotify API] Volume error:', error);
    res.status(500).json({ error: 'Failed to set volume' });
  }
});

router.post('/transfer', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    const { deviceId, play = true } = req.body;
    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }
    const success = await spotifyService.transferPlayback(deviceId, play);
    res.json({ success });
  } catch (error) {
    console.error('[Spotify API] Transfer error:', error);
    res.status(500).json({ error: 'Failed to transfer playback' });
  }
});

router.post('/shuffle', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    const { state, deviceId } = req.body;
    const success = await spotifyService.setShuffle(state, deviceId);
    res.json({ success });
  } catch (error) {
    console.error('[Spotify API] Shuffle error:', error);
    res.status(500).json({ error: 'Failed to toggle shuffle' });
  }
});

router.post('/repeat', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    const { state, deviceId } = req.body;
    if (!['track', 'context', 'off'].includes(state)) {
      return res.status(400).json({ error: 'Invalid repeat state' });
    }
    const success = await spotifyService.setRepeat(state, deviceId);
    res.json({ success });
  } catch (error) {
    console.error('[Spotify API] Repeat error:', error);
    res.status(500).json({ error: 'Failed to set repeat' });
  }
});

router.get('/search', async (req: Request, res: Response) => {
  try {
    const { q, types, limit } = req.query;
    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Query is required' });
    }
    type SearchType = 'track' | 'album' | 'artist' | 'playlist';
    const validTypes: SearchType[] = ['track', 'album', 'artist', 'playlist'];
    let typeArray: SearchType[] = ['track'];
    if (types && typeof types === 'string') {
      const filtered = types.split(',').filter((t): t is SearchType => validTypes.includes(t as SearchType));
      if (filtered.length > 0) {
        typeArray = filtered;
      }
    }
    const results = await spotifyService.search(q, typeArray, Number(limit) || 10);
    res.json(results);
  } catch (error) {
    console.error('[Spotify API] Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

router.get('/recently-played', async (req: Request, res: Response) => {
  try {
    const { limit } = req.query;
    const items = await spotifyService.getRecentlyPlayed(Number(limit) || 20);
    res.json(items);
  } catch (error) {
    console.error('[Spotify API] Recently played error:', error);
    res.status(500).json({ error: 'Failed to get recently played' });
  }
});

router.get('/playlists', async (req: Request, res: Response) => {
  try {
    const { limit } = req.query;
    const playlists = await spotifyService.getCurrentUserPlaylists(Number(limit) || 50);
    res.json(playlists);
  } catch (error) {
    console.error('[Spotify API] Playlists error:', error);
    res.status(500).json({ error: 'Failed to get playlists' });
  }
});

router.post('/play-playlist', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    const { playlistId, deviceId } = req.body;
    if (!playlistId) {
      return res.status(400).json({ error: 'playlistId is required' });
    }
    const success = await spotifyService.playPlaylist(playlistId, deviceId);
    res.json({ success });
  } catch (error) {
    console.error('[Spotify API] Play playlist error:', error);
    res.status(500).json({ error: 'Failed to play playlist' });
  }
});

router.post('/play-track', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    const { trackUri, deviceId } = req.body;
    if (!trackUri) {
      return res.status(400).json({ error: 'trackUri is required' });
    }
    const success = await spotifyService.playTrack(trackUri, deviceId);
    res.json({ success });
  } catch (error) {
    console.error('[Spotify API] Play track error:', error);
    res.status(500).json({ error: 'Failed to play track' });
  }
});

export default router;
