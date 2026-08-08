import { ChatLoadingScreen } from "@/components/chat/loading-screen";

/**
 * Route-level loading UI. Next.js renders this while the page segment streams,
 * so a slow network shows the same skeleton the chat itself uses during its own
 * cold start rather than a blank document.
 */
export default function Loading() {
  return <ChatLoadingScreen />;
}
