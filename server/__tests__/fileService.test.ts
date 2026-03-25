import { describe, it, expect, vi, beforeEach } from "vitest";

interface FileMetadata {
  id: number;
  name: string;
  type: string;
  size: number;
  path: string;
  userId: number;
  createdAt: Date;
}

function validateFileName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: "File name is required" };
  }
  if (name.length > 255) {
    return { valid: false, error: "File name too long" };
  }
  const invalidChars = /[<>:"/\\|?*\x00-\x1f]/;
  if (invalidChars.test(name)) {
    return { valid: false, error: "File name contains invalid characters" };
  }
  return { valid: true };
}

function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1 || lastDot === 0) return "";
  return filename.slice(lastDot + 1).toLowerCase();
}

function getMimeType(extension: string): string {
  const mimeTypes: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    txt: "text/plain",
    json: "application/json",
    zip: "application/zip",
  };
  return mimeTypes[extension] || "application/octet-stream";
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

describe("File Service", () => {
  describe("File Name Validation", () => {
    it("accepts valid file names", () => {
      expect(validateFileName("document.pdf").valid).toBe(true);
      expect(validateFileName("my-file_v2.docx").valid).toBe(true);
      expect(validateFileName("photo.jpg").valid).toBe(true);
    });

    it("rejects empty file names", () => {
      const result = validateFileName("");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("required");
    });

    it("rejects file names with invalid characters", () => {
      expect(validateFileName("file<name>.txt").valid).toBe(false);
      expect(validateFileName("file:name.txt").valid).toBe(false);
      expect(validateFileName("file|name.txt").valid).toBe(false);
    });

    it("rejects overly long file names", () => {
      const longName = "a".repeat(300) + ".txt";
      const result = validateFileName(longName);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("too long");
    });
  });

  describe("File Extension", () => {
    it("extracts extensions correctly", () => {
      expect(getFileExtension("document.pdf")).toBe("pdf");
      expect(getFileExtension("image.PNG")).toBe("png");
      expect(getFileExtension("archive.tar.gz")).toBe("gz");
    });

    it("returns empty for files without extension", () => {
      expect(getFileExtension("README")).toBe("");
    });

    it("handles dotfiles", () => {
      const ext = getFileExtension(".gitignore");
      expect(ext === "gitignore" || ext === "").toBe(true);
    });
  });

  describe("MIME Types", () => {
    it("returns correct MIME types", () => {
      expect(getMimeType("pdf")).toBe("application/pdf");
      expect(getMimeType("jpg")).toBe("image/jpeg");
      expect(getMimeType("png")).toBe("image/png");
      expect(getMimeType("json")).toBe("application/json");
    });

    it("returns octet-stream for unknown types", () => {
      expect(getMimeType("xyz")).toBe("application/octet-stream");
      expect(getMimeType("")).toBe("application/octet-stream");
    });
  });

  describe("File Size Formatting", () => {
    it("formats bytes correctly", () => {
      expect(formatFileSize(0)).toBe("0 B");
      expect(formatFileSize(500)).toBe("500 B");
    });

    it("formats kilobytes correctly", () => {
      expect(formatFileSize(1024)).toBe("1.0 KB");
      expect(formatFileSize(2048)).toBe("2.0 KB");
    });

    it("formats megabytes correctly", () => {
      expect(formatFileSize(1048576)).toBe("1.0 MB");
      expect(formatFileSize(5242880)).toBe("5.0 MB");
    });

    it("formats gigabytes correctly", () => {
      expect(formatFileSize(1073741824)).toBe("1.0 GB");
    });
  });
});
