"use client";

import { useEveAgent } from "eve/react";
import { AlertCircleIcon } from "lucide-react";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { AgentMessage } from "./agent-message";
import { Composer } from "./composer";

const AGENT_NAME = "wc26bot";
const DESCRIPTION =
  "World Cup 2026 odds and banter, grounded in live prediction markets from Polymarket and Kalshi.";

function browserHeaders(): Record<string, string> {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return timeZone ? { "x-wc26-time-zone": timeZone } : {};
}

export function AgentChat() {
  const agent = useEveAgent({ headers: browserHeaders });
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isEmpty = agent.data.messages.length === 0;

  const send = async (text: string) => {
    await agent.send({ message: text });
  };

  const composer = (
    <Composer
      disabled={isBusy}
      onNewChat={isEmpty ? undefined : agent.reset}
      onStop={agent.stop}
      onSubmit={send}
      status={isEmpty ? undefined : agent.status}
      streaming={agent.status === "streaming"}
    />
  );

  return (
    <div className="mx-auto flex h-dvh max-w-3xl flex-col border-border border-x border-dashed bg-background text-foreground">
      {agent.error ? (
        <div className="mx-auto w-full max-w-2xl shrink-0 px-4 pt-3">
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 border-dashed bg-destructive/5 px-3 py-2.5 text-sm">
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">Request failed</p>
              <p className="mt-0.5 text-muted-foreground">{agent.error.message}</p>
            </div>
          </div>
        </div>
      ) : null}

      {isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 pb-[12vh]">
          <h1 className="font-medium font-mono text-3xl tracking-tight">{AGENT_NAME}</h1>
          <p className="mt-3 max-w-md text-balance text-center text-muted-foreground text-sm">
            {DESCRIPTION}
          </p>
          <div className="mt-10 w-full max-w-xl">{composer}</div>
        </div>
      ) : (
        <>
          <MessageScrollerProvider autoScroll>
            <MessageScroller className="min-h-0 flex-1">
              <MessageScrollerViewport>
                <MessageScrollerContent className="mx-auto w-full max-w-2xl gap-6 px-4 py-6">
                  {agent.data.messages.map((message, index) => (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor={index === agent.data.messages.length - 1}
                    >
                      <AgentMessage
                        canRespond={!isBusy}
                        isStreaming={
                          agent.status === "streaming" && index === agent.data.messages.length - 1
                        }
                        message={message}
                        onInputResponses={(inputResponses) => agent.send({ inputResponses })}
                      />
                    </MessageScrollerItem>
                  ))}
                </MessageScrollerContent>
              </MessageScrollerViewport>
            </MessageScroller>
          </MessageScrollerProvider>
          <div className="shrink-0 px-4 pt-2 pb-4">
            <div className="mx-auto w-full max-w-2xl">{composer}</div>
          </div>
        </>
      )}
    </div>
  );
}
