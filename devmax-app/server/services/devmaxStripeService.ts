import Stripe from "stripe";
import { db } from "../db";
import { sql } from "drizzle-orm";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || process.env.DEVMAX_STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || process.env.DEVMAX_STRIPE_WEBHOOK_SECRET;

let stripeInstance: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeInstance) {
    if (!STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not configured");
    stripeInstance = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-12-18.acacia" as any });
  }
  return stripeInstance;
}

export function isStripeConfigured(): boolean {
  return !!STRIPE_SECRET_KEY;
}

const PLAN_PRICE_MAP: Record<string, { monthly: string; yearly: string; name: string }> = {
  starter: { monthly: "price_1TE6uh82hbrADhxw29ljEZti", yearly: "price_1TE6uh82hbrADhxwGIl0jckm", name: "Starter" },
  pro: { monthly: "price_1TE6ui82hbrADhxwVfhKXOnq", yearly: "price_1TE6ui82hbrADhxwkeUQGBi0", name: "Pro" },
  enterprise: { monthly: "", yearly: "", name: "Enterprise" },
};

export function setPlanPrices(prices: Record<string, { monthly?: string; yearly?: string }>) {
  for (const [plan, p] of Object.entries(prices)) {
    if (PLAN_PRICE_MAP[plan]) {
      if (p.monthly) PLAN_PRICE_MAP[plan].monthly = p.monthly;
      if (p.yearly) PLAN_PRICE_MAP[plan].yearly = p.yearly;
    }
  }
}

export const devmaxStripeService = {
  isConfigured: isStripeConfigured,

  async createCustomer(params: {
    tenantId: string;
    email: string;
    name: string;
    metadata?: Record<string, string>;
  }): Promise<{ customerId: string }> {
    const stripe = getStripe();
    const customer = await stripe.customers.create({
      email: params.email,
      name: params.name,
      metadata: {
        tenantId: params.tenantId,
        platform: "devmax",
        ...params.metadata,
      },
    });

    await db.execute(sql`
      UPDATE devmax_tenants SET stripe_customer_id = ${customer.id}, billing_email = ${params.email}, updated_at = NOW()
      WHERE id = ${params.tenantId}
    `);

    return { customerId: customer.id };
  },

  async createCheckoutSession(params: {
    tenantId: string;
    plan: string;
    billingPeriod?: "monthly" | "yearly";
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ sessionId: string; url: string }> {
    const stripe = getStripe();
    const planConfig = PLAN_PRICE_MAP[params.plan];
    if (!planConfig) throw new Error(`Unknown plan: ${params.plan}`);

    const period = params.billingPeriod || "monthly";
    const priceId = period === "yearly" ? planConfig.yearly : planConfig.monthly;
    if (!priceId) throw new Error(`No ${period} price configured for plan ${params.plan}. Set STRIPE prices first.`);

    const [tenant] = await db.execute(sql`
      SELECT stripe_customer_id, billing_email, name FROM devmax_tenants WHERE id = ${params.tenantId}
    `).then((r: any) => r.rows || r);

    let customerId = tenant?.stripe_customer_id;
    if (!customerId && tenant) {
      const result = await this.createCustomer({
        tenantId: params.tenantId,
        email: tenant.billing_email || `tenant-${params.tenantId}@devmax.ulyssepro.org`,
        name: tenant.name || "DevMax Tenant",
      });
      customerId = result.customerId;
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: { tenantId: params.tenantId, plan: params.plan },
      subscription_data: {
        metadata: { tenantId: params.tenantId, plan: params.plan },
        trial_period_days: 14,
      },
    };

    if (customerId) {
      sessionParams.customer = customerId;
    } else {
      sessionParams.customer_email = tenant?.billing_email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return { sessionId: session.id, url: session.url || "" };
  },

  async createPortalSession(params: {
    tenantId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const stripe = getStripe();
    const [tenant] = await db.execute(sql`
      SELECT stripe_customer_id FROM devmax_tenants WHERE id = ${params.tenantId}
    `).then((r: any) => r.rows || r);

    if (!tenant?.stripe_customer_id) throw new Error("No Stripe customer found for this tenant");

    const session = await stripe.billingPortal.sessions.create({
      customer: tenant.stripe_customer_id,
      return_url: params.returnUrl,
    });

    return { url: session.url };
  },

  async handleWebhook(body: Buffer | string, signature: string): Promise<{ event: string; handled: boolean }> {
    const stripe = getStripe();
    if (!STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET not configured");

    const event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = session.metadata?.tenantId;
        const plan = session.metadata?.plan;
        if (tenantId && plan) {
          await this.activateSubscription(tenantId, plan, session.subscription as string, session.customer as string);
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const tenantId = sub.metadata?.tenantId;
        if (tenantId) {
          const status = sub.status === "active" || sub.status === "trialing" ? "active" : sub.status;
          await db.execute(sql`
            UPDATE devmax_tenants SET 
              billing_status = ${status},
              updated_at = NOW()
            WHERE id = ${tenantId}
          `);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const tenantId = sub.metadata?.tenantId;
        if (tenantId) {
          await this.deactivateSubscription(tenantId);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const [tenant] = await db.execute(sql`
          SELECT id, name, billing_email FROM devmax_tenants WHERE stripe_customer_id = ${customerId}
        `).then((r: any) => r.rows || r);
        if (tenant) {
          await db.execute(sql`
            UPDATE devmax_tenants SET billing_status = 'past_due', updated_at = NOW() WHERE id = ${tenant.id}
          `);
          const { sendDevmaxNotification } = await import("../routes/devmaxAuth");
          await sendDevmaxNotification({
            tenantId: tenant.id,
            type: "billing_failed",
            title: "Paiement echoue",
            message: `Le paiement de votre abonnement DevMax a echoue. Veuillez mettre a jour votre moyen de paiement.`,
          });
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        await db.execute(sql`
          UPDATE devmax_tenants SET billing_status = 'active', updated_at = NOW() WHERE stripe_customer_id = ${customerId}
        `);
        break;
      }

      default:
        return { event: event.type, handled: false };
    }

    return { event: event.type, handled: true };
  },

  async activateSubscription(tenantId: string, plan: string, subscriptionId: string, customerId: string) {
    const PLAN_LIMITS: Record<string, any> = {
      free: { max_projects: 3, max_users: 2, max_deploys_month: 10, max_storage_gb: 1, custom_domain: false, priority_support: false, api_access: false },
      starter: { max_projects: 10, max_users: 5, max_deploys_month: 50, max_storage_gb: 5, custom_domain: true, priority_support: false, api_access: false },
      pro: { max_projects: 50, max_users: 20, max_deploys_month: 500, max_storage_gb: 50, custom_domain: true, priority_support: true, api_access: true },
      enterprise: { max_projects: 999, max_users: 999, max_deploys_month: 9999, max_storage_gb: 500, custom_domain: true, priority_support: true, api_access: true },
    };

    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    await db.execute(sql`
      UPDATE devmax_tenants SET
        plan = ${plan},
        plan_limits = ${JSON.stringify(limits)}::jsonb,
        billing_status = 'active',
        stripe_customer_id = ${customerId},
        payment_method = 'stripe',
        updated_at = NOW()
      WHERE id = ${tenantId}
    `);

    const { sendDevmaxNotification } = await import("../routes/devmaxAuth");
    await sendDevmaxNotification({
      tenantId,
      type: "subscription_activated",
      title: `Plan ${plan.charAt(0).toUpperCase() + plan.slice(1)} active`,
      message: `Votre abonnement DevMax ${plan} est maintenant actif. Profitez de toutes les fonctionnalites!`,
    });
  },

  async deactivateSubscription(tenantId: string) {
    const PLAN_LIMITS_FREE = { max_projects: 3, max_users: 2, max_deploys_month: 10, max_storage_gb: 1, custom_domain: false, priority_support: false, api_access: false };

    await db.execute(sql`
      UPDATE devmax_tenants SET
        plan = 'free',
        plan_limits = ${JSON.stringify(PLAN_LIMITS_FREE)}::jsonb,
        billing_status = 'cancelled',
        updated_at = NOW()
      WHERE id = ${tenantId}
    `);

    const { sendDevmaxNotification } = await import("../routes/devmaxAuth");
    await sendDevmaxNotification({
      tenantId,
      type: "subscription_cancelled",
      title: "Abonnement annule",
      message: "Votre abonnement DevMax a ete annule. Vous etes revenu au plan Free.",
    });
  },

  async getSubscriptionStatus(tenantId: string): Promise<{
    plan: string;
    billingStatus: string;
    hasStripe: boolean;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
  }> {
    const [tenant] = await db.execute(sql`
      SELECT plan, billing_status, stripe_customer_id, trial_ends_at
      FROM devmax_tenants WHERE id = ${tenantId}
    `).then((r: any) => r.rows || r);

    if (!tenant) return { plan: "free", billingStatus: "none", hasStripe: false, trialEndsAt: null, currentPeriodEnd: null };

    let currentPeriodEnd = null;
    if (tenant.stripe_customer_id && STRIPE_SECRET_KEY) {
      try {
        const stripe = getStripe();
        const subs = await stripe.subscriptions.list({ customer: tenant.stripe_customer_id, limit: 1, status: "all" });
        if (subs.data.length > 0) {
          currentPeriodEnd = new Date(subs.data[0].current_period_end * 1000).toISOString();
        }
      } catch {}
    }

    return {
      plan: tenant.plan || "free",
      billingStatus: tenant.billing_status || "none",
      hasStripe: !!tenant.stripe_customer_id,
      trialEndsAt: tenant.trial_ends_at?.toISOString() || null,
      currentPeriodEnd,
    };
  },

  async listInvoices(tenantId: string): Promise<Array<{ id: string; amount: number; currency: string; status: string; date: string; pdfUrl: string | null }>> {
    const [tenant] = await db.execute(sql`
      SELECT stripe_customer_id FROM devmax_tenants WHERE id = ${tenantId}
    `).then((r: any) => r.rows || r);

    if (!tenant?.stripe_customer_id || !STRIPE_SECRET_KEY) return [];

    try {
      const stripe = getStripe();
      const invoices = await stripe.invoices.list({ customer: tenant.stripe_customer_id, limit: 20 });
      return invoices.data.map(inv => ({
        id: inv.id,
        amount: (inv.amount_paid || 0) / 100,
        currency: inv.currency,
        status: inv.status || "unknown",
        date: new Date((inv.created || 0) * 1000).toISOString(),
        pdfUrl: inv.invoice_pdf || null,
      }));
    } catch {
      return [];
    }
  },
};
