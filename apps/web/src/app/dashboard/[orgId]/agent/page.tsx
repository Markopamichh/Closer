import { getTranslations } from "next-intl/server";
import { AgentConfigForm } from "@/components/agent/agent-config-form";
import { CreateAgentForm } from "@/components/agent/create-agent-form";
import { TestChat } from "@/components/agent/test-chat";
import { WidgetSettings } from "@/components/agent/widget-settings";
import { getAgents, getOrganizations } from "@/lib/api-server";

export default async function AgentPage({ params }: PageProps<"/dashboard/[orgId]/agent">) {
  const { orgId } = await params;
  const [agents, organizations, t, tNav] = await Promise.all([
    getAgents(orgId),
    getOrganizations(),
    getTranslations("agentPage"),
    getTranslations("nav.agent"),
  ]);
  // UI only: the API enforces the same rules (owners edit; owners and agents chat).
  const role = organizations.find((org) => org.id === orgId)?.role;
  // One agent per business for now; the API already supports several.
  const agent = agents[0];
  const timezones = Intl.supportedValuesOf("timeZone");
  if (agent && !timezones.includes(agent.timezone)) timezones.unshift(agent.timezone);

  return (
    <div className="grid gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{tNav("label")}</h1>
        <p className="text-sm text-muted-foreground">{tNav("description")}</p>
      </header>
      {!agent ? (
        role === "owner" ? (
          <CreateAgentForm orgId={orgId} />
        ) : (
          <p className="text-sm text-muted-foreground">{t("noAgent")}</p>
        )
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="grid gap-6">
            <AgentConfigForm
              orgId={orgId}
              agent={agent}
              canEdit={role === "owner"}
              timezones={timezones}
            />
            <WidgetSettings orgId={orgId} agent={agent} canEdit={role === "owner"} />
          </div>
          {role === "viewer" ? (
            <p className="text-sm text-muted-foreground">{t("chatReadOnly")}</p>
          ) : (
            <TestChat orgId={orgId} agentId={agent.id} agentName={agent.name} />
          )}
        </div>
      )}
    </div>
  );
}
