import { useCallback, useEffect, useRef } from 'react';
import type { TextInput } from 'react-native';

/**
 * A Bluetooth/USB handheld scanner pairs as a keyboard and "types" what it
 * reads, usually followed by Enter. This hook drives a hidden TextInput that
 * catches that typing without showing the on-screen keyboard.
 *
 * Customer codes are `v2:<hex>:<hex>:<hex>` (functions/src/utils/encryption.ts):
 * only lowercase hex, digits and `:`, which sit on the same keys in UK and US
 * layouts. Scanners set to send upper case, or with a Tab/CR suffix, are
 * normalised here.
 */

const V2_TOKEN = /^v2:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/;
/** Scanners type a whole code in well under this; a pause means it's done. */
const IDLE_SUBMIT_MS = 120;

export function normaliseScannedCode(raw: string): string {
  const compact = raw.replace(/[\s\u0000-\u001f]+/g, '');
  return /^v2:/i.test(compact) ? compact.toLowerCase() : compact;
}

export function isCompleteCustomerCode(code: string): boolean {
  return V2_TOKEN.test(code);
}

interface Options {
  /** Listen only while true (screen focused, not mid-verification). */
  enabled: boolean;
  onScan: (code: string) => void;
}

export function useScannerInput({ enabled, onScan }: Options) {
  const inputRef = useRef<TextInput>(null);
  const buffer = useRef('');
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const clear = useCallback(() => {
    buffer.current = '';
    inputRef.current?.clear();
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
  }, []);

  const flush = useCallback(() => {
    const code = normaliseScannedCode(buffer.current);
    clear();
    if (code) onScanRef.current(code);
  }, [clear]);

  const focus = useCallback(() => {
    if (enabled) inputRef.current?.focus();
  }, [enabled]);

  useEffect(() => {
    if (enabled) {
      // Let the navigation transition settle before taking focus.
      const id = setTimeout(() => inputRef.current?.focus(), 300);
      return () => clearTimeout(id);
    }
    inputRef.current?.blur();
    clear();
    return undefined;
  }, [enabled, clear]);

  useEffect(() => clear, [clear]);

  const onChangeText = useCallback(
    (text: string) => {
      buffer.current = text;
      if (idleTimer.current) clearTimeout(idleTimer.current);
      // Some scanners send no Enter: submit once a full code stops arriving.
      idleTimer.current = setTimeout(() => {
        idleTimer.current = null;
        if (isCompleteCustomerCode(normaliseScannedCode(buffer.current))) flush();
      }, IDLE_SUBMIT_MS);
    },
    [flush]
  );

  const inputProps = {
    ref: inputRef,
    onChangeText,
    onSubmitEditing: flush,
    blurOnSubmit: false,
    showSoftInputOnFocus: false,
    autoCorrect: false,
    autoCapitalize: 'none' as const,
    autoComplete: 'off' as const,
    spellCheck: false,
    caretHidden: true,
    contextMenuHidden: true,
    importantForAccessibility: 'no-hide-descendants' as const,
    accessibilityElementsHidden: true,
  };

  return { inputProps, focus };
}
