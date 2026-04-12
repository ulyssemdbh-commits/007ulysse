export interface RestaurantConfig {
  id: string;
  slug: string;
  dbName: string;
  name: string;
  shortName: string;
  features: {
    zones: boolean;
    comments: boolean;
    itemCrud: boolean;
    translate: boolean;
    discord: boolean;
    calendar: boolean;
  };
  theme: {
    primary: string;
    colorScheme: "green" | "teal";
    pinBg: string;
    gradient: { from: string; to: string };
  };
  zoneNames?: Record<number, string>;
  zoneOrder?: number[];
  pinCode: string;
  unlockCode: string;
  email: string;
  emailSecret: string;
  emailSubjectPrefix: string;
  systemName: string;
}

export const RESTAURANTS: Record<string, RestaurantConfig> = {
  val: {
    id: "val",
    slug: "suguval",
    dbName: "mybeez_val",
    name: "Valentine",
    shortName: "V",
    features: {
      zones: true,
      comments: true,
      itemCrud: true,
      translate: true,
      discord: true,
      calendar: true,
    },
    theme: {
      primary: "amber",
      colorScheme: "green",
      pinBg: "from-amber-500 to-orange-600",
      gradient: { from: "from-amber-500/10", to: "to-orange-500/10" },
    },
    zoneNames: {
      1: "CUISINE",
      2: "SUSHI BAR",
      3: "RÉSERVE SÈCHE",
      4: "HYGIÈNE & CONSOMMABLES",
      5: "BOISSONS",
      6: "LIVRAISON & EMBALLAGES",
    },
    zoneOrder: [1, 2, 3, 4, 5, 6],
    pinCode: "2792",
    unlockCode: "102040",
    email: "sugu.gestion@gmail.com",
    emailSecret: "suguval-internal-2024",
    emailSubjectPrefix: "[SUGUVAL]",
    systemName: "Suguval",
  },
  maillane: {
    id: "maillane",
    slug: "sugumaillane",
    dbName: "mybeez_maillane",
    name: "Maillane",
    shortName: "M",
    features: {
      zones: false,
      comments: false,
      itemCrud: false,
      translate: false,
      discord: false,
      calendar: false,
    },
    theme: {
      primary: "emerald",
      colorScheme: "teal",
      pinBg: "from-emerald-500 to-teal-600",
      gradient: { from: "from-emerald-500/10", to: "to-teal-500/10" },
    },
    pinCode: "2792",
    unlockCode: "102040",
    email: "sugu.resto@gmail.com",
    emailSecret: "sugumaillane-internal-2024",
    emailSubjectPrefix: "[SUGU MAILLANE]",
    systemName: "SUGU Maillane",
  },
};

export function getBySlug(slug: string): RestaurantConfig | undefined {
  return Object.values(RESTAURANTS).find((r) => r.slug === slug);
}

export function getById(id: string): RestaurantConfig | undefined {
  return RESTAURANTS[id];
}

export function getAll(): RestaurantConfig[] {
  return Object.values(RESTAURANTS);
}
