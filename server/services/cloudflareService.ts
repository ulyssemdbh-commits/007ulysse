const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CF_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const CF_BASE = "https://api.cloudflare.com/client/v4";
const VPS_IP = process.env.HETZNER_SSH_HOST || "65.21.209.102";

interface DnsRecord {
  id: string;
  name: string;
  type: string;
  content: string;
  proxied: boolean;
  ttl: number;
  created_on?: string;
  modified_on?: string;
}

async function cfFetch(path: string, method = "GET", body?: any): Promise<any> {
  const res = await fetch(`${CF_BASE}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function findExistingRecord(name: string, type = "A"): Promise<DnsRecord | null> {
  const data = await cfFetch(`/zones/${CF_ZONE_ID}/dns_records?type=${type}&name=${name}`);
  if (data.success && data.result?.length > 0) {
    return data.result[0];
  }
  return null;
}

async function findRecordsByPattern(pattern: string): Promise<DnsRecord[]> {
  const data = await cfFetch(`/zones/${CF_ZONE_ID}/dns_records?per_page=100&name=${pattern}`);
  if (data.success && data.result) {
    return data.result;
  }
  return [];
}

async function createOrUpdateRecord(name: string, proxied = true, type = "A", content?: string): Promise<{ success: boolean; action: string; error?: string; recordId?: string }> {
  if (!CF_API_TOKEN || !CF_ZONE_ID) {
    return { success: false, action: "skip", error: "Cloudflare credentials not configured" };
  }

  const targetContent = content || VPS_IP;

  try {
    const existing = await findExistingRecord(name, type);
    if (existing) {
      if (existing.content === targetContent && existing.proxied === proxied) {
        return { success: true, action: "exists", recordId: existing.id };
      }
      const update = await cfFetch(`/zones/${CF_ZONE_ID}/dns_records/${existing.id}`, "PATCH", {
        content: targetContent,
        proxied,
      });
      return {
        success: update.success,
        action: "updated",
        recordId: existing.id,
        error: update.success ? undefined : JSON.stringify(update.errors),
      };
    }

    const create = await cfFetch(`/zones/${CF_ZONE_ID}/dns_records`, "POST", {
      type,
      name,
      content: targetContent,
      proxied,
      ttl: 1,
    });
    return {
      success: create.success,
      action: "created",
      recordId: create.result?.id,
      error: create.success ? undefined : JSON.stringify(create.errors),
    };
  } catch (err: any) {
    return { success: false, action: "error", error: err.message };
  }
}

async function deleteRecord(name: string, type = "A"): Promise<boolean> {
  const existing = await findExistingRecord(name, type);
  if (existing) {
    const del = await cfFetch(`/zones/${CF_ZONE_ID}/dns_records/${existing.id}`, "DELETE");
    return del.success;
  }
  return false;
}

export const cloudflareService = {
  isConfigured(): boolean {
    return !!(CF_API_TOKEN && CF_ZONE_ID);
  },

  async ensureDevWildcard(): Promise<{ success: boolean; action: string; error?: string }> {
    return createOrUpdateRecord("*-dev.ulyssepro.org", true);
  },

  async ensureDnsRecords(slug: string): Promise<{
    success: boolean;
    results: { domain: string; action: string; error?: string }[];
  }> {
    const prodName = `${slug}.ulyssepro.org`;
    const stagingName = `${slug}-dev.ulyssepro.org`;

    const [prodResult, stagingResult] = await Promise.all([
      createOrUpdateRecord(prodName, true),
      createOrUpdateRecord(stagingName, true),
    ]);

    const results = [
      { domain: prodName, action: prodResult.action, error: prodResult.error },
      { domain: stagingName, action: stagingResult.action, error: stagingResult.error },
    ];

    console.log(`[Cloudflare] DNS for ${slug}: prod=${prodResult.action} staging=${stagingResult.action}`);

    return {
      success: prodResult.success && stagingResult.success,
      results,
    };
  },

  async removeDnsRecords(slug: string): Promise<{ success: boolean; removed: string[] }> {
    if (!CF_API_TOKEN || !CF_ZONE_ID) {
      return { success: false, removed: [] };
    }

    const removed: string[] = [];
    const names = [
      `${slug}.ulyssepro.org`,
      `${slug}-dev.ulyssepro.org`,
    ];

    for (const name of names) {
      if (await deleteRecord(name)) removed.push(name);
    }

    return { success: true, removed };
  },

  async listProjectRecords(slug: string): Promise<DnsRecord[]> {
    if (!CF_API_TOKEN || !CF_ZONE_ID) return [];

    const records: DnsRecord[] = [];
    const names = [
      `${slug}.ulyssepro.org`,
      `${slug}-dev.ulyssepro.org`,
    ];

    for (const name of names) {
      const existing = await findExistingRecord(name);
      if (existing) records.push(existing);
    }

    return records;
  },

  async getProjectDnsStatus(slug: string): Promise<{
    configured: boolean;
    staging: { domain: string; exists: boolean; proxied: boolean; ip: string | null; recordId: string | null };
    production: { domain: string; exists: boolean; proxied: boolean; ip: string | null; recordId: string | null };
  }> {
    const prodDomain = `${slug}.ulyssepro.org`;
    const stagingDomain = `${slug}-dev.ulyssepro.org`;

    const [prodRecord, stagingRecord] = await Promise.all([
      findExistingRecord(prodDomain),
      findExistingRecord(stagingDomain),
    ]);

    return {
      configured: cloudflareService.isConfigured(),
      staging: {
        domain: stagingDomain,
        exists: !!stagingRecord,
        proxied: stagingRecord?.proxied || false,
        ip: stagingRecord?.content || null,
        recordId: stagingRecord?.id || null,
      },
      production: {
        domain: prodDomain,
        exists: !!prodRecord,
        proxied: prodRecord?.proxied || false,
        ip: prodRecord?.content || null,
        recordId: prodRecord?.id || null,
      },
    };
  },

  async setupProjectDns(slug: string, options?: {
    stagingProxied?: boolean;
    productionProxied?: boolean;
  }): Promise<{
    success: boolean;
    staging: { domain: string; action: string; error?: string };
    production: { domain: string; action: string; error?: string };
  }> {
    const prodDomain = `${slug}.ulyssepro.org`;
    const stagingDomain = `${slug}-dev.ulyssepro.org`;

    const [prodResult, stagingResult] = await Promise.all([
      createOrUpdateRecord(prodDomain, options?.productionProxied !== false),
      createOrUpdateRecord(stagingDomain, options?.stagingProxied !== false),
    ]);

    console.log(`[Cloudflare] Setup DNS for ${slug}: prod=${prodResult.action} staging=${stagingResult.action}`);

    return {
      success: prodResult.success && stagingResult.success,
      staging: { domain: stagingDomain, action: stagingResult.action, error: stagingResult.error },
      production: { domain: prodDomain, action: prodResult.action, error: prodResult.error },
    };
  },

  async toggleProxy(slug: string, environment: "staging" | "production", proxied: boolean): Promise<{ success: boolean; error?: string }> {
    const domain = environment === "staging" ? `${slug}-dev.ulyssepro.org` : `${slug}.ulyssepro.org`;
    const record = await findExistingRecord(domain);
    if (!record) return { success: false, error: `DNS record not found for ${domain}` };

    const update = await cfFetch(`/zones/${CF_ZONE_ID}/dns_records/${record.id}`, "PATCH", { proxied });
    return {
      success: update.success,
      error: update.success ? undefined : JSON.stringify(update.errors),
    };
  },

  async verifyToken(): Promise<{ success: boolean; email?: string; error?: string }> {
    if (!CF_API_TOKEN) return { success: false, error: "No API token configured" };
    try {
      const data = await cfFetch("/user/tokens/verify");
      return {
        success: data.success,
        error: data.success ? undefined : JSON.stringify(data.errors),
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  async listAllRecords(): Promise<DnsRecord[]> {
    if (!CF_API_TOKEN || !CF_ZONE_ID) return [];
    try {
      const data = await cfFetch(`/zones/${CF_ZONE_ID}/dns_records?per_page=100`);
      return data.success ? data.result || [] : [];
    } catch {
      return [];
    }
  },
};
