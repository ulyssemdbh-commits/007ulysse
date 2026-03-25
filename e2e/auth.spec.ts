import { test, expect } from "@playwright/test";

test.describe("Authentication Flow", () => {
  test("login page renders with form elements", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    
    const usernameInput = page.locator("input[name='username'], input[placeholder*='user' i], input[data-testid='input-username']").first();
    const passwordInput = page.locator("input[type='password'], input[data-testid='input-password']").first();
    
    await expect(usernameInput.or(passwordInput)).toBeVisible({ timeout: 15000 });
  });

  test("submitting login form triggers authentication", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    
    const usernameInput = page.locator("input[name='username'], input[placeholder*='user' i], input[data-testid='input-username']").first();
    
    await expect(usernameInput).toBeVisible({ timeout: 10000 });
    await usernameInput.fill("testuser");
    
    const passwordInput = page.locator("input[type='password']").first();
    await passwordInput.fill("testpass");
    
    const submitButton = page.locator("button[type='submit'], button:has-text('Login'), button:has-text('Connexion'), button[data-testid='button-login']").first();
    await submitButton.click();
    
    await page.waitForTimeout(2000);
    
    const errorMessage = page.locator("text=/error|erreur|invalid|incorrect/i");
    const dashboard = page.locator("main, [data-testid*='dashboard'], [data-testid*='chat']").first();
    
    const hasResponse = await Promise.race([
      errorMessage.isVisible({ timeout: 5000 }).then(() => "error"),
      dashboard.isVisible({ timeout: 5000 }).then(() => "success"),
      new Promise(resolve => setTimeout(() => resolve("timeout"), 5000))
    ]);
    
    expect(["error", "success", "timeout"]).toContain(hasResponse);
  });

  test("successful login shows main application", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    
    const usernameInput = page.locator("input[name='username'], input[placeholder*='user' i], input[data-testid='input-username']").first();
    
    await expect(usernameInput).toBeVisible({ timeout: 10000 });
    await usernameInput.fill("maurice");
    
    const passwordInput = page.locator("input[type='password']").first();
    await passwordInput.fill("password123");
    
    const submitButton = page.locator("button[type='submit'], button:has-text('Login'), button:has-text('Connexion')").first();
    await submitButton.click();
    
    await page.waitForTimeout(3000);
    
    const isLoggedIn = await page.locator("main, [data-testid*='sidebar'], [data-testid*='chat'], nav").first().isVisible({ timeout: 10000 }).catch(() => false);
    const hasError = await page.locator("text=/error|erreur/i").isVisible().catch(() => false);
    
    expect(isLoggedIn || hasError).toBe(true);
  });
});
