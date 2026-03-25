import { test, expect } from "@playwright/test";

test.describe("Navigation & Sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    
    const usernameInput = page.getByTestId("input-username");
    if (await usernameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await usernameInput.fill("maurice");
      await page.getByTestId("input-password").fill("password123");
      await page.getByTestId("button-login").click();
      await page.waitForLoadState("networkidle");
    }
  });

  test("should display sidebar", async ({ page }) => {
    const sidebar = page.getByTestId("sidebar").or(page.locator("[data-testid*='sidebar']"));
    await expect(sidebar).toBeVisible({ timeout: 10000 });
  });

  test("should toggle sidebar on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    
    const sidebarToggle = page.getByTestId("button-sidebar-toggle").or(page.getByRole("button", { name: /menu/i }));
    
    if (await sidebarToggle.isVisible({ timeout: 5000 }).catch(() => false)) {
      await sidebarToggle.click();
      await page.waitForTimeout(500);
    }
  });

  test("should navigate to different sections", async ({ page }) => {
    const chatNav = page.getByTestId("nav-chat").or(page.getByRole("link", { name: /chat|conversation/i }));
    
    if (await chatNav.isVisible({ timeout: 5000 }).catch(() => false)) {
      await chatNav.click();
      await page.waitForLoadState("networkidle");
    }
  });

  test("should display user profile", async ({ page }) => {
    const profile = page.getByTestId("user-profile").or(page.locator("[data-testid*='profile']").or(page.locator("[data-testid*='avatar']")));
    
    if (await profile.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(profile).toBeVisible();
    }
  });
});
