import { redirect } from "next/navigation";

// The marketing landing page arrives in Week 6.
export default function HomePage() {
  redirect("/select-org");
}
