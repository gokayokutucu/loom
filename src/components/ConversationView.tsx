import type { ReactNode } from "react";

export function ConversationView({
  emptyDraft,
  children,
  draftComposer,
  transcript,
  graph,
  composer,
}: {
  emptyDraft: boolean;
  children?: ReactNode;
  draftComposer?: ReactNode;
  transcript?: ReactNode;
  graph?: ReactNode;
  composer?: ReactNode;
}) {
  if (children) {
    return (
      <div className={emptyDraft ? "content-area empty-draft-mode" : "content-area"}>
        {children}
      </div>
    );
  }

  return (
    <div className={emptyDraft ? "content-area empty-draft-mode" : "content-area"}>
      {emptyDraft ? (
        <section className="empty-conversation-start" aria-label="New conversation">
          <div className="empty-conversation-copy">
            <span>New Loom conversation</span>
            <h1>Ask, search, or reference your AI web.</h1>
          </div>
          {draftComposer}
        </section>
      ) : (
        <>
          {graph || transcript}
          {composer}
        </>
      )}
    </div>
  );
}
