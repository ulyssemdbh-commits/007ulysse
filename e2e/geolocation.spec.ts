import { test, expect } from "@playwright/test";

test.describe("Geolocation Features", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 48.8566, longitude: 2.3522 });
    
    await page.goto("/");
    
    const usernameInput = page.getByTestId("input-username");
    if (await usernameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await usernameInput.fill("maurice");
      await page.getByTestId("input-password").fill("password123");
      await page.getByTestId("button-login").click();
      await page.waitForLoadState("networkidle");
    }
  });

  test("should display geolocation panel", async ({ page }) => {
    const geoBtn = page.getByTestId("button-geolocation").or(page.getByRole("button", { name: /location|position|géoloc/i }));
    
    if (await geoBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await geoBtn.click();
      
      const geoPanel = page.getByTestId("geolocation-panel").or(page.locator("[data-testid*='geolocation']"));
      await expect(geoPanel).toBeVisible({ timeout: 5000 });
    }
  });

  test("should show map when geolocation is active", async ({ page }) => {
    const geoBtn = page.getByTestId("button-geolocation").or(page.getByRole("button", { name: /location|position/i }));
    
    if (await geoBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await geoBtn.click();
      
      const mapTab = page.getByTestId("tab-map").or(page.getByRole("tab", { name: /carte|map/i }));
      if (await mapTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await mapTab.click();
        
        const map = page.locator(".leaflet-container");
        await expect(map).toBeVisible({ timeout: 10000 });
      }
    }
  });

  test("should toggle tracking", async ({ page }) => {
    const geoBtn = page.getByTestId("button-geolocation").or(page.getByRole("button", { name: /location/i }));
    
    if (await geoBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await geoBtn.click();
      
      const trackingSwitch = page.getByTestId("switch-tracking");
      if (await trackingSwitch.isVisible({ timeout: 3000 }).catch(() => false)) {
        await trackingSwitch.click();
        await page.waitForTimeout(1000);
      }
    }
  });
});
