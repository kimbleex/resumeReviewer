import { EntryGateway } from "@/components/entry-gateway";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return <EntryGateway agentChatEnabled={process.env.AGENT_CHAT_ENABLED === "true"} />;
}
