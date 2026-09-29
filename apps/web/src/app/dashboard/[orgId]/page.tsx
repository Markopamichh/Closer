import { redirect } from "next/navigation";

export default async function DashboardIndex({ params }: PageProps<"/dashboard/[orgId]">) {
  const { orgId } = await params;
  redirect(`/dashboard/${orgId}/conversations`);
}
