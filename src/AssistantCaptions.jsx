import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './assistant-captions.css';

// Mount after the orb button inside voice-stage. Neither placement contributes
// height to that stage, so speaking, errors and wrapping cannot move the orb.
export default function AssistantCaptions({ text = '', state = 'idle', visible = true, error = '', boardOpen = false, hostRef, onCapacity }) {
  const [host, setHost] = useState(null);
  const visibleText=useRef(null), capacity=useRef(onCapacity); capacity.current=onCapacity;
  useLayoutEffect(() => { setHost(hostRef?.current || null); }, [hostRef, boardOpen]);

  const hasError = Boolean(error);
  const fullText = (typeof error === 'string' && error.trim() ? error : typeof text === 'string' ? text : '').trim();
  const shown = Boolean(fullText) && (Boolean(visible) || hasError);
  const displayText = fullText;
  useLayoutEffect(() => {
    const element = visibleText.current;
    if (!element) return;
    const measure = () => capacity.current?.(Math.min(76, Math.max(32, Math.floor(element.clientWidth / 8.5) * 2)));
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => observer.disconnect();
  }, [boardOpen, host]);
  const caption = <div
    className={`assistant-captions ${boardOpen ? 'assistant-captions-board' : 'assistant-captions-orb'}${hasError ? ' has-error' : ''}${shown ? '' : ' is-hidden'}`}
    data-state={state}
    role={hasError ? 'alert' : 'status'}
    aria-live={shown ? hasError ? 'assertive' : 'polite' : 'off'}
    aria-atomic="true"
    aria-hidden={!shown}
  >
    <span ref={visibleText} className="assistant-captions-visible" aria-hidden="true" title={fullText || undefined}>{displayText}</span>
    <span className="assistant-captions-accessible">{fullText}</span>
  </div>;

  // Portal captions below the frame, outside the hidden/scaled voice stage.
  return boardOpen ? host ? createPortal(caption, host) : null : caption;
}
