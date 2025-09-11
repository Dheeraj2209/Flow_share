"use client";
import React from 'react';
import { Reorder, useDragControls } from 'framer-motion';

export function ReorderableRow({ valueId, children }: { valueId: number; children: (start:(e:any)=>void)=>React.ReactNode; }) {
  const controls = useDragControls();
  const startWithDelay = (downEvent: any) => {
    const isTouch = (downEvent?.pointerType === 'touch') || ('ontouchstart' in window);
    if (!isTouch) return controls.start(downEvent);
    let started = false;
    const timer = setTimeout(() => { started = true; controls.start(downEvent); }, 180);
    const clear = () => { if (!started) clearTimeout(timer); window.removeEventListener('pointerup', clear, { capture: true } as any); window.removeEventListener('pointercancel', clear, { capture: true } as any); };
    window.addEventListener('pointerup', clear, { capture: true } as any);
    window.addEventListener('pointercancel', clear, { capture: true } as any);
  };
  return (
    <Reorder.Item as="div" value={valueId} dragListener={false} dragControls={controls}>
      {children(startWithDelay)}
    </Reorder.Item>
  );
}

