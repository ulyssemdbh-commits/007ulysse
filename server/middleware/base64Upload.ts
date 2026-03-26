import { Request, Response, NextFunction } from "express";
import multer from "multer";

export function base64ToFile(req: Request, _res: Response, next: NextFunction) {
    if (req.is("application/json") && req.body?.fileData) {
        const { fileData, fileName, mimeType, ...rest } = req.body;
        const base64Str = (fileData as string).replace(/^data:[^;]+;base64,/, "");
        const buffer = Buffer.from(base64Str, "base64");
        (req as any).file = {
            fieldname: "file",
            originalname: fileName || "upload.bin",
            encoding: "base64",
            mimetype: mimeType || "application/octet-stream",
            buffer,
            size: buffer.length,
        };
        req.body = rest;
    }
    next();
}

export function hybridUpload(opts?: multer.Options) {
    const upload = multer(opts || { storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
    const single = upload.single("file");
    return (req: Request, res: Response, next: NextFunction) => {
        if ((req as any).file) {
            return next();
        }
        if (req.is("application/json") && req.body?.fileData) {
            base64ToFile(req, res, next);
            return;
        }
        single(req, res, next);
    };
}
