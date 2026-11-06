"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { ASK_KEYS, draftReply, when, type AskKey, type OrderRequest, type RequestEdits } from "@/lib/order-request";
import RqIcon from "./RqIcon";

export const ASK_LABEL: Record<AskKey, string> = { product: "Product details", qty: "Quantity", address: "Shipping address" };
const ASKED_FOR: Record<AskKey, string> = { product: "product details", qty: "quantity", address: "shipping address" };

// The reply asking the customer for what's missing: pick what to ask, edit the draft, send. Sending opens the reply in
// your mail client (the inbox connection is read-only) and marks the request as waiting on the customer. Once sent,
// shows when and what was asked, with undo.
export default function ReplyComposer({
  request: r,
  edits,
  update,
  keys,
  onToggle,
  options = ASK_KEYS,
}: {
  request: OrderRequest;
  edits: RequestEdits;
  update: (change: (e: RequestEdits) => RequestEdits) => void;
  // What the reply asks for, in ASK_KEYS order.
  keys: AskKey[];
  onToggle: (k: AskKey) => void;
  // The chips offered.
  options?: AskKey[];
}) {
  const [edited, setEdited] = useState<string | null>(null);
  const text = edited ?? draftReply(r, keys);
  const sent = edits.asked;

  const subject = /^re:/i.test(r.email.subject) ? r.email.subject : `Re: ${r.email.subject || "Your order request"}`;
  const send = () => {
    const cc = r.contact.secondary ? `&cc=${encodeURIComponent(r.contact.secondary)}` : "";
    window.location.href = `mailto:${encodeURIComponent(r.contact.primary)}?subject=${encodeURIComponent(subject)}${cc}&body=${encodeURIComponent(text)}`;
    update((e) => ({ ...e, asked: { keys, at: new Date().toISOString(), text } }));
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Reply copied");
    } catch {
      toast.error("Your browser blocked copying; select the text instead");
    }
  };

  if (sent)
    return (
      <div className="card rq-compose">
        <div className="rq-sent">
          <span className="big"><RqIcon name="send" /></span>
          <div>
            <b>Reply sent to {r.contact.primary}</b>
            <p className="muted">
              Asked for {sent.keys.map((k) => ASKED_FOR[k]).join(", ") || "more details"}. The request waits on the customer until you pick it up again.
            </p>
          </div>
          <button className="btn btn-quiet btn-sm" type="button" onClick={() => update((e) => ({ ...e, asked: undefined }))}>
            <RqIcon name="undo" />
            Undo
          </button>
        </div>
        <ol className="rq-steps rq-timeline">
          <li><span className="sd ok"><RqIcon name="check" /></span><div>Email received<small>{when(r.email.receivedAt)}</small></div></li>
          <li><span className="sd ok"><RqIcon name="check" /></span><div>Reply sent<small>{when(sent.at)}</small></div></li>
          <li><span className="sd wait" /><div>Waiting for {(r.customer ?? r.sender.name).split(/\s+/)[0]}<small>Their answer lands in the inbox like any email</small></div></li>
        </ol>
      </div>
    );

  return (
    <div className="card rq-compose">
      <div className="rq-compose-h">
        <h4 className="rq-eyebrow">Reply</h4>
        <span className="rq-faint">
          To {r.contact.primary}
          {r.contact.secondary && ` · Cc ${r.contact.secondary}`}
        </span>
      </div>
      <div className="rq-ask-chips" role="group" aria-label="What to ask for">
        {options.map((k) => (
          <button
            key={k}
            className="rq-ask-chip"
            type="button"
            aria-pressed={keys.includes(k)}
            onClick={() => {
              onToggle(k);
              setEdited(null);
            }}
          >
            <RqIcon name={keys.includes(k) ? "check" : "plus"} />
            {ASK_LABEL[k]}
          </button>
        ))}
      </div>
      <textarea
        className="textarea"
        rows={11}
        aria-label="Reply"
        placeholder="Pick at least one thing to ask for"
        value={text}
        onChange={(e) => setEdited(e.target.value)}
      />
      <div className="rq-compose-foot">
        <span className="rq-faint">
          {edited !== null ? (
            <>
              Edited by you ·{" "}
              <button className="btn btn-quiet btn-sm" type="button" onClick={() => setEdited(null)}>Reset</button>
            </>
          ) : (
            "Draft updates as you pick"
          )}
        </span>
        <div className="rq-acts">
          <button className="btn btn-secondary" type="button" disabled={!text.trim()} onClick={copy}>
            <RqIcon name="copy" />
            Copy
          </button>
          <button className="btn btn-primary" type="button" disabled={!text.trim()} onClick={send}>
            <RqIcon name="send" />
            Send reply
          </button>
        </div>
      </div>
    </div>
  );
}
