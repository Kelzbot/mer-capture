// The proxy passcode is the one thing this app keeps in localStorage. It is not a
// provider key: it only unlocks the demo proxy, which holds the real key.
const STORAGE_KEY = 'mer-capture.transcribe-passcode';

export function readDemoKey(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeDemoKey(value: string): void {
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, value);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: the passcode just won't persist.
  }
}
