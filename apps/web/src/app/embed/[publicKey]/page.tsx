import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WidgetChat } from "@/components/widget/widget-chat";
import { serverEnv } from "@/lib/server-env";
import { fetchWidgetConfig } from "@/lib/widget";

export const metadata: Metadata = { robots: { index: false } };

/**
 * The chat a business embeds on its site (through public/widget.js, in an iframe).
 * Public: no session. Who may frame it is decided by the CSP set in src/proxy.ts.
 */
export default async function EmbedPage({ params }: PageProps<"/embed/[publicKey]">) {
  const { publicKey } = await params;
  const config = await fetchWidgetConfig(serverEnv.API_INTERNAL_URL, publicKey);
  if (!config) notFound();
  return (
    <WidgetChat
      publicKey={publicKey}
      agentName={config.agentName}
      businessName={config.businessName}
    />
  );
}
