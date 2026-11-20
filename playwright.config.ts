import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
	testDir: "e2e",
	outputDir: "test-results",
	fullyParallel: false,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	reporter: [
		["list"],
		["html", { outputFolder: "playwright-report", open: "never" }],
	],
	use: {
		baseURL,
		trace: "on-first-retry",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chromium"] },
		},
	],
	webServer: {
		command: `npm run build && npm run start`,
		url: `${baseURL}/health`,
		env: { HOST: "127.0.0.1", PORT: String(port), LOG_DIR: ".logs/e2e" },
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
