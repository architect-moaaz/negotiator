import { memberPhone } from "@/lib/shop/access";
import { orgsForPhone } from "@/lib/shop/orgs";
import { storesForOrg } from "@/lib/shop/stores";
import { maskPhone } from "@/lib/users";

/** The signed-in seller member: their businesses and stores. */
export async function GET(request: Request) {
  const phone = await memberPhone(request);
  if (!phone) return Response.json({ error: "Sign in with your phone number." }, { status: 401 });
  const orgs = await Promise.all(
    (await orgsForPhone(phone)).map(async (o) => ({
      ...o,
      stores: (await storesForOrg(o.id)).map(({ id, name, slug, platform, status, tier, domain }) => ({ id, name, slug, platform, status, tier, domain })),
    })),
  );
  return Response.json({ phone: maskPhone(phone), orgs }, { headers: { "Cache-Control": "no-store" } });
}
