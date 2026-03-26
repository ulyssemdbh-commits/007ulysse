function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Impossible de lire le fichier"));
        reader.readAsDataURL(file);
    });
}

export async function uploadFileAsBase64(
    url: string,
    file: File,
    extraFields?: Record<string, string>
): Promise<Response> {
    const dataUrl = await fileToBase64(file);
    const payload: Record<string, any> = {
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        fileData: dataUrl,
        ...extraFields,
    };
    return fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
}
