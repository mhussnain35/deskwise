import ChatInterface from "@/components/chat/chat-interface";

export default function Home() {
  // The chat shell positions itself against the visible viewport, so this page
  // only needs to paint the background behind it.
  return (
    <main className="min-h-[100dvh] bg-slate-950">
      <ChatInterface />
    </main>
  );
}
