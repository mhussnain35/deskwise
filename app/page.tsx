import ChatInterface from "@/components/chat/chat-interface";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 flex flex-col justify-between">
      <ChatInterface />
    </main>
  );
}
