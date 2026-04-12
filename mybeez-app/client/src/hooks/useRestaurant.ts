import { useParams } from "wouter";
import { getBySlug, type RestaurantConfig } from "@shared/restaurants";

export function useRestaurant(): RestaurantConfig {
  const params = useParams<{ tenant: string }>();
  const slug = params.tenant;
  const config = getBySlug(slug);
  if (!config) {
    throw new Error(`Unknown restaurant: ${slug}`);
  }
  return config;
}
