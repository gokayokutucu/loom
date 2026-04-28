import { FileText, Globe2 } from "lucide-react";
import type { Conversation, LoomLink, ResponseItem } from "../types";

export function GraphView({
  conversations,
  responses,
  onVisit,
}: {
  conversations: Conversation[];
  responses: ResponseItem[];
  onVisit: (destination: LoomLink) => void;
}) {
  return (
    <section className="graph-view" aria-label="Graph View">
      <div className="graph-header">
        <span>Graph View</span>
        <h1>Site map for the active AI conversation web</h1>
        <p>
          Conversations, Looms, Q+A items, suggested references, and bookmarked
          links appear as navigable nodes. Browser mode remains the primary workspace.
        </p>
      </div>
      <div className="graph-canvas">
        {conversations.slice(0, 4).map((conversation, index) => (
          <button
            key={conversation.id}
            className={`graph-node conversation node-${index + 1}`}
            onClick={() =>
              onVisit({
                id: conversation.id,
                type: "conversation",
                title: conversation.title,
                path: conversation.path,
              })
            }
          >
            <Globe2 size={18} />
            <strong>{conversation.title}</strong>
            <small>Loom</small>
          </button>
        ))}
        {responses.map((response, index) => (
          <button
            key={response.id}
            className={`graph-node response response-${index + 1}`}
            onClick={() =>
              onVisit({
                id: response.id,
                type: "response",
                title: response.title,
                path: response.address,
              })
            }
          >
            <FileText size={16} />
            <strong>{response.title}</strong>
            <small>Q+A item</small>
          </button>
        ))}
        <svg className="graph-lines" aria-hidden="true">
          <path d="M170 120 C310 40 420 170 560 110" />
          <path d="M210 290 C340 210 470 250 600 210" />
          <path d="M450 130 C520 220 610 260 730 300" />
          <path d="M300 420 C420 350 560 420 690 360" />
        </svg>
      </div>
    </section>
  );
}
