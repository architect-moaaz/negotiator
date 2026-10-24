import Firecrawl from "@mendable/firecrawl-js";

const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });

/** Fetch a product page as markdown for the agent to extract from. */
export async function scrapeProductPage(url: string): Promise<string> {
  const doc = await firecrawl.scrape(url, { formats: ["markdown"] });
  return doc.markdown ?? "";
}
