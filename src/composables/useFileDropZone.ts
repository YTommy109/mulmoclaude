// File drag-and-drop zone helper (#1289 Step 2).
//
// Returns DOM-event handlers a caller binds onto the target element
// plus an `isDragging` ref the caller uses to render visual feedback.
// Also installs (once, lazily) a window-level guard that
// `preventDefault`s `dragover` / `drop` on file drags so the browser
// never navigates to a dropped file when the user misses the zone —
// losing the in-progress conversation was the original UX bug.
//
// Why "Files"-only: text-selection drags inside the page set
// `text/plain` on `dataTransfer.types` but never include `"Files"`.
// Gating on Files keeps the overlay hidden for those, both at the
// composable level and the window-guard level.
//
// Why a counter: real browsers fire `dragenter` / `dragleave` on
// every child the pointer crosses inside the target. A naive boolean
// toggles off as the pointer moves from the panel into the textarea,
// then on again, flickering the overlay. The counter ratchets up on
// each enter and only releases the overlay once it hits zero.

import { ref, type Ref } from "vue";

export interface FileDropHandlers {
  onDragenter: (event: DragEvent) => void;
  onDragover: (event: DragEvent) => void;
  onDragleave: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
}

export interface UseFileDropZoneResult extends FileDropHandlers {
  isDragging: Readonly<Ref<boolean>>;
}

export interface UseFileDropZoneOptions {
  /** Called when the user releases a file over the zone. The
   *  composable picks `files[0]` (first file) and ignores the rest;
   *  multi-file uploads are not a current product requirement. */
  onFile: (file: File) => void;
}

let windowGuardInstalled = false;

function isFileDrag(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

function installWindowDefaultGuard(): void {
  if (windowGuardInstalled) return;
  if (typeof window === "undefined") return;
  windowGuardInstalled = true;
  const prevent = (event: DragEvent): void => {
    if (isFileDrag(event)) event.preventDefault();
  };
  // Capture-phase isn't needed: `preventDefault` from a bubbling
  // handler still suppresses the default action.
  window.addEventListener("dragover", prevent);
  window.addEventListener("drop", prevent);
}

export function useFileDropZone(opts: UseFileDropZoneOptions): UseFileDropZoneResult {
  installWindowDefaultGuard();

  const isDragging = ref(false);
  let dragEnterCount = 0;

  function onDragenter(event: DragEvent): void {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragEnterCount += 1;
    isDragging.value = true;
  }

  function onDragover(event: DragEvent): void {
    // Some browsers (notably WebKit) suppress the subsequent `drop`
    // if `dragover` doesn't preventDefault — even when the prior
    // `dragenter` did. Re-prevent here.
    if (isFileDrag(event)) event.preventDefault();
  }

  function onDragleave(event: DragEvent): void {
    if (!isFileDrag(event)) return;
    dragEnterCount -= 1;
    if (dragEnterCount <= 0) {
      dragEnterCount = 0;
      isDragging.value = false;
    }
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault();
    dragEnterCount = 0;
    isDragging.value = false;
    const file = event.dataTransfer?.files[0];
    if (file) opts.onFile(file);
  }

  return { isDragging, onDragenter, onDragover, onDragleave, onDrop };
}

/** Test-only reset. Lets unit tests verify the install-once contract
 *  without leaking listeners across cases. */
export function _resetFileDropZoneForTests(): void {
  windowGuardInstalled = false;
}
