"use client";

import { useState } from "react";
import { VIDEO_URL } from "@/lib/config";

/**
 * Demo video slot. An mp4 plays natively with the poster behind it, a Vimeo player url loads only after a click (so the
 * page makes no third-party request until someone asks for the video), and with no url there is a plain poster.
 * Never YouTube.
 */
export function Video() {
  const url = VIDEO_URL.trim();
  const [on, setOn] = useState(false);
  if (/\.(mp4|webm)(\?.*)?$/i.test(url)) {
    return <video className="video" src={url} poster="/video-poster.png" controls playsInline preload="none" />;
  }
  if (/^https:\/\/player\.vimeo\.com\//.test(url)) {
    if (on) {
      const src = url + (url.includes("?") ? "&" : "?") + "autoplay=1";
      return <iframe className="video" src={src} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen title="Deed demo video" />;
    }
    return (
      <button type="button" className="video poster" onClick={() => setOn(true)} aria-label="Play the demo video">
        <span className="play" aria-hidden="true" />
        <span className="poster-cap">
          <span>Watch the demo</span>
        </span>
      </button>
    );
  }
  return (
    <div className="video poster static" role="img" aria-label="Demo video coming soon">
      <span className="play" aria-hidden="true" style={{ opacity: 0.85 }} />
      <span className="poster-cap">
        <span>Demo video coming soon</span>
      </span>
    </div>
  );
}
