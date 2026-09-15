import React, { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import i18n from "./i18n";
import { MAX_PANE_TITLE_LENGTH, normalisePaneTitle } from "./paneTitleValue";

export const PaneTitleContext = createContext<{ customTitle?: string; onRename: (title: string | undefined) => void }>({ onRename: () => {} });

/** Keep title dragging intact; editing lives in the top layer, outside pane clipping. */
export function PaneTitle({ children, title, ...props }: React.HTMLAttributes<HTMLHeadingElement>): React.JSX.Element {
  const { customTitle, onRename } = useContext(PaneTitleContext);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const open = () => { setDraft(customTitle ?? ""); setEditing(true); };
  const close = () => { setEditing(false); heading.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (!editing) return;
    dialog.current?.showModal();
    input.current?.focus();
    input.current?.select();
  }, [editing]);
  // Preserve the pane type badge when showing an alias.
  const content = customTitle && React.isValidElement<{ children: React.ReactNode }>(children)
    ? React.cloneElement(children, {}, React.Children.toArray(children.props.children)[0], <span>{customTitle}</span>)
    : children;
  return <>
    <h2 {...props} ref={heading} tabIndex={0} title={[customTitle ?? title, i18n.t("deck.renamePaneHint")].filter(Boolean).join("\n")}
      aria-description={i18n.t("deck.renamePaneHint")}
      onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); open(); }}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); open(); }}
      onKeyDown={event => {
        if (event.key === "F2") { event.preventDefault(); event.stopPropagation(); open(); }
      }}>{content}</h2>
    {editing && <dialog ref={dialog} className="deck-rename-dialog" aria-labelledby={id}
      onCancel={event => { event.preventDefault(); close(); }}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); close(); }
        if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
      }} onKeyUp={event => event.stopPropagation()} onKeyPress={event => event.stopPropagation()}>
      <form onSubmit={event => { event.preventDefault(); onRename(normalisePaneTitle(draft)); close(); }}>
        <label id={id} htmlFor={id + "-input"}>{i18n.t("deck.renamePane")}</label>
        <input ref={input} id={id + "-input"} value={draft} maxLength={MAX_PANE_TITLE_LENGTH}
          aria-describedby={id + "-help"} onChange={event => setDraft(event.target.value)} />
        <p id={id + "-help"}>{i18n.t("deck.renamePaneHelp")}</p>
        <div><button type="button" onClick={close}>{i18n.t("deck.renamePaneCancel")}</button>
          <button type="submit">{i18n.t("deck.renamePaneSave")}</button></div>
      </form>
    </dialog>}
  </>;
}
