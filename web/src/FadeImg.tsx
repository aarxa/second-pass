// A picture that fades in once it has loaded, over the soft placeholder behind it, instead of popping in.
// One that is already in the browser's cache shows at once.
import { useState, type ImgHTMLAttributes } from 'react';

export function FadeImg({ className, onLoad, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [shown, setShown] = useState<'' | ' in' | ' instant'>('');
  return (
    <img
      {...props}
      className={`fade${shown}${className ? ` ${className}` : ''}`}
      ref={(el) => { if (el && !shown && el.complete && el.naturalWidth > 0) setShown(' instant'); }}
      onLoad={(e) => { setShown((s) => s || ' in'); onLoad?.(e); }}
    />
  );
}
