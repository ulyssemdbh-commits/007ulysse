import { describe, it, expect, vi, beforeEach } from "vitest";

interface MediaItem {
  id: number;
  userId: number;
  filename: string;
  type: "image" | "video";
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  createdAt: Date;
  tags: string[];
}

function filterByType(items: MediaItem[], type: "image" | "video" | "all"): MediaItem[] {
  if (type === "all") return items;
  return items.filter(item => item.type === type);
}

function filterByTags(items: MediaItem[], tags: string[]): MediaItem[] {
  if (tags.length === 0) return items;
  return items.filter(item => tags.some(tag => item.tags.includes(tag)));
}

function sortByDate(items: MediaItem[], ascending: boolean = false): MediaItem[] {
  return [...items].sort((a, b) => {
    const diff = a.createdAt.getTime() - b.createdAt.getTime();
    return ascending ? diff : -diff;
  });
}

function sortBySize(items: MediaItem[], ascending: boolean = true): MediaItem[] {
  return [...items].sort((a, b) => {
    const diff = a.size - b.size;
    return ascending ? diff : -diff;
  });
}

function calculateTotalSize(items: MediaItem[]): number {
  return items.reduce((sum, item) => sum + item.size, 0);
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function getAspectRatio(width: number, height: number): string {
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

describe("Media Library Service", () => {
  const mediaItems: MediaItem[] = [
    { id: 1, userId: 1, filename: "photo1.jpg", type: "image", size: 1024000, width: 1920, height: 1080, createdAt: new Date("2026-01-10"), tags: ["vacation", "beach"] },
    { id: 2, userId: 1, filename: "video1.mp4", type: "video", size: 5242880, width: 1280, height: 720, duration: 120, createdAt: new Date("2026-01-15"), tags: ["vacation"] },
    { id: 3, userId: 1, filename: "photo2.png", type: "image", size: 512000, width: 800, height: 600, createdAt: new Date("2026-01-12"), tags: ["family"] },
  ];

  describe("Type Filtering", () => {
    it("filters images only", () => {
      const images = filterByType(mediaItems, "image");
      expect(images.length).toBe(2);
      expect(images.every(i => i.type === "image")).toBe(true);
    });

    it("filters videos only", () => {
      const videos = filterByType(mediaItems, "video");
      expect(videos.length).toBe(1);
    });

    it("returns all for 'all' type", () => {
      expect(filterByType(mediaItems, "all").length).toBe(3);
    });
  });

  describe("Tag Filtering", () => {
    it("filters by single tag", () => {
      const filtered = filterByTags(mediaItems, ["beach"]);
      expect(filtered.length).toBe(1);
    });

    it("filters by multiple tags (OR)", () => {
      const filtered = filterByTags(mediaItems, ["beach", "family"]);
      expect(filtered.length).toBe(2);
    });

    it("returns all for empty tags", () => {
      expect(filterByTags(mediaItems, []).length).toBe(3);
    });
  });

  describe("Sorting", () => {
    it("sorts by date descending", () => {
      const sorted = sortByDate(mediaItems);
      expect(sorted[0].id).toBe(2);
    });

    it("sorts by date ascending", () => {
      const sorted = sortByDate(mediaItems, true);
      expect(sorted[0].id).toBe(1);
    });

    it("sorts by size ascending", () => {
      const sorted = sortBySize(mediaItems, true);
      expect(sorted[0].id).toBe(3);
    });

    it("sorts by size descending", () => {
      const sorted = sortBySize(mediaItems, false);
      expect(sorted[0].id).toBe(2);
    });
  });

  describe("Size Calculations", () => {
    it("calculates total size", () => {
      const total = calculateTotalSize(mediaItems);
      expect(total).toBe(1024000 + 5242880 + 512000);
    });

    it("formats file size", () => {
      expect(formatFileSize(0)).toBe("0 B");
      expect(formatFileSize(1024)).toBe("1.0 KB");
      expect(formatFileSize(1048576)).toBe("1.0 MB");
    });
  });

  describe("Aspect Ratio", () => {
    it("calculates aspect ratio", () => {
      expect(getAspectRatio(1920, 1080)).toBe("16:9");
      expect(getAspectRatio(1280, 720)).toBe("16:9");
      expect(getAspectRatio(800, 600)).toBe("4:3");
    });
  });

  describe("Duration Formatting", () => {
    it("formats duration correctly", () => {
      expect(formatDuration(120)).toBe("2:00");
      expect(formatDuration(65)).toBe("1:05");
      expect(formatDuration(0)).toBe("0:00");
    });
  });
});
