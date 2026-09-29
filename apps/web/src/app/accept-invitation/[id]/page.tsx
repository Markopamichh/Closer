import { AcceptInvitation } from "./accept-invitation";

export default async function AcceptInvitationPage({
  params,
}: PageProps<"/accept-invitation/[id]">) {
  const { id } = await params;
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm">
        <AcceptInvitation invitationId={id} />
      </div>
    </main>
  );
}
