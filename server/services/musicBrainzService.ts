/**
 * MusicBrainz Service
 * Free music metadata API - no API key required
 * Rate limit: 1 request per second (we add delay)
 * Documentation: https://musicbrainz.org/doc/MusicBrainz_API
 */

interface MusicBrainzArtist {
  id: string;
  name: string;
  country?: string;
  'life-span'?: {
    begin?: string;
    end?: string;
    ended?: boolean;
  };
  'type'?: string;
  aliases?: { name: string; 'sort-name': string }[];
  tags?: { name: string; count: number }[];
}

interface MusicBrainzRecording {
  id: string;
  title: string;
  length?: number;
  'artist-credit'?: { artist: { id: string; name: string } }[];
  releases?: {
    id: string;
    title: string;
    date?: string;
    'release-group'?: { id: string; 'primary-type'?: string };
  }[];
  tags?: { name: string; count: number }[];
}

interface MusicBrainzRelease {
  id: string;
  title: string;
  date?: string;
  country?: string;
  'artist-credit'?: { artist: { id: string; name: string } }[];
  'release-group'?: {
    id: string;
    title: string;
    'primary-type'?: string;
    'first-release-date'?: string;
  };
}

interface MusicBrainzReleaseGroup {
  id: string;
  title: string;
  'primary-type'?: string;
  'first-release-date'?: string;
  'artist-credit'?: { artist: { id: string; name: string } }[];
}

export interface TrackMetadata {
  artist: string;
  title: string;
  album?: string;
  releaseYear?: number;
  durationMs?: number;
  musicbrainz: {
    recordingId: string;
    releaseId?: string;
    artistId?: string;
  };
  genres: string[];
}

export interface ArtistMetadata {
  name: string;
  musicbrainz: {
    artistId: string;
  };
  country?: string;
  beginDate?: string;
  genres: string[];
  aliases: string[];
  topReleases: {
    title: string;
    releaseYear?: number;
    type?: string;
    musicbrainzId: string;
  }[];
}

export interface SearchResult {
  type: 'track' | 'artist' | 'album';
  name?: string;
  artist?: string;
  title?: string;
  album?: string;
  musicbrainzId: string;
}

class MusicBrainzService {
  private baseUrl = 'https://musicbrainz.org/ws/2';
  private userAgent = 'DevFlow/2.0.0 (contact@ulysseproject.org)';
  private lastRequestTime = 0;
  private minRequestInterval = 1100; // 1.1 seconds to respect rate limit

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minRequestInterval) {
      await new Promise(resolve => setTimeout(resolve, this.minRequestInterval - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  private async fetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<T | null> {
    await this.throttle();
    
    const url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.set('fmt', 'json');
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

    try {
      const response = await fetch(url.toString(), {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        console.log(`[MusicBrainz] Error ${response.status}: ${response.statusText}`);
        return null;
      }

      return await response.json() as T;
    } catch (error) {
      console.error('[MusicBrainz] Request failed:', error);
      return null;
    }
  }

  /**
   * Search for a track by artist and title
   */
  async searchTrack(artist: string, title: string): Promise<TrackMetadata | null> {
    const query = `recording:"${title}" AND artist:"${artist}"`;
    const data = await this.fetch<{ recordings: MusicBrainzRecording[] }>('/recording', {
      query,
      limit: '5',
      inc: 'artist-credits+releases+tags',
    });

    if (!data?.recordings?.length) return null;

    const recording = data.recordings[0];
    const artistName = recording['artist-credit']?.[0]?.artist?.name || artist;
    const artistId = recording['artist-credit']?.[0]?.artist?.id;
    const release = recording.releases?.[0];
    const releaseYear = release?.date ? parseInt(release.date.split('-')[0]) : undefined;
    const genres = recording.tags?.slice(0, 5).map(t => t.name) || [];

    return {
      artist: artistName,
      title: recording.title,
      album: release?.title,
      releaseYear,
      durationMs: recording.length,
      musicbrainz: {
        recordingId: recording.id,
        releaseId: release?.id,
        artistId,
      },
      genres,
    };
  }

  /**
   * Get artist info by name
   */
  async getArtist(name: string): Promise<ArtistMetadata | null> {
    const data = await this.fetch<{ artists: MusicBrainzArtist[] }>('/artist', {
      query: `artist:"${name}"`,
      limit: '1',
      inc: 'aliases+tags',
    });

    if (!data?.artists?.length) return null;

    const artist = data.artists[0];
    const genres = artist.tags?.slice(0, 5).map(t => t.name) || [];
    const aliases = artist.aliases?.slice(0, 5).map(a => a.name) || [];

    // Get top releases
    const releases = await this.getArtistReleases(artist.id);

    return {
      name: artist.name,
      musicbrainz: {
        artistId: artist.id,
      },
      country: artist.country,
      beginDate: artist['life-span']?.begin,
      genres,
      aliases,
      topReleases: releases,
    };
  }

  /**
   * Get artist's top releases
   */
  private async getArtistReleases(artistId: string): Promise<ArtistMetadata['topReleases']> {
    const data = await this.fetch<{ 'release-groups': MusicBrainzReleaseGroup[] }>('/release-group', {
      artist: artistId,
      type: 'album|ep',
      limit: '10',
    });

    if (!data?.['release-groups']?.length) return [];

    return data['release-groups']
      .filter(rg => rg['primary-type'] === 'Album' || rg['primary-type'] === 'EP')
      .slice(0, 5)
      .map(rg => ({
        title: rg.title,
        releaseYear: rg['first-release-date'] ? parseInt(rg['first-release-date'].split('-')[0]) : undefined,
        type: rg['primary-type']?.toLowerCase(),
        musicbrainzId: rg.id,
      }));
  }

  /**
   * Generic search
   */
  async search(query: string, types: ('track' | 'artist' | 'album')[] = ['track', 'artist']): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    if (types.includes('track')) {
      const trackData = await this.fetch<{ recordings: MusicBrainzRecording[] }>('/recording', {
        query,
        limit: '5',
      });
      if (trackData?.recordings) {
        results.push(...trackData.recordings.map(r => ({
          type: 'track' as const,
          artist: r['artist-credit']?.[0]?.artist?.name,
          title: r.title,
          album: r.releases?.[0]?.title,
          musicbrainzId: r.id,
        })));
      }
    }

    if (types.includes('artist')) {
      const artistData = await this.fetch<{ artists: MusicBrainzArtist[] }>('/artist', {
        query,
        limit: '3',
      });
      if (artistData?.artists) {
        results.push(...artistData.artists.map(a => ({
          type: 'artist' as const,
          name: a.name,
          musicbrainzId: a.id,
        })));
      }
    }

    if (types.includes('album')) {
      const albumData = await this.fetch<{ 'release-groups': MusicBrainzReleaseGroup[] }>('/release-group', {
        query,
        limit: '3',
      });
      if (albumData?.['release-groups']) {
        results.push(...albumData['release-groups'].map(rg => ({
          type: 'album' as const,
          title: rg.title,
          artist: rg['artist-credit']?.[0]?.artist?.name,
          musicbrainzId: rg.id,
        })));
      }
    }

    return results;
  }

  /**
   * Get recording by MusicBrainz ID
   */
  async getRecordingById(recordingId: string): Promise<TrackMetadata | null> {
    const data = await this.fetch<MusicBrainzRecording>(`/recording/${recordingId}`, {
      inc: 'artist-credits+releases+tags',
    });

    if (!data) return null;

    const artistName = data['artist-credit']?.[0]?.artist?.name || 'Unknown';
    const artistId = data['artist-credit']?.[0]?.artist?.id;
    const release = data.releases?.[0];
    const releaseYear = release?.date ? parseInt(release.date.split('-')[0]) : undefined;
    const genres = data.tags?.slice(0, 5).map(t => t.name) || [];

    return {
      artist: artistName,
      title: data.title,
      album: release?.title,
      releaseYear,
      durationMs: data.length,
      musicbrainz: {
        recordingId: data.id,
        releaseId: release?.id,
        artistId,
      },
      genres,
    };
  }
}

export const musicBrainzService = new MusicBrainzService();
export { MusicBrainzService };
