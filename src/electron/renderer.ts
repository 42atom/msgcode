import {
  buildReadonlyThreadSurfaceChrome,
  renderReadonlyThreadSurfaceMarkup,
} from "../ui/main-window/readonly-thread-surface.js";

export interface HtmlDocumentLike {
  open(): void;
  write(content: string): void;
  close(): void;
}

declare const document: HtmlDocumentLike;

export function bootstrapReadonlyThreadSurface(documentLike: HtmlDocumentLike): void {
  const chrome = buildReadonlyThreadSurfaceChrome({
    selectedWorkspace: "",
    selectedThreadId: "",
    loadingError: null,
  });
  const markup = renderReadonlyThreadSurfaceMarkup(chrome);
  documentLike.open();
  documentLike.write(markup);
  documentLike.close();
}

if (typeof globalThis === "object" && "document" in globalThis) {
  bootstrapReadonlyThreadSurface(document);
}
