import Link from "next/link";
import { GrievanceForm } from "@/components/grievance-form";

export const metadata = { title: "GhostCart · Complaints and grievance officer" };

export default function GrievancePage() {
  const officer = process.env.GRIEVANCE_OFFICER_NAME;
  const email = process.env.GRIEVANCE_OFFICER_EMAIL;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-16 pt-8 sm:px-8">
      <Link href="/" className="text-xl font-bold tracking-tight">
        GhostCart
      </Link>
      <h1 className="mt-12 text-3xl font-bold tracking-tight">Make a complaint</h1>
      <p className="mt-3 text-muted">
        About an order, a seller, a payment or how we handle your data. We acknowledge every complaint within 48 hours and send you a resolution within a month.
      </p>
      <div className="mt-6 rounded-2xl border border-line p-5 text-sm">
        <p className="font-semibold">Grievance officer</p>
        {officer && email ? (
          <p className="mt-1 text-muted">
            {officer} · <a href={`mailto:${email}`} className="underline hover:text-fg">{email}</a>
          </p>
        ) : (
          <p className="mt-1 text-muted">Being appointed. Until then, complaints sent with this form go to the GhostCart team, who handle them on the same deadlines.</p>
        )}
      </div>
      <GrievanceForm />
    </main>
  );
}
