"use client";

import type {
  EveAuthorizationPart,
  EveDynamicToolPart,
  EveMessage,
  EveMessagePart,
} from "eve/react";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import { BetCard, isScorePick } from "@/app/_components/bet-card";
import { BracketCard, isBracketData } from "@/app/_components/bracket-card";
import { isLeaderboardData, LeaderboardCard } from "@/app/_components/leaderboard-card";
import { isMatchCardData, MatchCard } from "@/app/_components/match-card";
import { isMyBetsData, MyBetsCard } from "@/app/_components/my-bets-card";
import { isRoundChancesData, RoundChances } from "@/app/_components/round-chances";
import { MessageResponse } from "@/components/ai/message";
import { ReasoningStatus } from "@/components/ai/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai/tool";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Message, MessageContent } from "@/components/ui/message";
import { cn } from "@/lib/utils";

export type AgentInputResponse = {
  readonly optionId?: string;
  readonly requestId: string;
  readonly text?: string;
};

export function AgentMessage({
  canRespond,
  isStreaming,
  message,
  onInputResponses,
}: {
  readonly canRespond: boolean;
  readonly isStreaming: boolean;
  readonly message: EveMessage;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
}) {
  const lastTextIndex = message.parts.reduce(
    (last, part, index) => (part.type === "text" ? index : last),
    -1,
  );
  const answered = message.parts.some(
    (part) => part.type === "text" && part.text.trim().length > 0,
  );

  if (message.role === "user") {
    const text = message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
    return (
      <Message align="end">
        <MessageContent>
          <Bubble align="end" variant="muted">
            <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }

  const segments = buildSegments(message.parts);

  return (
    <Message align="start" className={message.metadata?.optimistic ? "opacity-70" : undefined}>
      <MessageContent>
        {segments.map((segment) =>
          segment.kind === "steps" ? (
            <StepGroup
              answered={answered}
              items={segment.items}
              key={`steps:${segment.items[0].index}`}
              streaming={isStreaming}
            />
          ) : (
            <AgentMessagePart
              canRespond={canRespond}
              key={partKey(segment.part, segment.index)}
              onInputResponses={onInputResponses}
              part={segment.part}
              showCaret={isStreaming && segment.index === lastTextIndex}
              streaming={isStreaming}
            />
          ),
        )}
      </MessageContent>
    </Message>
  );
}

type StepItem = { readonly index: number; readonly part: EveMessagePart };
type Segment =
  | { readonly kind: "steps"; readonly items: StepItem[] }
  | { readonly index: number; readonly kind: "part"; readonly part: EveMessagePart };

function isGroupableStep(part: EveMessagePart): boolean {
  if (part.type === "reasoning") return true;
  if (part.type !== "dynamic-tool") return false;
  return part.toolName !== "ask_question" && !CARD_TOOLS.has(part.toolName);
}

function buildSegments(parts: readonly EveMessagePart[]): Segment[] {
  const segments: Segment[] = [];
  let run: StepItem[] = [];
  const flush = () => {
    if (run.length === 0) return;
    if (run.some((item) => item.part.type === "dynamic-tool")) {
      segments.push({ items: run, kind: "steps" });
    } else {
      for (const item of run) segments.push({ index: item.index, kind: "part", part: item.part });
    }
    run = [];
  };
  parts.forEach((part, index) => {
    if (part.type === "step-start") return;
    if (isGroupableStep(part)) {
      run.push({ index, part });
      return;
    }
    flush();
    segments.push({ index, kind: "part", part });
  });
  flush();
  return segments;
}

function StepGroup({
  answered,
  items,
  streaming,
}: {
  readonly answered: boolean;
  readonly items: readonly StepItem[];
  readonly streaming: boolean;
}) {
  const tools: EveDynamicToolPart[] = [];
  let hasReasoning = false;
  for (const { part } of items) {
    if (part.type === "reasoning") {
      hasReasoning = true;
    } else if (part.type === "dynamic-tool") {
      tools.push(part);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {hasReasoning ? <ReasoningStatus isStreaming={streaming && !answered} /> : null}
      {tools.length > 0 ? <ToolGroup tools={tools} /> : null}
    </div>
  );
}

function ToolGroup({ tools }: { readonly tools: readonly EveDynamicToolPart[] }) {
  const first = tools[0];
  if (!first) {
    return null;
  }
  if (tools.length === 1) {
    return <ToolStep part={first} />;
  }
  const summaryState: EveDynamicToolPart["state"] = tools.some((t) => t.state === "output-error")
    ? "output-error"
    : tools.some((t) => t.state === "input-available" || t.state === "input-streaming")
      ? "input-available"
      : "output-available";
  return (
    <Collapsible className="group/tools">
      <CollapsibleTrigger className="flex items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground">
        <WrenchIcon aria-hidden className="size-3.5" />
        <span className="font-medium text-foreground/80">{first.toolName}</span>
        <ToolStatusDot state={summaryState} />
        <span className="text-muted-foreground/60">+{tools.length - 1}</span>
        <ChevronDownIcon
          aria-hidden
          className="size-3 transition-transform group-data-[state=open]/tools:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 ml-1.5 flex flex-col gap-1 border-border/60 border-l pl-3">
        {tools.map((tool) => (
          <ToolStep key={tool.toolCallId} part={tool} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolStatusDot({ state }: { readonly state: EveDynamicToolPart["state"] }) {
  const tone =
    state === "output-error"
      ? "bg-destructive"
      : state === "output-available"
        ? "bg-emerald-500"
        : "bg-muted-foreground/60";
  const live = state === "input-available" || state === "input-streaming";
  return (
    <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", tone, live && "animate-pulse")} />
  );
}

function ToolStep({ part }: { readonly part: EveDynamicToolPart }) {
  const showContent = hasInput(part.input) || part.output !== undefined || Boolean(part.errorText);
  return (
    <Collapsible className="group/tool w-full">
      <CollapsibleTrigger
        className="flex items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground disabled:pointer-events-none"
        disabled={!showContent}
      >
        <WrenchIcon aria-hidden className="size-3.5" />
        <span className="font-medium text-foreground/80">{part.toolName}</span>
        <ToolStatusDot state={part.state} />
        {showContent ? (
          <ChevronDownIcon
            aria-hidden
            className="size-3 transition-transform group-data-[state=open]/tool:rotate-180"
          />
        ) : null}
      </CollapsibleTrigger>
      {showContent ? (
        <CollapsibleContent className="mt-2 space-y-2 pl-5">
          {hasInput(part.input) ? <ToolInput input={part.input} /> : null}
          <ToolOutput errorText={part.errorText} output={part.output} />
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

function AgentMessagePart({
  canRespond,
  onInputResponses,
  part,
  showCaret,
  streaming,
}: {
  readonly canRespond: boolean;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly part: EveMessagePart;
  readonly showCaret: boolean;
  readonly streaming: boolean;
}) {
  switch (part.type) {
    case "step-start":
      return null;
    case "text":
      return (
        <MessageResponse caret="block" isAnimating={showCaret}>
          {part.text}
        </MessageResponse>
      );
    case "reasoning":
      return <ReasoningStatus isStreaming={streaming && part.state === "streaming"} />;
    case "authorization":
      return <AuthorizationPrompt part={part} />;
    case "dynamic-tool": {
      const inputRequest = part.toolMetadata?.eve?.inputRequest;
      if (part.toolName === "ask_question" && inputRequest && isScorePick(inputRequest.options)) {
        return (
          <BetCard
            onPick={(optionId) =>
              onInputResponses([{ optionId, requestId: inputRequest.requestId }])
            }
            options={inputRequest.options}
            prompt={inputRequest.prompt}
            responded={part.toolMetadata?.eve?.inputResponse?.optionId}
          />
        );
      }
      const card = renderToolCard(part);
      if (card !== undefined) {
        return card;
      }
      return (
        <Tool
          defaultOpen={part.state === "approval-requested" || part.state === "approval-responded"}
        >
          <ToolHeader
            state={part.state}
            title={part.toolName}
            toolName={part.toolName}
            type="dynamic-tool"
          />
          <ToolContent>
            {hasInput(part.input) ? <ToolInput input={part.input} /> : null}
            <InputRequestActions
              canRespond={canRespond}
              part={part}
              onInputResponses={onInputResponses}
            />
            <ToolOutput errorText={part.errorText} output={part.output} />
          </ToolContent>
        </Tool>
      );
    }
  }
}

function hasInput(input: unknown): boolean {
  return Boolean(input && typeof input === "object" && Object.keys(input as object).length > 0);
}

const CARD_TOOLS = new Set([
  "show_match_card",
  "show_round_chances",
  "show_bracket",
  "my_bets",
  "leaderboard",
]);

function renderToolCard(part: EveDynamicToolPart) {
  if (!CARD_TOOLS.has(part.toolName)) {
    return undefined;
  }
  if (part.state !== "output-available") {
    return part.state === "input-streaming" || part.state === "input-available" ? (
      <div className="h-24 w-full max-w-md animate-pulse rounded-2xl border bg-card" />
    ) : undefined;
  }
  if (part.toolName === "show_match_card" && isMatchCardData(part.output)) {
    return <MatchCard data={part.output} />;
  }
  if (part.toolName === "show_round_chances" && isRoundChancesData(part.output)) {
    return <RoundChances data={part.output} />;
  }
  if (part.toolName === "show_bracket" && isBracketData(part.output)) {
    return <BracketCard data={part.output} />;
  }
  if (part.toolName === "my_bets" && isMyBetsData(part.output)) {
    return <MyBetsCard data={part.output} />;
  }
  if (part.toolName === "leaderboard" && isLeaderboardData(part.output)) {
    return <LeaderboardCard data={part.output} />;
  }
  return undefined;
}

function AuthorizationPrompt({ part }: { readonly part: EveAuthorizationPart }) {
  const isAuthorized = part.state === "completed" && part.outcome === "authorized";
  const isCompleted = part.state === "completed";
  const Icon = isAuthorized ? CheckCircleIcon : isCompleted ? XCircleIcon : KeyRoundIcon;
  const instructions = part.authorization?.instructions;
  const shouldShowInstructions = instructions !== undefined && instructions !== part.description;

  return (
    <div
      className={cn(
        "space-y-3 rounded-md border p-3",
        isAuthorized
          ? "border-emerald-500/30 bg-emerald-500/5"
          : isCompleted
            ? "border-destructive/30 bg-destructive/5"
            : "border-blue-500/30 bg-blue-500/5",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
            isAuthorized
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : isCompleted
                ? "bg-destructive/10 text-destructive"
                : "bg-blue-500/10 text-blue-700 dark:text-blue-300",
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-medium text-sm">{authorizationTitle(part)}</p>
          <p className="text-muted-foreground text-sm">{authorizationDescription(part)}</p>
          {shouldShowInstructions ? (
            <p className="text-muted-foreground text-sm">{instructions}</p>
          ) : null}
          {part.state === "required" && part.authorization?.userCode ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Code</span>
              <code className="rounded-md bg-background px-2 py-1 font-mono">
                {part.authorization.userCode}
              </code>
            </div>
          ) : null}
          {part.state === "required" && part.authorization?.url ? (
            <Button asChild size="sm">
              <a href={part.authorization.url} rel="noreferrer" target="_blank">
                <ExternalLinkIcon className="size-4" />
                Sign in with {part.displayName}
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function authorizationTitle(part: EveAuthorizationPart): string {
  if (part.state === "required") {
    return `Connect ${part.displayName}`;
  }
  if (part.outcome === "authorized") {
    return `${part.displayName} connected`;
  }
  return `${part.displayName} authorization ${formatAuthorizationOutcome(part.outcome)}`;
}

function authorizationDescription(part: EveAuthorizationPart): string {
  if (part.state === "required") {
    return part.description;
  }
  if (part.outcome === "authorized") {
    return `${part.displayName} connected.`;
  }
  const tail = part.reason !== undefined ? ` (${part.reason})` : "";
  return `${part.displayName} authorization ${formatAuthorizationOutcome(part.outcome)}${tail}.`;
}

function formatAuthorizationOutcome(outcome: NonNullable<EveAuthorizationPart["outcome"]>): string {
  switch (outcome) {
    case "authorized":
      return "authorized";
    case "declined":
      return "declined";
    case "failed":
      return "failed";
    case "timed-out":
      return "timed out";
  }
}

function InputRequestActions({
  canRespond,
  onInputResponses,
  part,
}: {
  readonly canRespond: boolean;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly part: EveDynamicToolPart;
}) {
  const inputRequest = part.toolMetadata?.eve?.inputRequest;
  if (!inputRequest) {
    return null;
  }

  const inputResponse = part.toolMetadata?.eve?.inputResponse;
  const selectedOption = inputRequest.options?.find(
    (option) => option.id === inputResponse?.optionId,
  );

  return (
    <div className="space-y-3 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3">
      <p className="text-muted-foreground text-sm">{inputRequest.prompt}</p>
      {inputResponse ? (
        <p className="font-medium text-sm">
          Responded: {selectedOption?.label ?? inputResponse.text ?? inputResponse.optionId}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {inputRequest.options?.map((option) => (
            <Button
              disabled={!canRespond}
              key={option.id}
              onClick={() => {
                void onInputResponses([
                  {
                    optionId: option.id,
                    requestId: inputRequest.requestId,
                  },
                ]);
              }}
              size="sm"
              type="button"
              variant={option.style === "danger" ? "destructive" : "default"}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function partKey(part: EveMessagePart, index: number): string {
  switch (part.type) {
    case "authorization":
      return `authorization:${part.turnId}:${part.stepIndex}:${part.name}`;
    case "dynamic-tool":
      return part.toolCallId;
    default:
      return `${part.type}:${index}`;
  }
}
