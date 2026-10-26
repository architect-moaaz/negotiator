import { expect, test } from "@playwright/test";

// Every public page renders, hydrates and shows no console errors.
const PAGES: [string, RegExp][] = [
  ["/", /bargain/i],
  ["/search?q=zz", /results for/i],
  ["/login", /welcome back/i],
  ["/sell", /sell|seller/i],
  ["/grievance", /make a complaint/i],
  ["/legal", /terms and policies/i],
];

for (const [path, heading] of PAGES) {
  test(`${path} renders`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && !/favicon|hmr|webpack-hmr/i.test(m.text()) && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    const res = await page.goto(path);
    expect(res?.status()).toBeLessThan(400);
    await expect(page.locator("body")).toContainText(heading);
    expect(errors).toEqual([]);
  });
}

test("security headers are set", async ({ request }) => {
  const res = await request.get("/legal");
  expect(res.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});

// Never clicks "Call me": on a preview that would phone a real number.
test("login only lets a valid mobile number ask for a code", async ({ page }) => {
  await page.goto("/login");
  const phone = page.getByRole("textbox", { name: "Mobile number" });
  const call = page.getByRole("button", { name: "Call me with a code" });
  await phone.fill("12345");
  await expect(call).toBeDisabled();
  await phone.fill("98765 43210");
  await expect(call).toBeEnabled();
});
